"""Shared task flow board of a study group. Any active group member can read and edit it."""

import itertools
import logging
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.core.ai_quota import consume_quota, local_today, refund_quota, remaining_quota
from app.core.permissions import is_active_group_member
from app.db.session import get_db_session
from app.group_tasks.dto.group_task_dto import (
    AI_MAX_HORIZON_DAYS,
    AIGroupTaskApplyRequest,
    AIGroupTaskGenerateRequest,
    AIGroupTaskGenerateResponse,
    AIGroupTaskNode,
    AIQuotaResponse,
    GroupTaskCreate,
    GroupTaskResponse,
    GroupTaskUpdate,
)
from app.group_tasks.entities.group_task_entity import GroupTask
from app.roadmaps.services.roadmap_ai_service import RoadmapAiError, RoadmapAiService, RoadmapAiServiceNotConfigured

router = APIRouter(prefix="/groups/{group_id}/tasks", tags=["Group tasks"])

MAX_TASKS_PER_GROUP = 500
AI_FEATURE = "group_task_tree"
AI_DAILY_LIMIT = 5      # AI roadmap generations per user per Vietnam-local day, across all groups
AI_DEFAULT_WEEKS = 8    # plan horizon when the user gives no deadline
roadmap_ai_service = RoadmapAiService()
logger = logging.getLogger(__name__)


