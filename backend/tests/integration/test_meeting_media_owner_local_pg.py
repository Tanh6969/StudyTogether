"""Real PostgreSQL race/ordering tests; local-only, never writes shared Supabase."""
import asyncio
import os
import uuid
from urllib.parse import urlsplit

import pytest

from app.core.config import settings
from app.meetings.services.meeting_session_service import MeetingSessionService


@pytest.mark.asyncio
async def test_two_tabs_and_devices_fenced_by_real_postgres(monkeypatch):
    url = os.getenv("MEETING_SESSION_DATABASE_URL", "")
    parsed = urlsplit(url)
    if parsed.hostname != "127.0.0.1" or parsed.port != 6544:
        pytest.skip("Only permitted against isolated local PostgreSQL on 127.0.0.1:6544")
    monkeypatch.setattr(settings, "meeting_session_database_url", url)
    service = MeetingSessionService()
    room, user = uuid.uuid4(), uuid.uuid4()
    old, new, third = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await service.claim(room, user, old)
    assert await service.is_owner(room, user, old)
    await service.claim(room, user, new)
    assert not await service.is_owner(room, user, old)
    assert await service.is_owner(room, user, new)
    # Two simultaneous explicit joins: unique-key UPSERT serializes writers.
    await asyncio.gather(service.claim(room, user, old), service.claim(room, user, third))
    values = await asyncio.gather(*[
        service.is_owner(room, user, client)
        for client in (old, new, third)
    ])
    assert sum(values) == 1
    # A stale token refresh is a read, never a competing claim.
    assert not await service.is_owner(room, user, new)
    from sqlalchemy import text
    async with service._db().begin() as conn:
        await conn.execute(text("DELETE FROM meeting_internal.media_session WHERE room_id=:rid AND user_id=:uid"),
                           {"rid":room, "uid":user})
    if service._engine is not None:
        await service._engine.dispose()
