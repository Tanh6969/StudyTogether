import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GroupTask(Base):
    """A node on a study group's shared task flow board (frontend: TaskFlowBoard).

    Tasks form a tree via parent_id; deleting a task deletes its whole subtree.
    """

    __tablename__ = "group_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("group_tasks.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(Text)
    # Free text on purpose: the board allows names like "Cả nhóm" that aren't a single member.
    assignee: Mapped[str] = mapped_column(Text, server_default=text("''"))
    due_date: Mapped[date | None] = mapped_column(Date)
    done: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    notes: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'::text[]"))
    # Shared by every task inserted by one AI roadmap apply (migration 013); NULL for hand-made tasks.
    # The board lays each roadmap out as its own lane.
    roadmap_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # Manual canvas position; NULL means "let the board auto-layout this node".
    position_x: Mapped[float | None] = mapped_column(Float)
    position_y: Mapped[float | None] = mapped_column(Float)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
