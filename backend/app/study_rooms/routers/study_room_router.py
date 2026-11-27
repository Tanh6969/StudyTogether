import json
import logging
import uuid
from contextlib import aclosing
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.attachments.dto.attachment_dto import DownloadUrlResponse, UploadUrlRequest, UploadUrlResponse
from app.attachments.services.attachment_service import (
    AttachmentServiceNotConfigured,
    AttachmentStorageError,
    AttachmentsService,
)
from app.auth.dependencies import get_current_user, get_current_user_optional
from app.auth.dto.auth_dto import CurrentUser
from app.core.config import settings
from app.core.permissions import (
    can_access_room,
    can_act_on_member,
    can_edit_whiteboard,
    can_join_room,
    can_join_room_meeting,
    can_manage_room,
    can_moderate_room,
    can_view_room,
    is_active_group_member,
    is_group_manager,
)
from app.db.session import get_db_session
from app.db.enums import ModerationAction, StudyRoomMemberRole
from app.groups.services.group_service import GroupsService
from app.meetings.dto.meeting_dto import (
    MeetingTokenRequest, MeetingTokenResponse, MeetingSessionClaim, MeetingSessionStatus,
)
from app.meetings.services.live_caption_service import live_caption_service
from app.meetings.services.meeting_session_service import meeting_session_service
from app.meetings.services.livekit_service import LiveKitService
from app.profiles.services.profile_service import ProfilesService
from app.study_rooms.dto.study_room_dto import (
    RoomModerationActionCreate,
    RoomModerationActionResponse,
    StudyRoomCreate,
    StudyRoomMemberResponse,
    StudyRoomSessionResponse,
    StudyRoomResponse,
    StudyRoomUpdate,
    TransferHostRequest,
)
from app.study_rooms.entities.study_room_entity import StudyRoom
from app.study_rooms.services.study_room_service import StudyRoomsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/study-rooms", tags=["Study Rooms"])
service = StudyRoomsService()
groups_service = GroupsService()
profiles_service = ProfilesService()
livekit_service = LiveKitService()
attachments_service = AttachmentsService()

_SELF_SERVICE_MODERATION_ACTIONS = {ModerationAction.RAISE_HAND, ModerationAction.LOWER_HAND}
WHITEBOARD_ASSET_URL_EXPIRES_IN = 3600


async def _get_active_room_or_404(session: AsyncSession, room_id: uuid.UUID) -> StudyRoom:
    """Shared "not found or soft-deleted" gate: a deleted room must behave as if it no longer
    exists for every normal read/write entry point (get, update, start, end, join, leave,
    members, role changes, moderation, meeting token, and delete itself) -- see
    STUDY_PLATFORM_DATABASE_SPEC.md §16. Deleting an already-deleted room therefore also 404s
    here, same as deleting a missing one -- there is no distinct "already deleted" status, by
    design (mirrors channel_router._get_active_channel_or_404)."""
    room = await service.get_by_id(session, room_id)
    if room is None or room.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study room not found")
    return room


async def _with_active_counts(session: AsyncSession, rooms: list[StudyRoom]) -> list[StudyRoomResponse]:
    # The badge means *connected to the call*, never "has a DB row without
    # left_at". Keep membership independently for authorization and history.
    try:
        counts = await livekit_service.connected_counts([room.id for room in rooms])
    except Exception:
        logger.exception("LiveKit presence counts unavailable")
        counts = None
    return [
        StudyRoomResponse.model_validate(room).model_copy(
            update={"active_member_count": counts.get(room.id, 0) if counts is not None else None}
        )
        for room in rooms
    ]


@router.post("/", response_model=StudyRoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    data: StudyRoomCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Create a new study room under a group. Only an active group owner or moderator may create a study room; the authenticated caller becomes the room's host."""
    group = await groups_service.get_by_id(session, data.group_id)
    if not group:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    # Product rule (2026-08-18): only an active group owner or moderator may create a
    # Study Room -- a plain Member must not (supersedes the old STUDY_PLATFORM_DATABASE_SPEC.md
    # §16 behavior, which let any active member create a room).
    if not await is_group_manager(session, data.group_id, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only an active group owner or moderator can create a study room here"
        )
    try:
        # The authenticated caller always becomes the host; there is no client-supplied
        # host_id to trust or ignore (see StudyRoomCreate).
        room = await service.create(session, data, host_id=current_user.id)
        await session.commit()
        return room
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not create study room: {str(e)}"
        )


