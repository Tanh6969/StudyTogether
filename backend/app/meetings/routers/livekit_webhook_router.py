"""LiveKit -> backend webhook: closes study-room membership on *passive* disconnects.

The browser's `pagehide` leave (useStudyRoom.ts) never fires when a phone kills a
backgrounded tab, the network drops, or the browser crashes -- the user is gone from
the call but `study_room_members.left_at` stays NULL forever. LiveKit does notice
(its own reconnect window expires) and reports `participant_left`; this endpoint turns
that into the same generation-safe leave the browser would have sent.

Safety rules, in order:
- Only signed events (WebhookReceiver checks the JWT + body sha256) are trusted.
- Disconnects the backend itself caused or that mean "still in the call elsewhere"
  are ignored: DUPLICATE_IDENTITY (another tab/device took over), MIGRATION,
  PARTICIPANT_REMOVED (our own leave/kick), ROOM_DELETED / ROOM_CLOSED (room end/delete).
- After a grace period LiveKit is asked again: if the identity is connected (a quick
  reconnect), nothing happens. If LiveKit can't be reached, nothing happens either.
- Only the membership generation that existed when this LiveKit session started is
  closed (`leave_if_join_generation`), so a newer rejoin is never overwritten.

Configure in LiveKit Cloud -> Settings -> Webhooks: `<API base>/livekit/webhook`,
signed with the same API key as LIVEKIT_API_KEY.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from livekit.protocol.models import DisconnectReason

from app.core.config import settings
from app.core.permissions import can_join_room_meeting
from app.db.session import async_session_factory
from app.meetings.services import meeting_capture_store, meeting_recording_service
from app.meetings.services.live_caption_service import live_caption_service
from app.meetings.services.livekit_service import LiveKitService, parse_study_room_livekit_name
from app.study_rooms.services.study_room_service import StudyRoomsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/livekit", tags=["LiveKit"])
study_rooms_service = StudyRoomsService()
livekit_service = LiveKitService()

IGNORED_DISCONNECT_REASONS = frozenset({
    DisconnectReason.DUPLICATE_IDENTITY,
    DisconnectReason.MIGRATION,
    DisconnectReason.PARTICIPANT_REMOVED,
    DisconnectReason.ROOM_DELETED,
    DisconnectReason.ROOM_CLOSED,
})
# LiveKit's clock and the database's clock are different machines.
CLOCK_SKEW_TOLERANCE = timedelta(seconds=5)


def _participant_joined_at(participant) -> datetime | None:
    if participant.joined_at_ms:
        return datetime.fromtimestamp(participant.joined_at_ms / 1000, tz=timezone.utc)
    if participant.joined_at:
        return datetime.fromtimestamp(participant.joined_at, tz=timezone.utc)
    return None


async def close_membership_after_passive_disconnect(
    room_id: uuid.UUID, user_id: uuid.UUID, participant_joined_at: datetime | None
) -> bool:
    """Returns True only when a membership row was actually closed."""
    grace = settings.livekit_webhook_leave_grace_seconds
    if grace > 0:
        await asyncio.sleep(grace)
    try:
        if await livekit_service.is_participant_connected(room_id, user_id):
            logger.info("LiveKit webhook: %s reconnected to room %s, membership kept", user_id, room_id)
            return False
    except Exception:
        logger.exception("LiveKit webhook: presence re-check failed for room %s; membership kept", room_id)
        return False

    async with async_session_factory() as session:
        try:
            member = await study_rooms_service.get_member(session, room_id, user_id)
            if member is None or member.left_at is not None:
                return False
            if (
                participant_joined_at is not None
                and member.joined_at > participant_joined_at + CLOCK_SKEW_TOLERANCE
            ):
                # The user re-joined the room after this LiveKit session began; the
                # departed session belongs to an older membership generation.
                return False
            closed_at = await study_rooms_service.leave_if_join_generation(
                session, room_id, user_id, member.joined_at
            )
            if closed_at is None:
                await session.rollback()
                return False
            await session.commit()
            logger.info("LiveKit webhook: closed membership of %s in room %s after passive disconnect",
                        user_id, room_id)
            return True
        except Exception:
            await session.rollback()
            logger.exception("LiveKit webhook: could not close membership in room %s", room_id)
            return False


async def _observe_join(room_id: uuid.UUID, livekit_sid: str, user_id: uuid.UUID) -> bool:
    async with async_session_factory() as session:
        room = await study_rooms_service.get_by_id(session, room_id)
        if room is None or not await can_join_room_meeting(session, room, user_id):
            return False
    current_sid, participants = await livekit_service.meeting_presence(room_id)
    if current_sid != livekit_sid or user_id not in participants:
        return False
    await meeting_capture_store.observe(room_id, livekit_sid, {user_id})
    if settings.live_captions_available:
        live_caption_service.ensure_room(room_id)
    return True


@router.post("/webhook", include_in_schema=False)
async def livekit_webhook(request: Request, background_tasks: BackgroundTasks):
    body = (await request.body()).decode("utf-8")
    auth_token = request.headers.get("Authorization", "")
    if auth_token.lower().startswith("bearer "):
        auth_token = auth_token[7:]
    if not auth_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing webhook signature")
    try:
        event = livekit_service.webhook_receiver().receive(body, auth_token)
    except Exception:
        logger.warning("LiveKit webhook: rejected event with invalid signature")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook signature")

    if settings.meeting_capture_available:
        if event.event in {"egress_started", "egress_updated", "egress_ended"} and settings.meeting_recording_available:
            await meeting_recording_service.accept_egress_update(event.egress_info)
            return {"status": "processed"}
        room_id = parse_study_room_livekit_name(event.room.name)
        if room_id is not None and event.room.sid:
            if event.event == "room_finished":
                live_caption_service.finish_room(room_id, event.room.sid)
                await meeting_capture_store.finish(room_id, event.room.sid)
                return {"status": "processed"}
            if event.event == "participant_joined":
                try:
                    user_id = uuid.UUID(event.participant.identity)
                except ValueError:
                    return {"status": "ignored"}
                observed = await _observe_join(room_id, event.room.sid, user_id)
                return {"status": "processed" if observed else "ignored"}

    # Answer LiveKit immediately; the presence grace-period re-check runs after the response.
    if event.event != "participant_left":
        return {"status": "ignored"}
    room_id = parse_study_room_livekit_name(event.room.name)
    try:
        user_id = uuid.UUID(event.participant.identity)
    except ValueError:
        user_id = None
    if room_id is None or user_id is None:
        return {"status": "ignored"}
    if event.participant.disconnect_reason in IGNORED_DISCONNECT_REASONS:
        return {"status": "ignored"}

    background_tasks.add_task(
        close_membership_after_passive_disconnect,
        room_id,
        user_id,
        _participant_joined_at(event.participant),
    )
    return {"status": "scheduled"}
