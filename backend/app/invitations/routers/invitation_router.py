import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.channels.entities.channel_entity import Channel
from app.channels.services.channel_service import ChannelsService
from app.core.config import settings
from app.core.email_service import send_invitation_email
from app.core.permissions import can_join_room, can_moderate_room, is_active_group_member, is_group_manager
from app.db.enums import InvitationMethod, MemberStatus, NotificationType
from app.db.session import get_db_session
from app.groups.entities.group_entity import Group
from app.groups.services.group_service import GroupsService
from app.invitations.dto.invitation_dto import (
    ActiveCodeInfo,
    GroupJoinCodeInfo,
    GroupJoinCodeRotate,
    InvitationCreate,
    InvitationCreated,
    InvitationPreview,
    InvitationRedeemResult,
    InvitationResponse,
    InvitationTarget,
)
from app.invitations.services.group_join_code_service import GroupJoinCodeService
from app.invitations.services.invitation_service import InvitationsService
from app.notifications.dto.notification_dto import NotificationCreate
from app.notifications.services.notification_service import NotificationsService
from app.profiles.services.profile_service import ProfilesService
from app.study_rooms.entities.study_room_entity import StudyRoom
from app.study_rooms.services.study_room_service import StudyRoomsService

router = APIRouter(prefix="/invitations", tags=["Invitations"])
service = InvitationsService()
groups_service = GroupsService()
study_rooms_service = StudyRoomsService()
channels_service = ChannelsService()
notifications_service = NotificationsService()
profiles_service = ProfilesService()
group_codes = GroupJoinCodeService()

_NOTIFICATION_TYPE_BY_TARGET = {
    "group": NotificationType.GROUP_INVITE,
    "study_room": NotificationType.STUDY_ROOM_INVITATION,
    "private_channel": NotificationType.PRIVATE_CHANNEL_INVITATION,
}


async def _load_target(
    session: AsyncSession,
    group_id: uuid.UUID | None,
    room_id: uuid.UUID | None,
    channel_id: uuid.UUID | None,
) -> tuple[str, Group | StudyRoom | Channel, uuid.UUID] | None:
    """Resolves the real target server-side from the invitation's (or request's) FK columns
    -- never trusts anything else about the target. Returns (target_type, entity,
    owning_group_id) or None if the target doesn't exist / is soft-deleted."""
    if group_id is not None:
        group = await groups_service.get_by_id(session, group_id)
        if group is None:
            return None
        return "group", group, group.id
    if room_id is not None:
        room = await study_rooms_service.get_by_id(session, room_id)
        if room is None or room.deleted_at is not None:
            return None
        return "study_room", room, room.group_id
    channel = await channels_service.get_by_id(session, channel_id)
    if channel is None or channel.deleted_at is not None:
        return None
    return "private_channel", channel, channel.group_id


async def _build_target_dto(
    session: AsyncSession, target_type: str, target_entity: Group | StudyRoom | Channel, group_id: uuid.UUID
) -> InvitationTarget:
    if target_type == "group":
        group = target_entity
        return InvitationTarget(type="group", id=group.id, name=group.name, group_id=group.id, group_name=group.name)
    group = await groups_service.get_by_id(session, group_id)
    return InvitationTarget(
        type=target_type,
        id=target_entity.id,
        name=target_entity.name,
        group_id=group_id,
        group_name=group.name if group else "",
    )


async def _join_target(
    session: AsyncSession, target_type: str, target_entity: Group | StudyRoom | Channel, user_id: uuid.UUID
) -> str:
    """Dispatches to the canonical membership service for the target type -- never inserts
    a membership row directly. Returns "joined" | "reactivated" | "already_member"."""
    if target_type == "group":
        group = target_entity
        member = await groups_service.get_member(session, group.id, user_id)
        if member is None:
            await groups_service.add_member(session, group.id, user_id)
            return "joined"
        if member.status == MemberStatus.BANNED:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You are banned from this group")
        if member.status == MemberStatus.LEFT:
            await groups_service.reactivate_member(session, member)
            return "reactivated"
        return "already_member"

    if target_type == "study_room":
        room = target_entity
        if not can_join_room(room):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This study room has ended")
        member = await study_rooms_service.get_member(session, room.id, user_id)
        if member is None:
            await study_rooms_service.join(session, room.id, user_id)
            return "joined"
        if member.left_at is not None:
            await study_rooms_service.rejoin(session, member)
            return "reactivated"
        return "already_member"

    channel = target_entity
    member = await channels_service.get_member(session, channel.id, user_id)
    if member is None:
        await channels_service.add_member(session, channel.id, user_id)
        return "joined"
    return "already_member"


