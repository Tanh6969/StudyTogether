import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.rewards.catalog import BY_ID, DEFAULT_CHEER


class MilestoneCreate(BaseModel):
    note: str = Field(default="", max_length=200)

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str) -> str:
        return value.strip()


class MilestoneResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID
    week_key: str
    note: str
    recorded_by: uuid.UUID | None
    created_at: datetime


class GroupStreakResponse(BaseModel):
    streak: int
    total_milestones: int
    current_week_key: str
    current_week_recorded: bool
    # Items the next tier would add, so the UI can say "còn 1 tuần nữa".
    next_tier: int | None
    next_tier_items: list[str]
    recent: list[MilestoneResponse]


class MilestoneRecorded(BaseModel):
    milestone: MilestoneResponse
    streak: int
    """Reward ids newly granted to the group's members by this milestone (empty if the tier
    was already reached before, e.g. a re-record after a reset)."""
    unlocked: list[str]


class MyRewardsResponse(BaseModel):
    owned: list[str]
    avatar_frame: str | None
    cheer_style: str
    # Personal achievement counters (catalog.PERSONAL_COUNTERS) for "12/25" progress labels.
    progress: dict[str, int] = {}
    just_unlocked: list[str] = []


class MyRewardsUpdate(BaseModel):
    """`avatar_frame: null` takes the frame off; `cheer_style` falls back to the default."""

    avatar_frame: str | None = None
    cheer_style: str | None = None

    @model_validator(mode="after")
    def has_change(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        if "avatar_frame" in self.model_fields_set and self.avatar_frame is not None:
            reward = BY_ID.get(self.avatar_frame)
            if reward is None or reward.kind != "frame":
                raise ValueError("Unknown avatar frame")
        if "cheer_style" in self.model_fields_set and self.cheer_style not in (None, DEFAULT_CHEER):
            reward = BY_ID.get(self.cheer_style or "")
            if reward is None or reward.kind != "cheer":
                raise ValueError("Unknown cheer style")
        return self