@router.get("/", response_model=list[StudyRoomResponse])
async def list_rooms(
    group_id: uuid.UUID,
    current_user: CurrentUser | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_db_session),
):
    """List the study rooms of a group. Public rooms stay listed as before (also to anonymous
    callers, matching list_channels); a private room is only listed to callers who pass
    `can_view_room` -- anyone else must not even learn its name."""
    rooms = await service.list_by_group(session, group_id)
    if current_user is None:
        visible = [room for room in rooms if not room.is_private]
    else:
        visible = [
            room for room in rooms
            if not room.is_private or await can_view_room(session, room, current_user.id)
        ]
    return await _with_active_counts(session, visible)


@router.get("/{room_id}", response_model=StudyRoomResponse)
async def get_room(
    room_id: uuid.UUID,
    current_user: CurrentUser | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_db_session),
):
    """Get a single study room by its ID. A private room hidden from the caller 404s (rather
    than 403) so its existence isn't confirmed by direct ID lookup either."""
    room = await _get_active_room_or_404(session, room_id)
    if room.is_private and (current_user is None or not await can_view_room(session, room, current_user.id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Study room not found")
    return (await _with_active_counts(session, [room]))[0]


@router.put("/{room_id}", response_model=StudyRoomResponse)
async def update_room(
    room_id: uuid.UUID,
    data: StudyRoomUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session)
):
    """Update a study room's details. Only the group owner or the room's host may update it."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_manage_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the group owner or the room host can update this study room")
    try:
        updated = await service.update(session, room, data)
        await session.commit()
        return updated
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not update study room: {str(e)}"
        )


@router.put("/{room_id}/whiteboard", response_model=StudyRoomResponse)
async def update_whiteboard_state(
    room_id: uuid.UUID,
    state: dict,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session)
):
    """Update the persisted whiteboard state for a study room. Only the room's host or a moderator may edit the whiteboard."""
    room = await _get_active_room_or_404(session, room_id)
    # LiveKit data publishing is needed by room activities, so authorization for persisted
    # whiteboard state is checked independently of the participant token.
    if not await can_edit_whiteboard(session, room, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the host or a moderator can edit this study room's whiteboard"
        )
    try:
        room.whiteboard_state = state
        await session.commit()
        await session.refresh(room)
        return room
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not update whiteboard state: {str(e)}"
        )


@router.post("/{room_id}/whiteboard/assets/upload-url", response_model=UploadUrlResponse)
async def create_whiteboard_asset_upload_url(
    room_id: uuid.UUID,
    data: UploadUrlRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Step 1 of sharing an image/document on the board, OR uploading a presentation deck (see
    `update_presentation_state` below -- both reuse this single room-scoped upload endpoint
    rather than duplicating it, since a deck is just another asset in the same storage
    namespace): a signed upload URL into the same `message-attachments` bucket/namespace chat
    attachments already use (`study-rooms/{room_id}/...`, see
    AttachmentsService.build_room_object_path) -- no new bucket needed. Gated the same as the
    whiteboard PUT above (host/moderator only), since adding an asset is a board edit."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_edit_whiteboard(session, room, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the host or a moderator can add files to this study room's whiteboard"
        )
    path = attachments_service.build_room_object_path(room.id, current_user.id, data.file_name)
    try:
        result = await attachments_service.create_signed_upload_url(path)
    except AttachmentServiceNotConfigured as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Attachment storage is not configured") from exc
    except AttachmentStorageError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return UploadUrlResponse(**result)