async def _can_manage_invitations(
    session: AsyncSession, target_type: str, target_entity, group_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """Group / private-channel invitations: an active group owner or moderator. Study-room
    invitations: anyone ranked group moderator or above inside that room, which also lets the
    room's host invite people even if they are not a group moderator."""
    if target_type == "study_room":
        return await can_moderate_room(session, target_entity, user_id)
    return await is_group_manager(session, group_id, user_id)


@router.post("/", response_model=InvitationCreated, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    data: InvitationCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Create an invitation (email or code) for a group, study room, or private channel. Requires authentication; only an active owner or moderator of the target's group may create invitations."""
    resolved = await _load_target(session, data.group_id, data.room_id, data.channel_id)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation target not found")
    target_type, target_entity, group_id = resolved

    # Only an active owner/moderator of the target's Group may invite -- plus, for a study
    # room, that room's host (see _can_manage_invitations). Normal members never gain
    # invitation-management power here.
    if not await _can_manage_invitations(session, target_type, target_entity, group_id, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an active group owner or moderator can create invitations for this target",
        )

    try:
        invitation, secret = await service.create(
            session,
            group_id=data.group_id,
            room_id=data.room_id,
            channel_id=data.channel_id,
            method=data.method,
            created_by=current_user.id,
            recipient_email=data.recipient_email,
        )

        if data.method == InvitationMethod.EMAIL:
            target_dto = await _build_target_dto(session, target_type, target_entity, group_id)
            inviter = await profiles_service.get_by_id(session, current_user.id)
            # Canonical display-name fallback hierarchy: display_name -> username -> generic
            # label (never an id/email) -- matches UserSummary-based rendering everywhere else.
            inviter_name = (inviter.display_name or inviter.username) if inviter else None
            inviter_name = inviter_name or "Người dùng"
            link = f"{settings.frontend_base_url.rstrip('/')}/invitations/{secret}"
            ttl_minutes = max(1, settings.invitation_email_ttl_seconds // 60)
            send_invitation_email(data.recipient_email, inviter_name, target_dto.name, link, ttl_minutes)

            # Only decides whether to ALSO create an in-app notification; never returned to
            # the caller, so this cannot be used to probe account existence via this API.
            recipient_user_id = await service.lookup_user_id_by_email(session, data.recipient_email)
            if recipient_user_id is not None:
                await notifications_service.create(
                    session,
                    NotificationCreate(
                        user_id=recipient_user_id,
                        type=_NOTIFICATION_TYPE_BY_TARGET[target_type],
                        actor_id=current_user.id,
                        group_id=group_id,
                        invitation_id=invitation.id,
                    ),
                )

        await session.commit()
        response = InvitationCreated.model_validate(invitation)
        if data.method == InvitationMethod.CODE:
            response.code = secret
        return response
    except HTTPException:
        await session.rollback()
        raise
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not create invitation: {str(e)}")


@router.get("/incoming", response_model=list[InvitationResponse])
async def list_incoming_invitations(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """List pending invitations addressed to the authenticated user's email. Requires authentication."""
    if current_user.email is None:
        return []
    return await service.list_incoming(session, current_user.email.strip().lower())


@router.get("/active-code", response_model=ActiveCodeInfo | None)
async def get_active_code(
    group_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Get the currently active invitation code, if any, for a group, study room, or private channel (exactly one target must be given). Requires authentication; only an active owner or moderator of the target's group may view this."""
    if sum(x is not None for x in (group_id, room_id, channel_id)) != 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Exactly one of group_id, room_id, channel_id is required")
    resolved = await _load_target(session, group_id, room_id, channel_id)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target not found")
    target_type, target_entity, target_group_id = resolved
    if not await _can_manage_invitations(session, target_type, target_entity, target_group_id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an active group owner or moderator can view this")

    invitation = await service.get_active_code_for_target(
        session, group_id=group_id, room_id=room_id, channel_id=channel_id
    )
    if invitation is None:
        return None
    return ActiveCodeInfo(id=invitation.id, expires_at=invitation.expires_at)


# --- Persistent group join code (Teams-style), see GroupJoinCodeService ---


async def _require_group_manager(session: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> Group:
    group = await groups_service.get_by_id(session, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    if not await is_group_manager(session, group_id, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an active group owner or moderator can manage the group code")
    return group


@router.get("/group-code", response_model=GroupJoinCodeInfo)
async def get_group_join_code(
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """The group's persistent join code (null when off). Group owner/moderator only."""
    await _require_group_manager(session, group_id, current_user.id)
    return GroupJoinCodeInfo(code=await group_codes.get_code(session, group_id))


@router.post("/group-code", response_model=GroupJoinCodeInfo)
async def rotate_group_join_code(
    data: GroupJoinCodeRotate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Turn the group code on, or replace it with a new one (the old code stops working). Owner/moderator only."""
    await _require_group_manager(session, data.group_id, current_user.id)
    return GroupJoinCodeInfo(code=await group_codes.rotate(session, data.group_id, current_user.id))


@router.delete("/group-code", status_code=status.HTTP_204_NO_CONTENT)
async def disable_group_join_code(
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Turn joining by group code off. Owner/moderator only."""
    await _require_group_manager(session, group_id, current_user.id)
    await group_codes.disable(session, group_id)


async def _find_group_by_code(session: AsyncSession, secret: str) -> tuple[Group, uuid.UUID | None] | None:
    """(group, code creator) for a valid group join code, else None."""
    found = await group_codes.find(session, secret)
    if found is None:
        return None
    group = await groups_service.get_by_id(session, found.group_id)
    return (group, found.created_by) if group is not None else None


async def _inviter_name(session: AsyncSession, user_id: uuid.UUID | None) -> str:
    # Canonical display-name fallback hierarchy: display_name -> username -> generic label
    # (never an id/email) -- matches UserSummary-based rendering everywhere else.
    inviter = await profiles_service.get_by_id(session, user_id) if user_id else None
    name = (inviter.display_name or inviter.username) if inviter else None
    return name or "Người dùng"


@router.get("/resolve/{secret}", response_model=InvitationPreview)
async def resolve_invitation(secret: str, session: AsyncSession = Depends(get_db_session)):
    """Public (no auth required) -- an unauthenticated recipient must be able to see who
    invited them and to what before logging in. Never distinguishes expired vs revoked vs
    already-used vs unknown secret -- all look identical from the outside.
    Also accepts a group's persistent join code (same entry form for both kinds of code)."""
    invitation = await service.get_by_secret(session, secret)
    if invitation is None or not service.is_pending_and_unexpired(invitation):
        by_code = await _find_group_by_code(session, secret)
        if by_code is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found or no longer valid")
        group, code_creator = by_code
        return InvitationPreview(
            id=group.id,
            target=await _build_target_dto(session, "group", group, group.id),
            inviter_name=await _inviter_name(session, code_creator),
            method=InvitationMethod.CODE,
            expires_at=None,
        )

    resolved = await _load_target(session, invitation.group_id, invitation.room_id, invitation.channel_id)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found or no longer valid")
    target_type, target_entity, group_id = resolved

    target_dto = await _build_target_dto(session, target_type, target_entity, group_id)
    inviter = await profiles_service.get_by_id(session, invitation.created_by)
    # Canonical display-name fallback hierarchy: display_name -> username -> generic label
    # (never an id/email) -- matches UserSummary-based rendering everywhere else.
    inviter_name = (inviter.display_name or inviter.username) if inviter else None
    inviter_name = inviter_name or "Người dùng"
    return InvitationPreview(
        id=invitation.id,
        target=target_dto,
        inviter_name=inviter_name,
        method=invitation.method,
        expires_at=invitation.expires_at,
    )


async def _redeem(session: AsyncSession, invitation, current_user: CurrentUser) -> InvitationRedeemResult:
    """Shared by both redeem entry points (secret-based, for the emailed link / typed code;
    id-based, for the in-app notification's Join button -- see redeem_invitation_by_id).
    Recipient binding for EMAIL invitations is enforced by each caller before this runs."""
    resolved = await _load_target(session, invitation.group_id, invitation.room_id, invitation.channel_id)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation target no longer exists")
    target_type, target_entity, group_id = resolved

    try:
        if target_type != "group" and not await is_active_group_member(session, group_id, current_user.id):
            # Not eligible -- the invitation is NOT consumed and the Group is NOT
            # auto-joined. The frontend uses this outcome to guide the user to the parent
            # Group instead (see docs/db/migrations/013_create_invitations.sql header).
            target_dto = await _build_target_dto(session, target_type, target_entity, group_id)
            return InvitationRedeemResult(outcome="group_membership_required", target=target_dto)

        accepted = await service.try_accept(session, invitation.id)
        if not accepted:
            raise HTTPException(status.HTTP_409_CONFLICT, "Invitation was already used, expired, or revoked")

        outcome = await _join_target(session, target_type, target_entity, current_user.id)
        target_dto = await _build_target_dto(session, target_type, target_entity, group_id)
        await session.commit()
        return InvitationRedeemResult(outcome=outcome, target=target_dto)
    except HTTPException:
        await session.rollback()
        raise
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not redeem invitation: {str(e)}")


async def _join_by_group_code(session: AsyncSession, group: Group, current_user: CurrentUser) -> InvitationRedeemResult:
    """A group join code is reusable, so nothing is consumed -- just join (banned users are
    still refused by _join_target)."""
    try:
        outcome = await _join_target(session, "group", group, current_user.id)
        target_dto = await _build_target_dto(session, "group", group, group.id)
        await session.commit()
        return InvitationRedeemResult(outcome=outcome, target=target_dto)
    except HTTPException:
        await session.rollback()
        raise
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not join group: {str(e)}")


@router.post("/redeem/{secret}", response_model=InvitationRedeemResult)
async def redeem_invitation(
    secret: str,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Secret-based redemption -- the emailed link (/invitations/:secret) and the
    join-by-code entry form both go through this. The secret itself is the credential; no
    separate recipient check is needed for CODE, but EMAIL invitations still require the
    caller's verified email to match (see below)."""
    invitation = await service.get_by_secret(session, secret)
    if invitation is None or not service.is_pending_and_unexpired(invitation):
        by_code = await _find_group_by_code(session, secret)
        if by_code is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found or no longer valid")
        return await _join_by_group_code(session, by_code[0], current_user)

    if invitation.method == InvitationMethod.EMAIL:
        if current_user.email is None or current_user.email.strip().lower() != invitation.recipient_email:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This invitation was sent to a different email address")

    return await _redeem(session, invitation, current_user)


@router.post("/{invitation_id}/redeem", response_model=InvitationRedeemResult)
async def redeem_invitation_by_id(
    invitation_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Id-based redemption for the in-app notification's Join button (see PendingInvitations
    panel) -- the frontend never has the plaintext secret there (it's only ever delivered
    via the emailed link or shown once at code-creation time). EMAIL invitations only: the
    same recipient-email check as secret-based redemption still applies, so knowing an
    invitation's id (only ever visible to its creator or, via the recipient-scoped
    /invitations/incoming list, its actual recipient) is not itself sufficient -- it is not
    a substitute credential. CODE invitations are deliberately NOT reachable this way: they
    have no bound recipient, so allowing id-based redemption would let anyone who merely
    discovers/guesses an id redeem it without ever knowing the code, defeating the point of
    the code being the credential."""
    invitation = await service.get_by_id(session, invitation_id)
    if invitation is None or not service.is_pending_and_unexpired(invitation):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found or no longer valid")
    if (
        invitation.method != InvitationMethod.EMAIL
        or current_user.email is None
        or current_user.email.strip().lower() != invitation.recipient_email
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot redeem this invitation")

    return await _redeem(session, invitation, current_user)


@router.post("/{invitation_id}/decline", response_model=InvitationResponse)
async def decline_invitation(
    invitation_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Decline an email-based invitation. Requires authentication; only the invitation's recipient (matched by verified email) may decline it."""
    invitation = await service.get_by_id(session, invitation_id)
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    if (
        invitation.method != InvitationMethod.EMAIL
        or current_user.email is None
        or current_user.email.strip().lower() != invitation.recipient_email
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot decline this invitation")
    try:
        declined = await service.try_decline(session, invitation.id)
        if not declined:
            raise HTTPException(status.HTTP_409_CONFLICT, "Invitation was already resolved")
        await session.commit()
        await session.refresh(invitation)
        return invitation
    except HTTPException:
        await session.rollback()
        raise
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not decline invitation: {str(e)}")


@router.post("/{invitation_id}/revoke", response_model=InvitationResponse)
async def revoke_invitation(
    invitation_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Revoke a pending invitation before it is used. Requires authentication; only an active owner or moderator of the target's group may revoke it."""
    invitation = await service.get_by_id(session, invitation_id)
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    resolved = await _load_target(session, invitation.group_id, invitation.room_id, invitation.channel_id)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation target no longer exists")
    target_type, target_entity, group_id = resolved
    if not await _can_manage_invitations(session, target_type, target_entity, group_id, current_user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only an active group owner or moderator can revoke this invitation"
        )
    try:
        revoked = await service.try_revoke(session, invitation.id)
        if not revoked:
            raise HTTPException(status.HTTP_409_CONFLICT, "Invitation was already resolved")
        await session.commit()
        await session.refresh(invitation)
        return invitation
    except HTTPException:
        await session.rollback()
        raise
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not revoke invitation: {str(e)}")
