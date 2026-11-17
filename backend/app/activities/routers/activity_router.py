"""In-call activities of a study room (docs/design/hoat-dong-trong-call.md).

Authority model, in one place:
- Reading follows room visibility (can_view_room), like the room's member list.
- Creating / joining an activity and adding to the music queue need active participation in
  the room (can_access_room) -- you have to be in the call.
- Changing an activity's state (status, settings, snapshot, queue order) is the activity
  host's job; the group owner, room host or a group moderator (can_moderate_room) can always
  step in or stop it.
- Taking over as host (`host_user_id` = caller) is open to any participant: the clients
  deterministically elect the first still-connected participant when the host drops, and the
  backend cannot see LiveKit connectivity, so it trusts that election inside a small, private
  room. A manager may also hand the host role to anyone.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.activities.dto.activity_dto import (
    ActivityCreate,
    ActivityResponse,
    ActivityUpdate,
    QueueItemCreate,
    QueueItemResponse,
    QueueItemUpdate,
    ResolvedTrack,
    ResolveTrackRequest,
    WordPackRequest,
    WordPackResponse,
)
from app.activities.entities.activity_entity import RoomActivity, RoomMusicQueueItem
from app.activities.services.music_resolve_service import TrackResolveError, resolve_track
from app.activities.services.word_pack_service import WordPackService
from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.core.permissions import can_access_room, can_moderate_room, can_view_room
from app.db.session import get_db_session
from app.groups.entities.group_entity import Group
from app.roadmaps.services.roadmap_ai_service import RoadmapAiError, RoadmapAiServiceNotConfigured
from app.study_rooms.entities.study_room_entity import StudyRoom
from app.study_rooms.services.study_room_service import StudyRoomsService

router = APIRouter(prefix="/study-rooms/{room_id}/activities", tags=["Room activities"])
music_router = APIRouter(prefix="/music", tags=["Music"])

study_rooms_service = StudyRoomsService()
word_pack_service = WordPackService()

MAX_QUEUE_ITEMS = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_visible_room(session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> StudyRoom:
    room = await study_rooms_service.get_by_id(session, room_id)
    if room is None or room.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study room not found")
    if not await can_view_room(session, room, user_id):
        if room.is_private:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Study room not found")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    return room


async def _require_participant(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> None:
    if not await can_access_room(session, room, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the study room before using activities")


def _activity_query():
    return select(RoomActivity).options(selectinload(RoomActivity.host))


async def _get_live_activity(session: AsyncSession, room_id: uuid.UUID, activity_id: uuid.UUID) -> RoomActivity:
    activity = await session.scalar(
        _activity_query().where(RoomActivity.id == activity_id, RoomActivity.room_id == room_id)
    )
    if activity is None or activity.ended_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found or already ended")
    return activity


async def _reload(session: AsyncSession, activity_id: uuid.UUID) -> RoomActivity:
    activity = await session.scalar(_activity_query().where(RoomActivity.id == activity_id))
    assert activity is not None
    return activity


async def _can_control(session: AsyncSession, room: StudyRoom, activity: RoomActivity, user_id: uuid.UUID) -> bool:
    return activity.host_user_id == user_id or await can_moderate_room(session, room, user_id)


def _participant_ids(activity: RoomActivity) -> list[str]:
    return [str(p) for p in (activity.participants or [])]


async def _commit(session: AsyncSession, what: str) -> None:
    try:
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not {what}: {e}")


# --- activities ---------------------------------------------------------------------------


@router.get("", response_model=list[ActivityResponse])
async def list_activities(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Live (not ended) activities of the room, oldest first."""
    await _get_visible_room(session, room_id, current_user.id)
    result = await session.execute(
        _activity_query().where(RoomActivity.room_id == room_id, RoomActivity.ended_at.is_(None)).order_by(RoomActivity.created_at)
    )
    return list(result.scalars())


