import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.profiles.dto.profile_dto import UserSummary

ActivityKind = Literal["game", "music"]
ActivityGame = Literal["chalk"]
ActivityStatus = Literal["lobby", "running", "ended"]
MusicProvider = Literal["youtube", "soundcloud", "spotify"]


class ActivityCreate(BaseModel):
    kind: ActivityKind
    game: ActivityGame | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


class ActivityUpdate(BaseModel):
    """Host-only (or group manager) partial update. `host_user_id` is how a surviving
    participant takes over after the host drops -- see the router for the rules."""

    status: ActivityStatus | None = None
    settings: dict[str, Any] | None = None
    snapshot: dict[str, Any] | None = None
    host_user_id: uuid.UUID | None = None


class ActivityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    kind: ActivityKind
    game: ActivityGame | None
    host_user_id: uuid.UUID
    status: ActivityStatus
    participants: list[uuid.UUID]
    settings: dict[str, Any]
    snapshot: dict[str, Any] | None
    snapshot_at: datetime | None
    created_at: datetime
    updated_at: datetime
    ended_at: datetime | None
    host: UserSummary


class ResolveTrackRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)

    @field_validator("url")
    @classmethod
    def strip_url(cls, value: str) -> str:
        return value.strip()


class ResolvedTrack(BaseModel):
    provider: MusicProvider
    provider_id: str
    url: str
    title: str
    author: str | None = None
    thumbnail_url: str | None = None
    duration_ms: int | None = None
    start_ms: int = 0


class QueueItemCreate(BaseModel):
    url: str = Field(min_length=8, max_length=2048)

    @field_validator("url")
    @classmethod
    def strip_url(cls, value: str) -> str:
        return value.strip()


class QueueItemUpdate(BaseModel):
    position: float | None = None
    played_at: datetime | None = None


class QueueItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    room_id: uuid.UUID
    position: float
    provider: MusicProvider
    provider_id: str
    url: str
    title: str
    author: str | None
    thumbnail_url: str | None
    duration_ms: int | None
    start_ms: int
    added_by: uuid.UUID
    added_at: datetime
    played_at: datetime | None
    adder: UserSummary


class WordPackRequest(BaseModel):
    """Optional free-text topic override; otherwise the room's group name/description and
    roadmap phase titles are used."""

    topic: str | None = Field(default=None, max_length=300)


class WordPackItem(BaseModel):
    word: str
    difficulty: int = Field(ge=1, le=3)


class WordPackResponse(BaseModel):
    topic: str
    words: list[WordPackItem]
