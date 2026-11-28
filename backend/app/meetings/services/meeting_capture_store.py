"""Private PostgreSQL store shared with the meeting-session coordinator."""

import uuid
from datetime import datetime

from sqlalchemy import text

from app.meetings.services.meeting_session_service import meeting_session_service

ACTIVE_RECORDING_STATES = ("starting", "active", "ending")


async def observe(room_id: uuid.UUID, livekit_sid: str, users: set[uuid.UUID]) -> uuid.UUID:
    async with meeting_session_service._db().begin() as conn:
        capture_id = await conn.scalar(text("""
            INSERT INTO meeting_internal.capture (id, room_id, livekit_sid)
            VALUES (:id, :room_id, :sid)
            ON CONFLICT (livekit_sid) DO UPDATE SET ended_at = NULL
            RETURNING id
        """), {"id": uuid.uuid4(), "room_id": room_id, "sid": livekit_sid})
        if users:
            await conn.execute(text("""
                INSERT INTO meeting_internal.capture_member (capture_id, user_id)
                SELECT :capture_id, unnest(CAST(:users AS uuid[]))
                ON CONFLICT DO NOTHING
            """), {"capture_id": capture_id, "users": list(users)})
        return capture_id


async def finish(room_id: uuid.UUID, livekit_sid: str) -> None:
    async with meeting_session_service._db().begin() as conn:
        await conn.execute(text("""
            UPDATE meeting_internal.capture SET ended_at = COALESCE(ended_at, now())
            WHERE room_id = :room_id AND livekit_sid = :sid
        """), {"room_id": room_id, "sid": livekit_sid})


async def save_line(
    capture_id: uuid.UUID, line_id: uuid.UUID, spoken_at: datetime, speaker_name: str, transcript: str,
) -> None:
    async with meeting_session_service._db().begin() as conn:
        await conn.execute(text("""
            INSERT INTO meeting_internal.transcript_line (id, capture_id, spoken_at, speaker_name, text)
            VALUES (:id, :capture_id, :spoken_at, :speaker, :transcript)
            ON CONFLICT (id) DO NOTHING
        """), {"id": line_id, "capture_id": capture_id, "spoken_at": spoken_at,
               "speaker": speaker_name, "transcript": transcript})


async def list_captures(room_id: uuid.UUID, user_id: uuid.UUID):
    async with meeting_session_service._db().connect() as conn:
        result = await conn.execute(text("""
            SELECT c.id, c.livekit_sid, c.started_at, c.ended_at,
                EXISTS (
                    SELECT FROM meeting_internal.transcript_line l WHERE l.capture_id = c.id
                ) AS has_transcript
            FROM meeting_internal.capture c
            JOIN meeting_internal.capture_member m ON m.capture_id = c.id
            WHERE c.room_id = :room_id AND m.user_id = :user_id
            ORDER BY c.started_at DESC
        """), {"room_id": room_id, "user_id": user_id})
        return result.mappings().all()


async def read_transcript(room_id: uuid.UUID, capture_id: uuid.UUID, user_id: uuid.UUID):
    async with meeting_session_service._db().connect() as conn:
        capture = (await conn.execute(text("""
            SELECT c.started_at, c.ended_at FROM meeting_internal.capture c
            JOIN meeting_internal.capture_member m ON m.capture_id = c.id
            WHERE c.room_id = :room_id AND c.id = :id AND m.user_id = :user_id
        """), {"room_id": room_id, "id": capture_id, "user_id": user_id})).mappings().one_or_none()
        if capture is None:
            return None
        lines = (await conn.execute(text("""
            SELECT spoken_at, speaker_name, text
            FROM meeting_internal.transcript_line WHERE capture_id = :id
            ORDER BY spoken_at, id
        """), {"id": capture_id})).mappings().all()
        return capture, lines


async def reserve_recording(capture_id: uuid.UUID, recording_id: uuid.UUID) -> bool:
    async with meeting_session_service._db().begin() as conn:
        result = await conn.execute(text("""
            INSERT INTO meeting_internal.recording (id, capture_id, status)
            VALUES (:id, :capture_id, 'starting')
            ON CONFLICT DO NOTHING
        """), {"id": recording_id, "capture_id": capture_id})
        return result.rowcount == 1


async def update_recording(recording_id: uuid.UUID, state: str, egress_id: str | None = None) -> None:
    async with meeting_session_service._db().begin() as conn:
        await conn.execute(text("""
            UPDATE meeting_internal.recording
            SET egress_id = COALESCE(egress_id, :egress_id),
                status = :state,
                ended_at = CASE WHEN :state IN ('complete', 'failed') THEN now() ELSE NULL END
            WHERE id = :id AND status IN ('starting', 'active', 'ending')
                AND (egress_id IS NULL OR egress_id = :egress_id OR CAST(:egress_id AS text) IS NULL)
                AND (status != 'ending' OR :state IN ('ending', 'complete', 'failed'))
                AND (status != 'active' OR :state != 'starting')
        """), {"id": recording_id, "state": state, "egress_id": egress_id})


async def list_recordings(capture_ids: list[uuid.UUID]):
    if not capture_ids:
        return []
    async with meeting_session_service._db().connect() as conn:
        result = await conn.execute(text("""
            SELECT id, capture_id, status, egress_id, started_at, ended_at
            FROM meeting_internal.recording
            WHERE capture_id = ANY(CAST(:ids AS uuid[]))
            ORDER BY started_at DESC
        """), {"ids": capture_ids})
        return result.mappings().all()


async def get_recording(
    room_id: uuid.UUID, recording_id: uuid.UUID, user_id: uuid.UUID | None = None,
):
    async with meeting_session_service._db().connect() as conn:
        result = await conn.execute(text("""
            SELECT r.id, r.capture_id, r.status, r.egress_id, r.started_at, r.ended_at, c.livekit_sid
            FROM meeting_internal.recording r JOIN meeting_internal.capture c ON c.id = r.capture_id
            WHERE c.room_id = :room_id AND r.id = :id
                AND (CAST(:user_id AS uuid) IS NULL OR EXISTS (
                    SELECT FROM meeting_internal.capture_member m
                    WHERE m.capture_id = c.id AND m.user_id = :user_id
                ))
        """), {"room_id": room_id, "id": recording_id, "user_id": user_id})
        return result.mappings().one_or_none()



async def recording_id_for_egress(room_id: uuid.UUID, egress_id: str) -> uuid.UUID | None:
    async with meeting_session_service._db().connect() as conn:
        return await conn.scalar(text("""
            SELECT r.id FROM meeting_internal.recording r
            JOIN meeting_internal.capture c ON c.id = r.capture_id
            WHERE c.room_id = :room_id AND r.egress_id = :egress_id
        """), {"room_id": room_id, "egress_id": egress_id})
