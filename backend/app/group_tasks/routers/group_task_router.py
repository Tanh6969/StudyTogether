"""Shared task flow board of a study group. Any active group member can read and edit it."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.core.permissions import is_active_group_member
from app.db.session import get_db_session
from app.group_tasks.dto.group_task_dto import GroupTaskCreate, GroupTaskResponse, GroupTaskUpdate
from app.group_tasks.entities.group_task_entity import GroupTask

router = APIRouter(prefix="/groups/{group_id}/tasks", tags=["Group tasks"])

MAX_TASKS_PER_GROUP = 500


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