@router.post("", response_model=ActivityResponse, status_code=status.HTTP_201_CREATED)
async def create_activity(
    room_id: uuid.UUID,
    data: ActivityCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Start an activity with the caller as host. If one of the same kind is already live the
    caller simply joins it and gets it back (so two people pressing "start" at once both land
    in the same game instead of one of them seeing an error)."""
    room = await _get_visible_room(session, room_id, current_user.id)
    await _require_participant(session, room, current_user.id)
    if room.status == "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, "This study room has ended")
    if data.kind == "game" and data.game is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "game is required for a game activity")

    existing = await session.scalar(
        _activity_query().where(RoomActivity.room_id == room_id, RoomActivity.kind == data.kind, RoomActivity.ended_at.is_(None))
    )
    if existing is not None:
        return await _join(session, existing, current_user.id)

    activity = RoomActivity(
        room_id=room_id,
        kind=data.kind,
        game=data.game if data.kind == "game" else None,
        host_user_id=current_user.id,
        status="running" if data.kind == "music" else "lobby",
        participants=[str(current_user.id)],
        settings=data.settings,
    )
    session.add(activity)
    try:
        await session.commit()
    except IntegrityError:
        # Lost the race against another creator: join theirs.
        await session.rollback()
        existing = await session.scalar(
            _activity_query().where(RoomActivity.room_id == room_id, RoomActivity.kind == data.kind, RoomActivity.ended_at.is_(None))
        )
        if existing is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Could not start the activity, please retry")
        return await _join(session, existing, current_user.id)
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not start activity: {e}")
    return await _reload(session, activity.id)


async def _join(session: AsyncSession, activity: RoomActivity, user_id: uuid.UUID) -> RoomActivity:
    ids = _participant_ids(activity)
    if str(user_id) not in ids:
        activity.participants = [*ids, str(user_id)]
        await _commit(session, "join activity")
    return await _reload(session, activity.id)


@router.post("/{activity_id}/join", response_model=ActivityResponse)
async def join_activity(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    room = await _get_visible_room(session, room_id, current_user.id)
    await _require_participant(session, room, current_user.id)
    activity = await _get_live_activity(session, room_id, activity_id)
    return await _join(session, activity, current_user.id)


@router.post("/{activity_id}/leave", response_model=ActivityResponse)
async def leave_activity(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Leave the activity. A departing host hands over to the next participant in join order;
    when the last participant leaves, the activity ends."""
    await _get_visible_room(session, room_id, current_user.id)
    activity = await _get_live_activity(session, room_id, activity_id)
    remaining = [p for p in _participant_ids(activity) if p != str(current_user.id)]
    activity.participants = remaining
    if not remaining:
        activity.status = "ended"
        activity.ended_at = _now()
    elif str(activity.host_user_id) == str(current_user.id):
        activity.host_user_id = uuid.UUID(remaining[0])
    await _commit(session, "leave activity")
    return await _reload(session, activity.id)


@router.patch("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    data: ActivityUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    room = await _get_visible_room(session, room_id, current_user.id)
    activity = await _get_live_activity(session, room_id, activity_id)
    is_controller = await _can_control(session, room, activity, current_user.id)
    fields = data.model_fields_set

    if "host_user_id" in fields and data.host_user_id is not None:
        new_host = str(data.host_user_id)
        if new_host not in _participant_ids(activity):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The new host must be a participant of the activity")
        taking_over = new_host == str(current_user.id)
        # A participant may claim the host role for themselves (the clients elect who does
        # this when the host drops -- see module docstring); handing it to someone ELSE is
        # reserved for the current host or a manager.
        if not (is_controller or taking_over):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the host or a group manager can hand over the host role")
        activity.host_user_id = data.host_user_id
        is_controller = True

    if any(f in fields for f in ("status", "settings", "snapshot")) and not is_controller:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the activity host or a group manager can change it")

    if data.settings is not None:
        activity.settings = data.settings
    if data.snapshot is not None:
        activity.snapshot = data.snapshot
        activity.snapshot_at = _now()
    if data.status is not None:
        activity.status = data.status
        if data.status == "ended":
            activity.ended_at = _now()
    await _commit(session, "update activity")
    return await _reload(session, activity.id)


@router.delete("/{activity_id}", response_model=ActivityResponse)
async def end_activity(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    room = await _get_visible_room(session, room_id, current_user.id)
    activity = await _get_live_activity(session, room_id, activity_id)
    if not await _can_control(session, room, activity, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the activity host or a group manager can end it")
    activity.status = "ended"
    activity.ended_at = _now()
    await _commit(session, "end activity")
    return await _reload(session, activity.id)


# --- Phấn Trắng word pack -------------------------------------------------------------------


@router.post("/word-pack", response_model=WordPackResponse)
async def generate_word_pack(
    room_id: uuid.UUID,
    data: WordPackRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """AI-generated "Ôn bài" words from the group's name/description (or an explicit topic)."""
    room = await _get_visible_room(session, room_id, current_user.id)
    await _require_participant(session, room, current_user.id)
    topic = (data.topic or "").strip()
    if not topic:
        group = await session.get(Group, room.group_id)
        parts = [room.name, room.description or ""]
        if group is not None:
            parts = [group.name, group.description or "", *parts]
        topic = "\n".join(p for p in parts if p and p.strip())
    try:
        words = await word_pack_service.generate(topic)
    except RoadmapAiServiceNotConfigured as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"AI chưa được cấu hình: {exc}")
    except RoadmapAiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Không sinh được bộ từ: {exc}")
    if len(words) < 8:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI trả về quá ít từ dùng được, thử lại nhé")
    return WordPackResponse(topic=topic[:300], words=words)


# --- music queue ------------------------------------------------------------------------------


@music_router.post("/resolve", response_model=ResolvedTrack)
async def resolve_music_link(
    data: ResolveTrackRequest,
    _: CurrentUser = Depends(get_current_user),
):
    """Preview what a pasted link would add to a queue (no room needed)."""
    try:
        return await resolve_track(data.url)
    except TrackResolveError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


def _queue_query(activity_id: uuid.UUID):
    return (
        select(RoomMusicQueueItem)
        .options(selectinload(RoomMusicQueueItem.adder))
        .where(RoomMusicQueueItem.activity_id == activity_id)
        .order_by(RoomMusicQueueItem.position, RoomMusicQueueItem.added_at)
    )


@router.get("/{activity_id}/queue", response_model=list[QueueItemResponse])
async def list_queue(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    await _get_visible_room(session, room_id, current_user.id)
    await _get_live_activity(session, room_id, activity_id)
    result = await session.execute(_queue_query(activity_id))
    return list(result.scalars())


@router.post("/{activity_id}/queue", response_model=QueueItemResponse, status_code=status.HTTP_201_CREATED)
async def add_to_queue(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    data: QueueItemCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    room = await _get_visible_room(session, room_id, current_user.id)
    await _require_participant(session, room, current_user.id)
    activity = await _get_live_activity(session, room_id, activity_id)
    if activity.kind != "music":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This activity has no music queue")
    try:
        track = await resolve_track(data.url)
    except TrackResolveError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    count = await session.scalar(select(func.count()).select_from(RoomMusicQueueItem).where(RoomMusicQueueItem.activity_id == activity_id))
    if (count or 0) >= MAX_QUEUE_ITEMS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Hàng đợi tối đa {MAX_QUEUE_ITEMS} bài")
    last = await session.scalar(select(func.max(RoomMusicQueueItem.position)).where(RoomMusicQueueItem.activity_id == activity_id))
    item = RoomMusicQueueItem(
        activity_id=activity_id,
        room_id=room_id,
        position=(last or 0.0) + 1.0,
        provider=track.provider,
        provider_id=track.provider_id,
        url=track.url,
        title=track.title,
        author=track.author,
        thumbnail_url=track.thumbnail_url,
        duration_ms=track.duration_ms,
        start_ms=track.start_ms,
        added_by=current_user.id,
    )
    session.add(item)
    await _commit(session, "add to queue")
    # Anyone adding a track becomes a participant so they count for skip votes.
    if str(current_user.id) not in _participant_ids(activity):
        activity.participants = [*_participant_ids(activity), str(current_user.id)]
        await _commit(session, "join activity")
    return await session.scalar(_queue_query(activity_id).where(RoomMusicQueueItem.id == item.id))


@router.patch("/{activity_id}/queue/{item_id}", response_model=QueueItemResponse)
async def update_queue_item(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    item_id: uuid.UUID,
    data: QueueItemUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Reorder (DJ / manager) or mark played (DJ / manager)."""
    room = await _get_visible_room(session, room_id, current_user.id)
    activity = await _get_live_activity(session, room_id, activity_id)
    if not await _can_control(session, room, activity, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the DJ or a group manager can reorder the queue")
    item = await session.scalar(_queue_query(activity_id).where(RoomMusicQueueItem.id == item_id))
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Queue item not found")
    if data.position is not None:
        item.position = data.position
    if "played_at" in data.model_fields_set:
        item.played_at = data.played_at
    await _commit(session, "update queue item")
    return await session.scalar(_queue_query(activity_id).where(RoomMusicQueueItem.id == item_id))


@router.delete("/{activity_id}/queue/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_queue_item(
    room_id: uuid.UUID,
    activity_id: uuid.UUID,
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    room = await _get_visible_room(session, room_id, current_user.id)
    activity = await _get_live_activity(session, room_id, activity_id)
    item = await session.scalar(select(RoomMusicQueueItem).where(RoomMusicQueueItem.id == item_id, RoomMusicQueueItem.activity_id == activity_id))
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Queue item not found")
    if item.added_by != current_user.id and not await _can_control(session, room, activity, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only whoever added the track, the DJ or a group manager can remove it")
    await session.delete(item)
    await _commit(session, "remove queue item")
