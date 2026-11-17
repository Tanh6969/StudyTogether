import uuid
from enum import IntEnum

from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.entities.channel_entity import Channel
from app.channels.services.channel_service import ChannelsService
from app.conversations.entities.conversation_entity import Conversation
from app.conversations.services.conversation_service import ConversationsService
from app.db.enums import (
    ConversationType,
    GroupMemberRole,
    MemberStatus,
    ProfileRole,
    StudyRoomMemberRole,
    StudyRoomStatus,
)
from app.groups.entities.group_entity import Group
from app.groups.services.group_service import GroupsService
from app.profiles.services.profile_service import ProfilesService
from app.study_rooms.entities.study_room_entity import StudyRoom
from app.study_rooms.services.study_room_service import StudyRoomsService

channels_service = ChannelsService()
groups_service = GroupsService()
study_rooms_service = StudyRoomsService()
conversations_service = ConversationsService()
profiles_service = ProfilesService()


async def is_forum_moderator(session: AsyncSession, user_id: uuid.UUID) -> bool:
    profile = await profiles_service.get_by_id(session, user_id)
    return profile is not None and profile.role in (ProfileRole.MODERATOR, ProfileRole.ADMIN)


async def is_admin(session: AsyncSession, user_id: uuid.UUID) -> bool:
    profile = await profiles_service.get_by_id(session, user_id)
    return profile is not None and profile.role == ProfileRole.ADMIN