@router.get("/{room_id}/whiteboard/assets/download-url", response_model=DownloadUrlResponse)
async def get_whiteboard_asset_download_url(
    room_id: uuid.UUID,
    path: str,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Step 2 (and every subsequent view, including by new/reconnecting participants) for
    either a whiteboard image/document or a presentation deck's PDF bytes: any active room
    participant may resolve a short-lived signed URL for a board asset -- viewing is not
    restricted to editors, only adding new assets is (see the upload-url endpoint above).
    `path` is validated as a well-formed object under this room's own namespace
    (`AttachmentsService.path_belongs_to_room`) before ever being sent to Storage, so a caller
    can't probe an arbitrary path across rooms."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_access_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    if not attachments_service.path_belongs_to_room(path, room.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid whiteboard asset path")
    try:
        # Longer-lived than the chat-attachment default (attachment_download_url_expires_in,
        # 300s): a board image is meant to stay visible for the whole session, not just a
        # single message view. The Excalidraw board (useExcalidrawSync) downloads the bytes
        # once through this URL and keeps them in memory, so expiry only matters for that
        # first fetch.
        result = await attachments_service.create_signed_download_url(path, expires_in=WHITEBOARD_ASSET_URL_EXPIRES_IN)
    except AttachmentServiceNotConfigured as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Attachment storage is not configured") from exc
    except AttachmentStorageError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return DownloadUrlResponse(**result)


@router.put("/{room_id}/presentation", response_model=StudyRoomResponse)
async def update_presentation_state(
    room_id: uuid.UUID,
    state: dict | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session)
):
    """Persists the shared "Slide Bài giảng" deck's current state --
    `{asset_path, file_name, page, page_count}` (the uploaded PDF's storage path from the
    upload-url endpoint above, plus which page everyone should be looking at) or `None` to
    clear the deck. Same authorization and persistence role as the whiteboard PUT: the live,
    near-instant page-turn sync happens over the LiveKit data channel
    (usePresentationSync.ts), this is the durable fallback new/reconnecting participants load
    from. Reuses `can_edit_whiteboard` -- host/moderator authority over the board is the same
    whether the content is freehand drawing or a presentation deck, not two separate roles."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_edit_whiteboard(session, room, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the host or a moderator can control this study room's presentation"
        )
    try:
        room.presentation_state = state
        await session.commit()
        await session.refresh(room)
        return room
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not update presentation state: {str(e)}"
        )


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Soft delete: the StudyRoom row, its Conversation, all historical Messages,
    StudyRoomMembers, RoomModerationActions and room tasks remain in the database, so
    achievements computed from them are unaffected. An already-deleted or missing room both 404
    via _get_active_room_or_404. Only the group owner or the room's host may delete it (the
    host only while still an active group member -- see permissions.room_rank)."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_manage_room(session, room, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the group owner or the room host can delete this study room"
        )
    try:
        # deleted_by always comes from the authenticated caller, never a client-supplied
        # value -- there is no such field on this endpoint's request at all.
        await service.soft_delete(session, room, deleted_by=current_user.id)
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not delete study room: {str(e)}"
        )

    # LiveKit is a separate live system with no transactional relationship to the DB: the soft
    # delete is already durable, so a close_room failure here is logged, never surfaced as a
    # failure of the delete itself. close_room is idempotent for "already gone".
    try:
        await livekit_service.close_room(room.id)
    except Exception:
        logger.exception("Failed to close LiveKit room for deleted study room %s", room.id)


# --- Memberships ---


@router.post("/{room_id}/join", response_model=StudyRoomMemberResponse)
async def join_room(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session)
):
    """Join a study room as a participant. Requires active membership in the room's group."""
    room = await _get_active_room_or_404(session, room_id)
    if not can_join_room(room):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This study room has ended")
    # Deliberately NOT can_access_room() here -- that also requires an active Room membership,
    # which a first-time joiner doesn't have yet (chicken-and-egg). Join's own prerequisite is
    # just current active Group membership (2026-08-18 parity fix, mirrors the same check
    # can_access_room applies for ongoing participation) -- a left/banned/inactive Group member
    # must not be able to join or rejoin a room under that group.
    if not await is_active_group_member(session, room.group_id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an active group member can join this study room")
    # Private room: a first-time joiner must come in through an invitation code
    # (invitation_router._join_target); only managers and existing members may join directly.
    if not await can_view_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This study room is private -- join with an invitation code")

    # Check existing membership. The joining identity is always the caller --
    # never a client-supplied user_id. A first join is always PARTICIPANT; a rejoin keeps the
    # role the row already has (so the host stays host). No self-assigning roles here.
    group_id = room.group_id  # Preserve before rollback expires ORM fields.
    member = await service.get_member(session, room_id, current_user.id)
    try:
        if member:
            updated = await service.rejoin(session, member)
        else:
            updated = await service.join(session, room_id, current_user.id)
        await session.commit()
        return updated
    except IntegrityError as exc:
        await session.rollback()
        # Two first-time joins by the same account can both see no membership.
        # The unique (room_id,user_id) index correctly admits only one insert;
        # the losing request should return the winning active membership, not 400.
        constraint = getattr(getattr(exc.orig, 'diag', None), 'constraint_name', None)
        if constraint == 'study_room_members_room_id_user_id_key':
            winner = await service.get_member(session, room_id, current_user.id)
            if (winner is not None and winner.left_at is None
                    and await is_active_group_member(session, group_id, current_user.id)):
                return StudyRoomMemberResponse.model_validate(winner)
            raise HTTPException(status.HTTP_409_CONFLICT, 'Membership changed during join; please retry') from exc
        logger.exception('Unexpected integrity error joining study room %s', room_id)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, 'Could not join study room') from exc
    except Exception as exc:
        await session.rollback()
        logger.exception('Failed joining study room %s', room_id)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, 'Could not join study room') from exc


