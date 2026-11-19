"""LiveKit participant_left webhook: passive disconnects close study-room membership."""
import base64
import hashlib
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from google.protobuf.json_format import MessageToJson
from livekit.api import AccessToken
from livekit.protocol.models import DisconnectReason, ParticipantInfo, Room
from livekit.protocol.webhook import WebhookEvent

from app.core.config import settings
from app.meetings.routers import livekit_webhook_router as webhook
from app.meetings.services.livekit_service import parse_study_room_livekit_name, study_room_livekit_name


def _event_body(room_id, user_id, reason=DisconnectReason.SIGNAL_CLOSE, event="participant_left",
                joined_at_ms=None) -> str:
    return MessageToJson(WebhookEvent(
        event=event,
        id="EV_test",
        created_at=int(time.time()),
        room=Room(name=study_room_livekit_name(room_id)),
        participant=ParticipantInfo(
            identity=str(user_id),
            disconnect_reason=reason,
            joined_at_ms=joined_at_ms or int(time.time() * 1000),
        ),
    ))


def _signed_headers(body: str, secret: str | None = None) -> dict[str, str]:
    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    token = AccessToken(settings.livekit_api_key, secret or settings.livekit_api_secret).with_sha256(digest)
    return {"Authorization": token.to_jwt(), "Content-Type": "application/webhook+json"}


@pytest.fixture
def scheduled(monkeypatch):
    task = AsyncMock(return_value=True)
    monkeypatch.setattr(webhook, "close_membership_after_passive_disconnect", task)
    return task


def test_parse_study_room_livekit_name_round_trip():
    room_id = uuid.uuid4()
    assert parse_study_room_livekit_name(study_room_livekit_name(room_id)) == room_id
    assert parse_study_room_livekit_name("other-room") is None
    assert parse_study_room_livekit_name("study-room-not-a-uuid") is None


async def test_unsigned_or_forged_webhook_is_rejected(async_client, scheduled):
    body = _event_body(uuid.uuid4(), uuid.uuid4())
    missing = await async_client.post("/livekit/webhook", content=body)
    forged = await async_client.post(
        "/livekit/webhook", content=body, headers=_signed_headers(body, secret="x" * 40)
    )
    tampered = await async_client.post(
        "/livekit/webhook", content=body.replace("SIGNAL_CLOSE", "CONNECTION_TIMEOUT"),
        headers=_signed_headers(body),
    )
    assert (missing.status_code, forged.status_code, tampered.status_code) == (401, 401, 401)
    scheduled.assert_not_awaited()


async def test_passive_disconnect_schedules_membership_cleanup(async_client, scheduled):
    room_id, user_id = uuid.uuid4(), uuid.uuid4()
    body = _event_body(room_id, user_id, reason=DisconnectReason.CONNECTION_TIMEOUT)
    response = await async_client.post("/livekit/webhook", content=body, headers=_signed_headers(body))
    assert response.status_code == 200
    assert response.json() == {"status": "scheduled"}
    args = scheduled.await_args.args
    assert args[0] == room_id and args[1] == user_id and isinstance(args[2], datetime)


@pytest.mark.parametrize("reason", sorted(webhook.IGNORED_DISCONNECT_REASONS))
async def test_backend_caused_or_takeover_disconnects_are_ignored(async_client, scheduled, reason):
    body = _event_body(uuid.uuid4(), uuid.uuid4(), reason=reason)
    response = await async_client.post("/livekit/webhook", content=body, headers=_signed_headers(body))
    assert response.json() == {"status": "ignored"}
    scheduled.assert_not_awaited()


async def test_other_events_and_foreign_identities_are_ignored(async_client, scheduled):
    joined = _event_body(uuid.uuid4(), uuid.uuid4(), event="participant_joined")
    foreign = _event_body(uuid.uuid4(), "egress-bot")
    for body in (joined, foreign):
        response = await async_client.post("/livekit/webhook", content=body, headers=_signed_headers(body))
        assert response.json() == {"status": "ignored"}
    scheduled.assert_not_awaited()


# --- the delayed cleanup itself ---


class _FakeSessionFactory:
    def __init__(self, session):
        self.session = session

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def cleanup_env(monkeypatch):
    monkeypatch.setattr(settings, "livekit_webhook_leave_grace_seconds", 0)
    session = AsyncMock()
    monkeypatch.setattr(webhook, "async_session_factory", _FakeSessionFactory(session))
    member = MagicMock(left_at=None, joined_at=datetime.now(timezone.utc) - timedelta(minutes=5))
    env = MagicMock(session=session, member=member)
    env.connected = AsyncMock(return_value=False)
    env.get_member = AsyncMock(return_value=member)
    env.leave = AsyncMock(return_value=datetime.now(timezone.utc))
    monkeypatch.setattr(webhook.livekit_service, "is_participant_connected", env.connected)
    monkeypatch.setattr(webhook.study_rooms_service, "get_member", env.get_member)
    monkeypatch.setattr(webhook.study_rooms_service, "leave_if_join_generation", env.leave)
    return env


async def test_cleanup_closes_the_departed_membership_generation(cleanup_env):
    room_id, user_id = uuid.uuid4(), uuid.uuid4()
    closed = await webhook.close_membership_after_passive_disconnect(
        room_id, user_id, datetime.now(timezone.utc) - timedelta(minutes=4)
    )
    assert closed is True
    cleanup_env.leave.assert_awaited_once_with(
        cleanup_env.session, room_id, user_id, cleanup_env.member.joined_at
    )
    cleanup_env.session.commit.assert_awaited_once()


async def test_cleanup_keeps_membership_when_user_reconnected(cleanup_env):
    cleanup_env.connected.return_value = True
    assert await webhook.close_membership_after_passive_disconnect(uuid.uuid4(), uuid.uuid4(), None) is False
    cleanup_env.leave.assert_not_awaited()


async def test_cleanup_keeps_membership_when_livekit_unreachable(cleanup_env):
    cleanup_env.connected.side_effect = RuntimeError("LiveKit down")
    assert await webhook.close_membership_after_passive_disconnect(uuid.uuid4(), uuid.uuid4(), None) is False
    cleanup_env.leave.assert_not_awaited()


async def test_cleanup_never_closes_a_newer_rejoin(cleanup_env):
    # Membership began well after the LiveKit session that just ended.
    cleanup_env.member.joined_at = datetime.now(timezone.utc)
    stale_session_start = datetime.now(timezone.utc) - timedelta(minutes=10)
    assert await webhook.close_membership_after_passive_disconnect(
        uuid.uuid4(), uuid.uuid4(), stale_session_start
    ) is False
    cleanup_env.leave.assert_not_awaited()


async def test_cleanup_is_idempotent_for_already_left_member(cleanup_env):
    cleanup_env.member.left_at = datetime.now(timezone.utc)
    assert await webhook.close_membership_after_passive_disconnect(uuid.uuid4(), uuid.uuid4(), None) is False
    cleanup_env.leave.assert_not_awaited()
