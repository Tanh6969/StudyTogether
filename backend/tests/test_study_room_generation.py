"""Regression tests for atomic browser-unload cleanup, isolated from external services."""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.study_rooms.services.study_room_service import StudyRoomsService


async def test_leave_if_join_generation_is_atomic_and_conditions_on_active_generation():
    session = AsyncMock()
    session.execute.return_value = MagicMock(rowcount=1)
    room_id = uuid.uuid4()
    user_id = uuid.uuid4()
    joined_at = datetime.now(timezone.utc)

    closed_at = await StudyRoomsService().leave_if_join_generation(
        session, room_id, user_id, joined_at
    )

    assert isinstance(closed_at, datetime)
    statement = session.execute.await_args.args[0]
    sql = str(statement)
    assert "study_room_members.joined_at" in sql
    assert "study_room_members.left_at IS NULL" in sql
    assert joined_at in statement.compile().params.values()

    # A newer join makes the WHERE predicate match zero rows. No leave happens.
    session.execute.return_value = MagicMock(rowcount=0)
    assert await StudyRoomsService().leave_if_join_generation(
        session, room_id, user_id, joined_at
    ) is None