@router.post("/{room_id}/leave", response_model=StudyRoomMemberResponse)
async def leave_room(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    expected_joined_at: datetime | None = None,
    disconnect_livekit: bool = False,
    client_session_id: uuid.UUID | None = None,
):
    """Leave current membership, with optional generation-safe explicit leave.

    Legacy leave without generation still evicts LiveKit. A conditional pagehide
    leave must not evict the replacement session; an explicit generation-safe
    leave can opt in to LiveKit eviction only after the conditional update won.
    """
    # A deleted room must behave as if it no longer exists here too -- the soft-delete
    # invariant (deleted_at set -> normal operations stop) applies to leave just like every
    # other mutation, even though leaving only touches the caller's own membership row.
    await _get_active_room_or_404(session, room_id)
    member = await service.get_member(session, room_id, current_user.id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership not found"
        )
    if settings.meeting_session_required and client_session_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A media session identifier is required to leave this room"
        )
    # A stale tab closing/reloading must not revoke another tab's newly
    # claimed media session. Older clients remain supported on the legacy API
    # until strict session rollout is enabled for all deployed clients.
    if client_session_id is not None and not await meeting_session_service.is_owner(
        room_id, current_user.id, client_session_id
    ):
        return StudyRoomMemberResponse.model_validate(member)
    try:
        if expected_joined_at is not None:
            # Atomic compare-and-leave: prevents a new join that commits after the
            # membership read from being overwritten by an old tab's pagehide.
            closed_at = await service.leave_if_join_generation(
                session, room_id, current_user.id, expected_joined_at
            )
            if closed_at is None:
                # Keep a detached response snapshot before rollback expires ORM fields.
                # A stale leave from another tab must not trigger MissingGreenlet.
                response = StudyRoomMemberResponse.model_validate(member)
                await session.rollback()
                return response
            # Build the DTO before committing: validation errors must not turn a
            # committed leave into an apparent request failure.
            response = StudyRoomMemberResponse.model_validate(member).model_copy(
                update={'left_at': closed_at}
            )
            await session.commit()
            if disconnect_livekit:
                # The same user can rejoin in another tab. A generation mismatch
                # above never reaches this path and cannot kick a newer session.
                try:
                    await livekit_service.remove_participant(room_id, current_user.id)
                except Exception:
                    logger.exception('Could not disconnect LiveKit participant after generation-safe leave')
            return response
        updated = await service.leave(session, member)
        await session.commit()
        # Only deliberate leave evicts by LiveKit identity. Delayed background
        # cleanup does not reach this block and cannot kick a replacement session.
        try:
            await livekit_service.remove_participant(room_id, current_user.id)
        except Exception:
            logger.exception('Could not disconnect LiveKit participant after study-room leave')
        return updated
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not leave study room: {str(e)}"
        )


