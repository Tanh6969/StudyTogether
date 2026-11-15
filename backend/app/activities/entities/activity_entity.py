import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Double, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.profiles.entities.profile_entity import Profile


class RoomActivity(Base):
    """One in-call activity (a game or a shared-music session) of a study room. The activity
    host's browser holds the live state and broadcasts it over LiveKit; `snapshot` is the
    host's last persisted copy for late joiners. Mirrors db/migrations/007_room_activities.sql."""

    __tablename__ = "room_activities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("study_rooms.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    game: Mapped[str | None] = mapped_column(Text)
    host_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(Text, server_default=text("'lobby'"))
    participants: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    settings: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    snapshot: Mapped[dict | None] = mapped_column(JSONB)
    snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    host: Mapped["Profile"] = relationship()


class RoomMusicQueueItem(Base):
    """A queued track of a room's music activity. Mirrors db/migrations/008_room_music.sql."""

    __tablename__ = "room_music_queue"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    activity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("room_activities.id", ondelete="CASCADE"), index=True)
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("study_rooms.id", ondelete="CASCADE"))
    position: Mapped[float] = mapped_column(Double)
    provider: Mapped[str] = mapped_column(Text)
    provider_id: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    author: Mapped[str | None] = mapped_column(Text)
    thumbnail_url: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    start_ms: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    added_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    played_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    adder: Mapped["Profile"] = relationship()
