"""Direct LiveKit REST data is presence authority; no DB/in-memory inference."""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from livekit.protocol.models import ParticipantInfo

from app.meetings.services.livekit_service import LiveKitService, study_room_livekit_name


@pytest.mark.asyncio
async def test_connected_users_ignores_unconnected_and_non_app_identities(monkeypatch):
    service = LiveKitService()
    person = uuid.uuid4()
    room = uuid.uuid4()
    api = MagicMock()
    api.__aenter__ = AsyncMock(return_value=api)
    api.__aexit__ = AsyncMock(return_value=None)
    api.room.list_participants = AsyncMock(return_value=SimpleNamespace(participants=[
        SimpleNamespace(identity=str(person), state=ParticipantInfo.State.ACTIVE, sid="PA_member"),
        SimpleNamespace(identity=str(uuid.uuid4()), state=ParticipantInfo.State.JOINING),
        SimpleNamespace(identity="non-app-bot", state=ParticipantInfo.State.ACTIVE),
    ]))
    monkeypatch.setattr(service, "_room_api", lambda: api)
    assert await service.connected_user_ids(room) == {person}
    args = api.room.list_participants.await_args.args[0]
    assert args.room == study_room_livekit_name(room)


@pytest.mark.asyncio
async def test_room_counts_verify_active_human_roster_only_for_existing_rooms(monkeypatch):
    service = LiveKitService()
    first, second = uuid.uuid4(), uuid.uuid4()
    api = MagicMock()
    api.__aenter__ = AsyncMock(return_value=api)
    api.__aexit__ = AsyncMock(return_value=None)
    api.room.list_rooms = AsyncMock(return_value=SimpleNamespace(rooms=[
        SimpleNamespace(name=study_room_livekit_name(first), num_participants=0)
    ]))
    api.room.list_participants = AsyncMock(return_value=SimpleNamespace(participants=[
        SimpleNamespace(identity=str(uuid.uuid4()), state=ParticipantInfo.State.ACTIVE, sid="PA_member"),
        SimpleNamespace(identity="captions-agent", state=ParticipantInfo.State.ACTIVE),
    ]))
    monkeypatch.setattr(service, "_room_api", lambda: api)
    assert await service.connected_counts([first, second]) == {first: 1, second: 0}
    api.room.list_rooms.assert_awaited_once()
    assert set(api.room.list_rooms.await_args.args[0].names) == {
        study_room_livekit_name(first), study_room_livekit_name(second)
    }
    api.room.list_participants.assert_awaited_once()
    assert api.room.list_participants.await_args.args[0].room == study_room_livekit_name(first)