@router.get("/{room_id}/presence", response_model=list[StudyRoomMemberResponse])
async def get_room_presence(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """LiveKit-confirmed participants visible to the caller, NOT membership.

    A saved study_room_members row, even with left_at=NULL, never counts as
    somebody in the call. Use this endpoint only for real-time presence UI.
    A broken LiveKit API means UNKNOWN (503), never a fabricated empty room.
    """
    room = await _get_active_room_or_404(session, room_id)
    if not await can_view_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    try:
        connected = await livekit_service.connected_user_ids(room_id)
    except Exception as exc:
        logger.exception("LiveKit room presence unavailable for %s", room_id)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Room presence temporarily unavailable") from exc
    if not connected:
        return []
    # Preserve canonical user/profile/role payload and permissions from the DB,
    # but never infer online-ness from DB membership alone.
    members = await service.list_members(session, room_id)
    return [member for member in members if member.user_id in connected]


@router.get("/{room_id}/members", response_model=list[StudyRoomMemberResponse])
async def list_members(
    room_id: uuid.UUID,
    active_only: bool = False,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session)
):
    """List the members of a study room, optionally filtered to active members only. Gated by
    room visibility (`can_view_room`), not active participation: the group's room card shows
    who is currently inside before the caller joins."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_view_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    if active_only:
        return await service.list_active_members(session, room_id)
    return await service.list_members(session, room_id)


@router.get("/{room_id}/session", response_model=StudyRoomSessionResponse)
async def get_room_session(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Single authority for the caller's membership, independent from the roster.

    The caller may inspect their own state before joining a visible room, but a
    private/unavailable room never leaks its membership or metadata. The backend
    independently checks authorization again when issuing every LiveKit token.
    """
    room = await _get_active_room_or_404(session, room_id)
    if not await can_view_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    member = await service.get_member(session, room_id, current_user.id)
    active = member is not None and member.left_at is None
    return StudyRoomSessionResponse(
        room_id=room.id,
        room_status=room.status,
        member=StudyRoomMemberResponse.model_validate(member) if member is not None else None,
        can_connect=active and can_join_room(room),
    )


_ASSIGNABLE_ROOM_ROLES = {StudyRoomMemberRole.PARTICIPANT, StudyRoomMemberRole.EDITOR}


