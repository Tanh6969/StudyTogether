import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.enums import RoomTaskStatus
from app.profiles.dto.profile_dto import UserSummary


def _strip_required(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Title must not be blank")
    return value


class RoomTaskCreate(BaseModel):
    """No `user_id`: the owner is always the authenticated caller."""

    title: str = Field(min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        return _strip_required(value)


class RoomTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: RoomTaskStatus | None = None

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str | None) -> str | None:
        return _strip_required(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        for field in ("title", "status"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class RoomTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    user_id: uuid.UUID
    title: str
    status: RoomTaskStatus
    done_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Same canonical-identity convention as StudyRoomMemberResponse.user -- the panel groups
    # tasks by person and needs a name/avatar even for someone who has since left the room.
    user: UserSummary
