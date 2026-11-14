"""Session tasks of a study room ("Buổi học hôm nay").

Read access follows room visibility (can_view_room: the same gate as the room's member list,
so the group's room card and the in-room panel agree). Creating requires being an active
participant (can_access_room); editing/deleting is owner-only -- a list is one person's
promise to the room, nobody else rewrites it.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.core.permissions import can_access_room, can_view_room
from app.db.enums import RoomTaskStatus
from app.db.session import get_db_session
from app.room_tasks.dto.room_task_dto import RoomTaskCreate, RoomTaskResponse, RoomTaskUpdate
from app.room_tasks.entities.room_task_entity import RoomTask
from app.study_rooms.entities.study_room_entity import StudyRoom
from app.study_rooms.services.study_room_service import StudyRoomsService

router = APIRouter(prefix="/study-rooms/{room_id}/tasks", tags=["Room tasks"])
study_rooms_service = StudyRoomsService()

MAX_TASKS_PER_USER = 50


async def _get_visible_room(session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> StudyRoom:
    """404 for missing/deleted rooms and for private rooms hidden from the caller (mirrors
    study_room_router.get_room), 403 for a public room the caller isn't a group member of."""
    room = await study_rooms_service.get_by_id(session, room_id)
    if room is None or room.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study room not found")
    if not await can_view_room(session, room, user_id):
        if room.is_private:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Study room not found")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    return room


async def _get_own_task(session: AsyncSession, room_id: uuid.UUID, task_id: uuid.UUID, user_id: uuid.UUID) -> RoomTask:
    task = await session.scalar(
        select(RoomTask).options(selectinload(RoomTask.user)).where(RoomTask.id == task_id, RoomTask.room_id == room_id)
    )
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    if task.user_id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only change your own tasks")
    return task


@router.get("", response_model=list[RoomTaskResponse])
async def list_room_tasks(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Every participant's session tasks, oldest first."""
    await _get_visible_room(session, room_id, current_user.id)
    result = await session.execute(
        select(RoomTask)
        .options(selectinload(RoomTask.user))
        .where(RoomTask.room_id == room_id)
        .order_by(RoomTask.created_at, RoomTask.id)
    )
    return list(result.scalars())


@router.post("", response_model=RoomTaskResponse, status_code=status.HTTP_201_CREATED)
async def create_room_task(
    room_id: uuid.UUID,
    data: RoomTaskCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Add a task to the caller's own list. Requires active participation in the room."""
    room = await _get_visible_room(session, room_id, current_user.id)
    if not await can_access_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the study room before adding tasks")
    count = await session.scalar(
        select(func.count()).select_from(RoomTask).where(RoomTask.room_id == room_id, RoomTask.user_id == current_user.id)
    )
    if (count or 0) >= MAX_TASKS_PER_USER:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"At most {MAX_TASKS_PER_USER} tasks per person per room")
    task = RoomTask(room_id=room_id, user_id=current_user.id, title=data.title)
    session.add(task)
    try:
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not create task: {e}")
    return await _get_own_task(session, room_id, task.id, current_user.id)


@router.patch("/{task_id}", response_model=RoomTaskResponse)
async def update_room_task(
    room_id: uuid.UUID,
    task_id: uuid.UUID,
    data: RoomTaskUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Rename or move the caller's own task between todo / doing / done. A person focuses on
    one thing at a time: setting `doing` demotes their other `doing` task back to `todo`."""
    await _get_visible_room(session, room_id, current_user.id)
    task = await _get_own_task(session, room_id, task_id, current_user.id)
    if data.title is not None:
        task.title = data.title
    if data.status is not None and data.status != task.status:
        if data.status == RoomTaskStatus.DOING:
            await session.execute(
                update(RoomTask)
                .where(
                    RoomTask.room_id == room_id,
                    RoomTask.user_id == current_user.id,
                    RoomTask.status == RoomTaskStatus.DOING,
                    RoomTask.id != task.id,
                )
                .values(status=RoomTaskStatus.TODO)
            )
        task.status = data.status
        task.done_at = datetime.now(timezone.utc) if data.status == RoomTaskStatus.DONE else None
    try:
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not update task: {e}")
    return await _get_own_task(session, room_id, task.id, current_user.id)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room_task(
    room_id: uuid.UUID,
    task_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    await _get_visible_room(session, room_id, current_user.id)
    task = await _get_own_task(session, room_id, task_id, current_user.id)
    await session.delete(task)
    try:
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not delete task: {e}")