@router.put("/{room_id}/members/{user_id}/role", response_model=StudyRoomMemberResponse)
async def update_member_role(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    role: StudyRoomMemberRole,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session)
):
    """Grant (role=editor) or revoke (role=participant) drawing rights. The caller must be the
    group owner, the room host or a group moderator AND strictly outrank the target -- so a
    moderator can never touch another moderator, the host or the owner. HOST is not assignable
    here: use POST /{room_id}/host to hand the room over."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_moderate_room(session, room, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the group owner, the room host or a group moderator can change drawing rights"
        )
    if role not in _ASSIGNABLE_ROOM_ROLES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only drawing rights can be changed here; use host transfer to change the host"
        )
    member = await service.get_member(session, room_id, user_id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership not found"
        )
    if member.role == StudyRoomMemberRole.HOST:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The room host always has drawing rights")
    if not await can_act_on_member(session, room, current_user.id, user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You can only change drawing rights for members ranked below you"
        )
    try:
        updated = await service.update_member_role(session, member, role)
        await session.commit()
        return updated
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not update member role: {str(e)}"
        )


@router.post("/{room_id}/host", response_model=StudyRoomMemberResponse)
async def transfer_host(
    room_id: uuid.UUID,
    data: TransferHostRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Hand the room's host role to someone currently inside the room. Only the group owner or
    the current host may do this; the previous host becomes a participant. Keeps the invariant
    of exactly one host per room."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_manage_room(session, room, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the group owner or the room host can transfer the host role"
        )
    new_host = await service.get_member(session, room_id, data.user_id)
    if new_host is None or new_host.left_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The new host must be inside the room")
    if new_host.role == StudyRoomMemberRole.HOST:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This member is already the host")
    if not await is_active_group_member(session, room.group_id, data.user_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The new host must be an active group member")
    current_host = await service.get_host_member(session, room_id)
    try:
        updated = await service.transfer_host(session, room, current_host, new_host)
        await session.commit()
        return updated
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not transfer host: {str(e)}")


# --- Moderation ---


@router.post("/{room_id}/moderation", response_model=RoomModerationActionResponse)
async def log_moderation(
    room_id: uuid.UUID,
    data: RoomModerationActionCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session)
):
    """Log a moderation action in a study room (e.g. kick, mute, unmute, raise/lower hand). Self-service hand actions require room access; kick/mute/unmute require the caller to strictly outrank the target (owner > host > group moderator > everyone else)."""
    room = await _get_active_room_or_404(session, room_id)
    # Remotely enabling a microphone is not an administrative right. Historical
    # UNMUTE audit values remain supported in the schema, but new calls must
    # never resume another person's audio without their own action.
    if data.action == ModerationAction.UNMUTE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only the participant can enable their microphone")

    # The acting moderator is always the authenticated caller -- data.moderator_id
    # is client-supplied and never trusted, even though it stays in the DTO for
    # compatibility.
    data = data.model_copy(update={"moderator_id": current_user.id, "room_id": room_id})

    if data.action in _SELF_SERVICE_MODERATION_ACTIONS:
        # RAISE_HAND/LOWER_HAND are self-service only: a member may not raise or
        # lower another participant's hand.
        if data.target_user_id != current_user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only raise or lower your own hand")
        if not await can_access_room(session, room, current_user.id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    else:
        # KICK/MUTE/UNMUTE: the actor must strictly outrank the target (permissions.RoomRank)
        # -- a moderator can't act on another moderator, the host or the owner, and nobody
        # can act on themselves. The caller's own authority is checked before looking the
        # target up, so an unauthorised caller can't probe who is in the room.
        if not await can_moderate_room(session, room, current_user.id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to moderate this study room")
        target_member = await service.get_member(session, room_id, data.target_user_id)
        if target_member is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target is not a member of this study room")
        if target_member.left_at is not None and data.action != ModerationAction.KICK:
            raise HTTPException(status.HTTP_409_CONFLICT, "Target has already left this study room")
        if not await can_act_on_member(session, room, current_user.id, data.target_user_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only moderate members ranked below you")

    try:
        action = await service.log_moderation_action(session, data)
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not log moderation action: {str(e)}"
        )

    # Database state is committed before requesting the external LiveKit side effect.
    # We deliberately report the two outcomes separately instead of claiming the
    # participant was disconnected/muted just because the audit INSERT succeeded.
    # Repeating a kick is safe (LiveKit remove is idempotent) even if the first
    # request timed out after committing the membership revocation.
    media_enforcement = "not_applicable"
    media_error = None
    if data.action == ModerationAction.KICK:
        try:
            await livekit_service.remove_participant(room_id, data.target_user_id)
            media_enforcement = "applied"
        except Exception:
            logger.exception("LiveKit kick enforcement failed: room=%s target=%s", room_id, data.target_user_id)
            media_enforcement = "failed"
            media_error = "Đã thu hồi quyền tham gia phòng, nhưng chưa xác nhận được ngắt cuộc gọi. Vui lòng thử lại."
    elif data.action == ModerationAction.MUTE:
        try:
            applied = await livekit_service.mute_microphone(room_id, data.target_user_id)
            media_enforcement = "applied" if applied else "failed"
            if not applied:
                media_error = "Không tìm thấy micro đang phát của thành viên; chưa tắt micro nào."
        except Exception:
            logger.exception("LiveKit microphone mute failed: room=%s target=%s", room_id, data.target_user_id)
            media_enforcement = "failed"
            media_error = "LiveKit chưa xác nhận tắt micro. Vui lòng kiểm tra kết nối và thử lại."
    # FastAPI response_model serializes the persisted action together with these
    # transient fields; direct callers with an unflushed fake row also work.
    action.media_enforcement = media_enforcement
    action.media_error = media_error
    return action

@router.get("/{room_id}/moderation", response_model=list[RoomModerationActionResponse])
async def list_moderation(
    room_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """List the moderation action history for a study room. Requires access to the room."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_access_room(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    return await service.list_moderation_actions(session, room_id)


