"""Capture data and recording lifecycle against a disposable local PostgreSQL."""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

import pytest
from livekit import api
from sqlalchemy import text

from app.core.config import settings
from app.meetings.services import meeting_capture_store as store
from app.meetings.services import meeting_recording_service as recording_service
from app.meetings.services.livekit_service import study_room_livekit_name
from app.meetings.services.meeting_session_service import MeetingSessionService


@pytest.fixture
async def capture_database(monkeypatch):
    url = os.getenv("MEETING_SESSION_DATABASE_URL", "")
    parsed = urlsplit(url)
    if parsed.hostname != "127.0.0.1" or parsed.port != 6544:
        pytest.skip("Requires disposable PostgreSQL on 127.0.0.1:6544 with migrations 011 and 016")
    monkeypatch.setattr(settings, "meeting_session_database_url", url)
    database = MeetingSessionService()
    monkeypatch.setattr(store, "meeting_session_service", database)
    room = uuid.uuid4()
    try:
        yield room
    finally:
        async with database._db().begin() as connection:
            await connection.execute(text("DELETE FROM meeting_internal.capture WHERE room_id = :room"), {"room": room})
        if database._engine is not None:
            await database._engine.dispose()


async def test_transcript_is_isolated_by_call_and_attendance(capture_database):
    room = capture_database
    speaker, listener, outsider = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    now = datetime.now(timezone.utc)
    capture = await store.observe(room, f"RM_{uuid.uuid4().hex}", {speaker, listener})
    other = await store.observe(room, f"RM_{uuid.uuid4().hex}", {outsider})
    line = uuid.uuid4()
    await store.save_line(capture, line, now, "Hà", "Không nộp trước ngày 12.")
    await store.save_line(capture, line, now, "Hà", "Lời thoại trùng không ghi đè.")

    assert await store.read_transcript(room, capture, outsider) is None
    assert await store.read_transcript(room, other, listener) is None
    assert await store.read_transcript(uuid.uuid4(), capture, listener) is None
    assert [item["id"] for item in await store.list_captures(room, listener)] == [capture]
    _, lines = await store.read_transcript(room, capture, listener)
    assert [line["text"] for line in lines] == ["Không nộp trước ngày 12."]


async def test_only_one_concurrent_recording_and_late_webhooks_cannot_reopen_it(capture_database):
    room = capture_database
    attendee = uuid.uuid4()
    sid = f"RM_{uuid.uuid4().hex}"
    capture = await store.observe(room, sid, {attendee})
    ids = [uuid.uuid4(), uuid.uuid4()]
    reservations = await asyncio.gather(*(store.reserve_recording(capture, item) for item in ids))
    assert reservations.count(True) == 1
    recording_id = ids[reservations.index(True)]
    egress_id = f"EG_{uuid.uuid4().hex}"
    room_name = study_room_livekit_name(room)

    await store.update_recording(recording_id, "active", egress_id)
    await store.update_recording(recording_id, "ending", egress_id)
    await recording_service.accept_egress_update(api.EgressInfo(
        egress_id=egress_id, room_id=sid, room_name=room_name, status=api.EgressStatus.EGRESS_COMPLETE,
        file_results=[api.FileInfo(filename=recording_service.object_key(recording_id), size=3542)],
    ))
    await recording_service.accept_egress_update(api.EgressInfo(
        egress_id=egress_id, room_id=sid, room_name=room_name, status=api.EgressStatus.EGRESS_ACTIVE,
    ))

    recording = await store.get_recording(room, recording_id, attendee)
    assert recording["status"] == "complete"
    assert recording["ended_at"] is not None
    assert await store.get_recording(room, recording_id, uuid.uuid4()) is None
    assert await store.reserve_recording(capture, uuid.uuid4()) is True
