"""Durable, database-fenced owner of the media connection for (room, user).

This is *not* StudyRoom membership. A browser tab becomes media owner only after
explicit prejoin consent. Token refresh and ownership checks never take over.
The coordinator can use a separate PostgreSQL DSN for isolated review without
migrating the shared Supabase production database.
"""
import uuid
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.db.engine_config import build_engine_kwargs
from app.db.session import engine as app_engine


class MeetingSessionService:
    def __init__(self):
        self._engine = None

    def _db(self):
        url = settings.meeting_session_database_url
        if not url or url == settings.database_url:
            return app_engine
        if self._engine is None:
            self._engine = create_async_engine(url, **build_engine_kwargs(url))
        return self._engine

    async def claim(self, room_id: uuid.UUID, user_id: uuid.UUID, client_session_id: uuid.UUID) -> None:
        """An explicit join atomically replaces the previous owner.

        One INSERT/UPSERT is serialized by the composite primary key's unique
        index, across workers. Repeated claims from the same session are
        idempotent and do not advance the generation.
        """
        async with self._db().begin() as conn:
            await conn.execute(text("""
                INSERT INTO meeting_internal.media_session
                    (room_id, user_id, client_session_id, generation, updated_at)
                VALUES (:room, :user, :client, 1, now())
                ON CONFLICT (room_id, user_id) DO UPDATE
                SET client_session_id = EXCLUDED.client_session_id,
                    generation = CASE
                        WHEN meeting_internal.media_session.client_session_id = EXCLUDED.client_session_id
                        THEN meeting_internal.media_session.generation
                        ELSE meeting_internal.media_session.generation + 1 END,
                    updated_at = now()
            """), {"room": room_id, "user": user_id, "client": client_session_id})

    async def is_owner(self, room_id: uuid.UUID, user_id: uuid.UUID, client_session_id: uuid.UUID) -> bool:
        """Single source of truth; absence and stale client IDs both mean false."""
        async with self._db().connect() as conn:
            current = await conn.scalar(text("""
                SELECT client_session_id FROM meeting_internal.media_session
                WHERE room_id = :room AND user_id = :user
            """), {"room": room_id, "user": user_id})
        return current == client_session_id


meeting_session_service = MeetingSessionService()