async def is_active_group_member(session: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    member = await groups_service.get_member(session, group_id, user_id)
    return member is not None and member.status == MemberStatus.ACTIVE


async def is_group_manager(session: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    member = await groups_service.get_member(session, group_id, user_id)
    return (
        member is not None
        and member.status == MemberStatus.ACTIVE
        and member.role in (GroupMemberRole.OWNER, GroupMemberRole.MODERATOR)
    )


async def is_group_owner(session: AsyncSession, group: Group, user_id: uuid.UUID) -> bool:
    """Owner-only authority (group update/delete, member role changes, ban/reactivate/remove).
    `groups.owner_id` alone is not enough: the owner must also still hold an ACTIVE membership.
    Without that check an owner who had left the group kept full owner powers from outside it.
    The owner can no longer leave without handing the group to a successor (see
    group_router.leave_as_owner), so this only matters for legacy rows."""
    if group.owner_id != user_id:
        return False
    return await is_active_group_member(session, group.id, user_id)


async def can_access_channel(session: AsyncSession, channel: Channel, user_id: uuid.UUID) -> bool:
    """Mirrors the `can_access_channel` RLS helper used by Supabase policies (see
    `public.can_access_channel` in docs/db/migrations/004_refactor_chat_to_conversations.sql
    § 8, updated by 009_soft_delete_channels.sql): private channels grant access to an
    explicit `channel_members` row OR group-manager authority (owner/moderator), not
    membership alone. The manager branch matters because channel creation never inserts the
    creator into `channel_members` -- without it, a manager who just created a private
    channel would be locked out of their own channel.

    A soft-deleted channel (deleted_at set) is denied outright, before any other check --
    this must hold for every caller, including an active group owner/moderator, so a deleted
    channel behaves as if it no longer exists for everyone (see
    docs/db/STUDY_PLATFORM_DATABASE_SPEC.md § 9)."""
    if channel.deleted_at is not None:
        return False
    if not await is_active_group_member(session, channel.group_id, user_id):
        return False
    if channel.is_private:
        if await is_group_manager(session, channel.group_id, user_id):
            return True
        member = await channels_service.get_member(session, channel.id, user_id)
        return member is not None
    return True


async def is_active_room_member(session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """A study room membership row has no `status` column (unlike group_members);
    the only signal for "no longer a participant" -- whether they left voluntarily
    or were kicked (see `can_access_room`) -- is `left_at` being set."""
    member = await study_rooms_service.get_member(session, room_id, user_id)
    return member is not None and member.left_at is None


class RoomRank(IntEnum):
    """Authority inside one study room, highest first. Every room permission is decided by
    comparing ranks, so the rules live in one place:

    * OWNER           -- the group's owner. Always outranks everyone.
    * HOST            -- the room's host (`study_room_members.role = host`; exactly one per
                         room, transferable). Holds it from outside the call too, as long as
                         they are still an active group member.
    * GROUP_MODERATOR -- a moderator of the group.
    * EDITOR          -- a participant who was allowed to draw on the board.
    * PARTICIPANT     -- everyone else in the group.
    * NONE            -- not an active member of the group (or the room is deleted).

    The core rule: kick / mute / revoking drawing rights only ever targets someone with a
    STRICTLY LOWER rank. That is what stops one moderator from acting on another moderator,
    or anyone from acting on the host or the owner."""

    NONE = -1
    PARTICIPANT = 0
    EDITOR = 1
    GROUP_MODERATOR = 2
    HOST = 3
    OWNER = 4


async def room_rank(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> RoomRank:
    if room.deleted_at is not None:
        return RoomRank.NONE
    group_member = await groups_service.get_member(session, room.group_id, user_id)
    if group_member is None or group_member.status != MemberStatus.ACTIVE:
        return RoomRank.NONE
    if group_member.role == GroupMemberRole.OWNER:
        return RoomRank.OWNER
    room_member = await study_rooms_service.get_member(session, room.id, user_id)
    if room_member is not None and room_member.role == StudyRoomMemberRole.HOST:
        return RoomRank.HOST
    if group_member.role == GroupMemberRole.MODERATOR:
        return RoomRank.GROUP_MODERATOR
    if room_member is not None and room_member.role == StudyRoomMemberRole.EDITOR:
        return RoomRank.EDITOR
    return RoomRank.PARTICIPANT


async def can_manage_room(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> bool:
    """Room settings and deletion: the group owner or the room's host."""
    return await room_rank(session, room, user_id) >= RoomRank.HOST


async def can_moderate_room(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> bool:
    """May open the moderation tools at all (kick/mute, drawing rights, room invitations):
    owner, host or group moderator. WHO they may act on is `can_act_on_member`."""
    return await room_rank(session, room, user_id) >= RoomRank.GROUP_MODERATOR


async def can_act_on_member(
    session: AsyncSession, room: StudyRoom, actor_id: uuid.UUID, target_id: uuid.UUID
) -> bool:
    """Kick / mute / unmute / grant or revoke drawing: actor must be at least a group moderator
    AND strictly outrank the target. Never on oneself."""
    if actor_id == target_id:
        return False
    actor = await room_rank(session, room, actor_id)
    if actor < RoomRank.GROUP_MODERATOR:
        return False
    return await room_rank(session, room, target_id) < actor


def can_join_room(room: StudyRoom) -> bool:
    """Lifecycle gate for joining: an ended OR soft-deleted room must not accept new/returning
    participants, even though an ended (but not deleted) room stays readable as history (see
    `can_access_room` / `is_room_conversation_open_for_writes`)."""
    return room.deleted_at is None and room.status != StudyRoomStatus.ENDED


async def can_view_room(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> bool:
    """Visibility of a room (list/detail/presence list) and the prerequisite for joining it
    directly -- weaker than `can_access_room`, which additionally needs an ACTIVE room
    membership. Mirrors the SQL `public.can_access_room` helper (migration 004).

    A private room is visible only to active group owners/moderators and to users who already
    have a `study_room_members` row (the host, or someone who redeemed an invitation code --
    that row survives leaving, so they can come back without a new code). Everyone else must
    redeem an invitation code (invitation_router._join_target), which is never gated by this."""
    if room.deleted_at is not None:
        return False
    if not await is_active_group_member(session, room.group_id, user_id):
        return False
    if not room.is_private:
        return True
    if await is_group_manager(session, room.group_id, user_id):
        return True
    return await study_rooms_service.get_member(session, room.id, user_id) is not None


async def can_access_room(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> bool:
    """Mirrors `can_access_room_conversation` (SQL/RLS, migration 011). Participation requires
    BOTH a CURRENT active Group membership AND an active (non-left) `study_room_members` row --
    `room.host_id` is NOT an independent access grant (2026-08-18 policy change: `host_id`
    identifies the original creator, it does not confer standing authorization -- see
    STUDY_PLATFORM_DATABASE_SPEC.md §16).

    The Group-membership check (2026-08-18 parity fix) matters because a `study_room_members`
    row has no way to expire itself when the user later leaves/is banned from the Group -- there
    is no cascade from Group membership changes to Room memberships (see
    STUDY_PLATFORM_DATABASE_SPEC.md §16). Without it, a user who left or was banned from the
    Group could keep reading/writing this room's chat forever on their stale active Room
    membership alone, even though migration 011 already denies them the same access at the
    SQL/RLS layer (Realtime, direct PostgREST) -- this was a real Python/SQL authorization
    mismatch, not just a theoretical one.

    A still-participating host is unaffected by either check: room creation always inserts an
    active HOST-role `study_room_members` row for the creator in the same transaction (see
    `StudyRoomsService.create`), and the creator was necessarily an active Group member at
    creation time (`create_room` requires `is_group_manager`). Only a host who has since left
    the room, or whose Group membership has since lapsed, loses the access `host_id` alone used
    to grant. Study rooms have no separate "banned" concept -- `RoomModerationAction.KICK` is
    only an audit log entry, so a kicked member is indistinguishable from one who left
    (`left_at` set).

    A soft-deleted room (deleted_at set) is denied outright, before any other check -- this
    must hold for every caller, including the host, so a deleted room behaves as if it no
    longer exists for everyone (mirrors `can_access_channel`, see
    docs/db/migrations/010_soft_delete_study_rooms.sql). This is the single choke point every
    read/write path for room messages, attachments, and meeting tokens goes through (via
    `can_access_conversation`/`can_send_to_conversation`/`can_join_room_meeting`).

    This is participation authority, separate from management authority (`can_manage_room`,
    `is_group_manager`) -- an active Group owner/moderator does NOT bypass this check purely by
    virtue of being a manager; they still need their own active `study_room_members` row like
    any other participant."""
    if room.deleted_at is not None:
        return False
    if not await is_active_group_member(session, room.group_id, user_id):
        return False
    return await is_active_room_member(session, room.id, user_id)


async def can_edit_whiteboard(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> bool:
    """Whiteboard / presentation write authority: anyone ranked EDITOR or above who is
    currently in the room. Plain participants get a live, view-only board. Mirrors
    `whiteboardEditorIds` in the frontend (lib/roomPermissions.ts)."""
    if not await can_access_room(session, room, user_id):
        return False
    return await room_rank(session, room, user_id) >= RoomRank.EDITOR


async def can_join_room_meeting(session: AsyncSession, room: StudyRoom, user_id: uuid.UUID) -> bool:
    """Authorization for issuing a LiveKit meeting join token: same membership check as
    `can_access_room`, plus a lifecycle gate. Deliberately kept separate from
    `can_access_room` -- that helper is also used for historical/read access (e.g. chat
    history), which must keep working after a room ends, whereas a meeting join token must
    not be reissued once the room's live session is over. Mirrors how
    `is_room_conversation_open_for_writes` layers a lifecycle check on top of
    `can_access_conversation` for message writes."""
    if not await can_access_room(session, room, user_id):
        return False
    return room.status != StudyRoomStatus.ENDED


async def is_conversation_member(session: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Direct-conversation membership check. Mirrors the `is_conversation_member` RLS
    helper (migration 004) -- `conversation_members` is the sole source of truth for
    DIRECT access; it is never consulted for CHANNEL/ROOM, which have their own
    membership tables."""
    return await conversations_service.is_member(session, conversation_id, user_id)


async def can_access_conversation(session: AsyncSession, conversation: Conversation, user_id: uuid.UUID) -> bool:
    """Single entry point for read-time message/attachment authorization, dispatching on
    conversation.type. Mirrors the `can_access_conversation` RLS helper.
    """
    if conversation.type == ConversationType.CHANNEL:
        if conversation.channel_id is None:
            return False
        channel = await channels_service.get_by_id(session, conversation.channel_id)
        return channel is not None and await can_access_channel(session, channel, user_id)
    if conversation.type == ConversationType.ROOM:
        if conversation.room_id is None:
            return False
        room = await study_rooms_service.get_by_id(session, conversation.room_id)
        return room is not None and await can_access_room(session, room, user_id)
    if conversation.type == ConversationType.DIRECT:
        return await is_conversation_member(session, conversation.id, user_id)
    return False


async def is_room_conversation_open_for_writes(session: AsyncSession, conversation: Conversation) -> bool:
    """Lifecycle-only check, deliberately separate from membership: an ended study room becomes
    read-only chat history (no new messages, no edits, no deletes) for everyone, including the
    original sender/host. Channel conversations have no such lifecycle gate and always pass.
    Used both by `can_send_to_conversation` (new messages/attachments) and directly by the
    message edit/delete routes, which authorize by sender identity rather than re-checking
    membership -- they only need this lifecycle half of the write check, not the full one."""
    if conversation.type != ConversationType.ROOM or conversation.room_id is None:
        return True
    room = await study_rooms_service.get_by_id(session, conversation.room_id)
    return room is None or room.status != StudyRoomStatus.ENDED


async def can_send_to_conversation(session: AsyncSession, conversation: Conversation, user_id: uuid.UUID) -> bool:
    """Write-time authorization: same membership check as `can_access_conversation`, plus
    any additional lifecycle restriction. An ended study room can still be read by its
    members but no longer accepts new messages/attachments; channel conversations have no
    such lifecycle gate today."""
    if not await can_access_conversation(session, conversation, user_id):
        return False
    return await is_room_conversation_open_for_writes(session, conversation)
