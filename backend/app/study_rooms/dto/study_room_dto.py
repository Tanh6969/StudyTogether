import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.enums import ModerationAction, StudyRoomMemberRole, StudyRoomStatus
from app.profiles.dto.profile_dto import UserSummary


class StudyRoomCreate(BaseModel):
    """No `host_id` field: the room host is always the authenticated caller
    (see StudyRoomsService.create / study_room_router.create_room), never client-supplied."""

    group_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    max_participants: int = Field(default=50, ge=2, le=500)
    is_private: bool = False


class StudyRoomUpdate(BaseModel):
    """No `whiteboard_state`/`presentation_state` fields here, deliberately: this DTO backs
    `PUT /study-rooms/{room_id}`, gated by `is_group_manager` (active group owner/moderator) --
    a weaker, group-scoped check than `can_edit_whiteboard`'s room-scoped host/moderator gate.
    `StudyRoomsService.update()` applies every set field via `model_dump(exclude_unset=True)`
    with no per-field authorization, so a board-content field here would let any group manager
    overwrite the board through this endpoint, bypassing the dedicated
    `/whiteboard` and `/presentation` PUT endpoints' authorization entirely. Board content is
    only ever written through those two endpoints."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    max_participants: int | None = Field(default=None, ge=2, le=500)
    is_private: bool | None = None


class StudyRoomResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID
    name: str
    description: str | None
    host_id: uuid.UUID
    status: StudyRoomStatus
    max_participants: int
    is_private: bool
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    deleted_at: datetime | None
    deleted_by: uuid.UUID | None
    conversation_id: uuid.UUID | None
    whiteboard_state: dict | None = None
    presentation_state: dict | None = None
    # People currently inside the room (study_room_members with left_at NULL). Filled in by
    # the list/detail endpoints; replaces the old waiting/active status as the "live" signal.
    active_member_count: int = 0


class StudyRoomMemberCreate(BaseModel):
    room_id: uuid.UUID
    user_id: uuid.UUID
    role: StudyRoomMemberRole = StudyRoomMemberRole.PARTICIPANT


class StudyRoomMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    user_id: uuid.UUID
    role: StudyRoomMemberRole
    joined_at: datetime
    left_at: datetime | None
    # See GroupMemberResponse.user -- same canonical-identity convention.
    user: UserSummary


class StudyRoomSessionResponse(BaseModel):
    """Authoritative current-user participation; independent from the shared member roster.

    Returning a left member row is intentional: the client can render the lobby without
    confusing a successful GET with permission to access protected room activities.
    """
    room_id: uuid.UUID
    room_status: StudyRoomStatus
    member: StudyRoomMemberResponse | None
    can_connect: bool


class TransferHostRequest(BaseModel):
    user_id: uuid.UUID


class RoomModerationActionCreate(BaseModel):
    room_id: uuid.UUID
    moderator_id: uuid.UUID
    target_user_id: uuid.UUID
    action: ModerationAction
    reason: str | None = None


class RoomModerationActionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    moderator_id: uuid.UUID
    target_user_id: uuid.UUID
    action: ModerationAction
    reason: str | None
    created_at: datetime