async def _require_member(session: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
    if not await is_active_group_member(session, group_id, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only active group members can use the group task board")


async def _get_task(session: AsyncSession, group_id: uuid.UUID, task_id: uuid.UUID) -> GroupTask:
    task = await session.scalar(select(GroupTask).where(GroupTask.id == task_id, GroupTask.group_id == group_id))
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


async def _validate_parent(
    session: AsyncSession, group_id: uuid.UUID, parent_id: uuid.UUID, moving_id: uuid.UUID | None = None
) -> None:
    """Parent must be in the same group and (when re-parenting) must not be the task itself or
    one of its descendants -- that would detach a cycle from the tree."""
    current: uuid.UUID | None = parent_id
    first = True
    while current is not None:
        if current == moving_id:
            raise HTTPException(422, "A task cannot be moved under itself or its subtask")
        row = (
            await session.execute(
                select(GroupTask.group_id, GroupTask.parent_id).where(GroupTask.id == current)
            )
        ).one_or_none()
        if row is None or row.group_id != group_id:
            if first:
                raise HTTPException(422, "Parent task not found in this group")
            break
        first = False
        current = row.parent_id


@router.get("", response_model=list[GroupTaskResponse])
async def list_group_tasks(
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """List every task on the group's board (open and done), oldest first."""
    await _require_member(session, group_id, current_user.id)
    result = await session.execute(
        select(GroupTask).where(GroupTask.group_id == group_id).order_by(GroupTask.created_at, GroupTask.id)
    )
    return list(result.scalars())


@router.get("/ai/quota", response_model=AIQuotaResponse)
async def get_group_task_ai_quota(
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """How many AI roadmap generations the caller has left today (shared across all their groups)."""
    await _require_member(session, group_id, current_user.id)
    remaining = await remaining_quota(session, current_user.id, AI_FEATURE, AI_DAILY_LIMIT)
    return AIQuotaResponse(limit=AI_DAILY_LIMIT, remaining=remaining)


@router.post("/ai/generate", response_model=AIGroupTaskGenerateResponse)
async def generate_group_task_tree(
    group_id: uuid.UUID,
    data: AIGroupTaskGenerateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Generate a reviewable task tree for the group from a natural-language goal.

    Costs one of the caller's AI_DAILY_LIMIT daily uses; the use is refunded if the AI call fails
    on our side, but not when the goal was too vague (the model still ran).
    """
    await _require_member(session, group_id, current_user.id)
    remaining = await consume_quota(session, current_user.id, AI_FEATURE, AI_DAILY_LIMIT)
    if remaining is None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Bạn đã dùng hết {AI_DAILY_LIMIT} lượt tạo lộ trình AI hôm nay. Hãy thử lại vào ngày mai.",
        )

    today = local_today()
    deadline = data.due_date or today + timedelta(weeks=AI_DEFAULT_WEEKS)
    try:
        suggestion = await roadmap_ai_service.suggest_group_tasks(
            goal=data.goal,
            due_date=deadline.isoformat(),
            hours_per_week=data.hours_per_week,
            current_level=data.current_level,
            today=today.isoformat(),
        )
    except RoadmapAiServiceNotConfigured as exc:
        await refund_quota(session, current_user.id, AI_FEATURE)
        logger.error("Group task AI requested but not configured: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Tính năng gợi ý bằng AI hiện chưa khả dụng.") from exc
    except RoadmapAiError as exc:
        await refund_quota(session, current_user.id, AI_FEATURE)
        logger.warning("Group task AI generation failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Không thể tạo lộ trình lúc này, vui lòng thử lại sau.") from exc
    except Exception:
        await refund_quota(session, current_user.id, AI_FEATURE)
        raise

    if not suggestion.nodes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mục tiêu không rõ ràng để tạo lộ trình.")
    _clamp_due_dates(suggestion.nodes, today, deadline)
    return AIGroupTaskGenerateResponse(**suggestion.model_dump(), remaining_today=remaining)


def _clamp_due_dates(nodes: list[AIGroupTaskNode], earliest: date, latest: date) -> None:
    """Keep every due date within [earliest, latest], and a subtask no later than its parent.

    The model sometimes dates tasks in the past or after the goal deadline; clamping beats
    rejecting the whole roadmap over one bad date.
    """
    for node in nodes:
        if node.due_date is not None:
            node.due_date = min(max(node.due_date, earliest), latest)
        _clamp_due_dates(node.children, earliest, node.due_date or latest)


def _count_ai_nodes(nodes: list[AIGroupTaskNode]) -> int:
    return sum(1 + _count_ai_nodes(node.children) for node in nodes)


async def _insert_ai_nodes(
    session: AsyncSession,
    group_id: uuid.UUID,
    created_by: uuid.UUID,
    nodes: list[AIGroupTaskNode],
    parent_id: uuid.UUID | None = None,
    stamps: Iterator[datetime] | None = None,
    roadmap_id: uuid.UUID | None = None,
) -> list[GroupTask]:
    roadmap_id = roadmap_id or uuid.uuid4()
    # Postgres now() is the transaction start time, so every row inserted here would share one
    # created_at and the board (ordered by created_at, id) would show the AI's sequence in random
    # uuid order. Stamp each node explicitly, 1ms apart, in depth-first order.
    if stamps is None:
        base = datetime.now(timezone.utc)
        stamps = (base + timedelta(milliseconds=step) for step in itertools.count())
    inserted: list[GroupTask] = []
    for node in nodes:
        task = GroupTask(
            created_at=next(stamps),
            roadmap_id=roadmap_id,
            group_id=group_id,
            parent_id=parent_id,
            title=node.title,
            assignee=node.assignee,
            due_date=node.due_date,
            done=False,
            notes=node.notes,
            position_x=None,
            position_y=None,
            created_by=created_by,
        )
        session.add(task)
        await session.flush()
        await session.refresh(task)
        inserted.append(task)
        inserted.extend(await _insert_ai_nodes(session, group_id, created_by, node.children, task.id, stamps, roadmap_id))
    return inserted


@router.post("/ai/apply", response_model=list[GroupTaskResponse], status_code=status.HTTP_201_CREATED)
async def apply_group_task_tree(
    group_id: uuid.UUID,
    data: AIGroupTaskApplyRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Insert a reviewed AI task tree, optionally replacing the existing board."""
    await _require_member(session, group_id, current_user.id)
    # The tree comes back from the client, so re-check its dates (it may also be applied a day later).
    today = local_today()
    _clamp_due_dates(data.nodes, today, today + timedelta(days=AI_MAX_HORIZON_DAYS))

    generated_count = _count_ai_nodes(data.nodes)
    if generated_count > MAX_TASKS_PER_GROUP:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Một lộ trình có tối đa {MAX_TASKS_PER_GROUP} nhiệm vụ")

    if data.replace_existing:
        # One bulk DELETE: per-row ORM deletes race the parent_id ON DELETE CASCADE.
        await session.execute(delete(GroupTask).where(GroupTask.group_id == group_id))
    else:
        count = await session.scalar(select(func.count()).select_from(GroupTask).where(GroupTask.group_id == group_id))
        if (count or 0) + generated_count > MAX_TASKS_PER_GROUP:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Bảng nhóm chỉ còn chứa tối đa {MAX_TASKS_PER_GROUP} nhiệm vụ")

    created = await _insert_ai_nodes(session, group_id, current_user.id, data.nodes)
    await session.commit()
    return created


@router.post("", response_model=GroupTaskResponse, status_code=status.HTTP_201_CREATED)
async def create_group_task(
    group_id: uuid.UUID,
    data: GroupTaskCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Add a task to the board, optionally as a child of `parent_id`."""
    await _require_member(session, group_id, current_user.id)
    count = await session.scalar(select(func.count()).select_from(GroupTask).where(GroupTask.group_id == group_id))
    if (count or 0) >= MAX_TASKS_PER_GROUP:
        raise HTTPException(422, f"A group board holds at most {MAX_TASKS_PER_GROUP} tasks")
    if data.parent_id is not None:
        await _validate_parent(session, group_id, data.parent_id)

    task = GroupTask(**data.model_dump(), group_id=group_id, created_by=current_user.id)
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=GroupTaskResponse)
async def update_group_task(
    group_id: uuid.UUID,
    task_id: uuid.UUID,
    data: GroupTaskUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Partially update a task: title, assignee, due date, done, notes, parent or canvas position."""
    await _require_member(session, group_id, current_user.id)
    task = await _get_task(session, group_id, task_id)

    changes = data.model_dump(exclude_unset=True)
    if changes.get("parent_id") is not None:
        await _validate_parent(session, group_id, changes["parent_id"], moving_id=task.id)
    if "position" in changes:
        position = changes.pop("position")
        task.position_x = position["x"] if position else None
        task.position_y = position["y"] if position else None
    for field, value in changes.items():
        setattr(task, field, value)

    await session.commit()
    await session.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group_task(
    group_id: uuid.UUID,
    task_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Delete a task and its whole subtree (ON DELETE CASCADE on parent_id)."""
    await _require_member(session, group_id, current_user.id)
    task = await _get_task(session, group_id, task_id)
    await session.delete(task)
    await session.commit()