# --- Meeting (LiveKit) ---


@router.post("/{room_id}/meeting/claim", response_model=MeetingSessionStatus)
async def claim_meeting_session(
    room_id: uuid.UUID,
    request: MeetingSessionClaim,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Only explicit prejoin action can replace an existing media session.

    Membership and authorization are read from the regular study-room DB.
    State is saved in the coordinator database, NOT study_room_members.
    """
    room = await _get_active_room_or_404(session, room_id)
    if not await can_join_room_meeting(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    await meeting_session_service.claim(room_id, current_user.id, request.client_session_id)
    return MeetingSessionStatus(active=True)


@router.get("/{room_id}/meeting/owner", response_model=MeetingSessionStatus)
async def check_meeting_owner(
    room_id: uuid.UUID,
    client_session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Side-effect-free ownership check for cross-device takeover detection."""
    room = await _get_active_room_or_404(session, room_id)
    if not await can_join_room_meeting(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    owned = await meeting_session_service.is_owner(room_id, current_user.id, client_session_id)
    return MeetingSessionStatus(active=owned)


@router.post(
    "/{room_id}/meeting/token",
    response_model=MeetingTokenResponse,
    response_model_exclude_defaults=True,
)
async def create_meeting_token(
    room_id: uuid.UUID,
    request: MeetingTokenRequest | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Issue a LiveKit access token for an authorized study-room participant.

    Every participant can publish data so room activities (games and shared music) work for
    regular members too. Whiteboard edits remain role-gated by editorIds on receiving clients
    and by can_edit_whiteboard on the persistence and asset endpoints.
    """
    room = await _get_active_room_or_404(session, room_id)
    if not await can_join_room_meeting(session, room, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this study room"
        )

    if request is None:
        if settings.meeting_session_required:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Media session ID is required")
    else:
        if not await meeting_session_service.is_owner(
            room_id, current_user.id, request.client_session_id
        ):
            # Crucially a refresh never claims ownership. The older tab cannot
            # reacquire a LiveKit identity just by pressing Retry.
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Media session was transferred to another tab or device"
            )

    # Canonical display-name fallback hierarchy (display_name -> username -> None, never a
    # raw id/email) -- LiveKit's own SDK-level fallback (bare `identity`, a UUID) only
    # applies if this is None too; see MeetingVideoGrid.tsx for the final generic-label step.
    profile = await profiles_service.get_by_id(session, current_user.id)
    participant_name = (profile.display_name or profile.username) if profile else None

    token = livekit_service.create_participant_token(
        room_id=room.id, identity=current_user.id, name=participant_name, can_publish_data=True
    )
    return MeetingTokenResponse(
        server_url=settings.livekit_url, participant_token=token,
        captions_available=settings.live_captions_available,
    )


@router.get("/{room_id}/meeting/captions", response_class=StreamingResponse)
async def stream_meeting_captions(
    room_id: uuid.UUID,
    client_session_id: uuid.UUID,
    participant_sid: str = Query(min_length=1, max_length=128),
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session, scope="function"),
):
    """Only the current call session can open a live caption stream."""
    if not settings.live_captions_available:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Live captions are unavailable")
    room = await _get_active_room_or_404(session, room_id)
    if not await can_join_room_meeting(session, room, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this study room")
    if not await meeting_session_service.is_owner(room_id, current_user.id, client_session_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Media session was transferred to another tab or device")

    async def lines():
        events = live_caption_service.events(room_id, str(current_user.id), participant_sid)
        async with aclosing(events):
            async for event in events:
                yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"},
    )
