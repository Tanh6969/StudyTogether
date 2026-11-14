import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.enums import RoomTaskStatus, pg_enum

if TYPE_CHECKING:
    from app.profiles.entities.profile_entity import Profile


class RoomTask(Base):
    """One participant's task for a study-room session (frontend: SessionTasksPanel,
    "Buổi học hôm nay"). Every participant sees every list; only the owner edits theirs.
    Mirrors db/migrations/005_room_tasks.sql."""

    __tablename__ = "room_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("study_rooms.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[RoomTaskStatus] = mapped_column(
        pg_enum(RoomTaskStatus, "room_task_status"), server_default=text("'todo'::room_task_status")
    )
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))

    # One-directional on purpose: Profile doesn't need to enumerate its room tasks.
    user: Mapped["Profile"] = relationship()
