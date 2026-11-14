import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_NOTES = 50


def _strip_required(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Title must not be blank")
    return value


def _clean_notes(notes: list[str]) -> list[str]:
    cleaned = [note.strip() for note in notes if note.strip()]
    if any(len(note) > 500 for note in cleaned):
        raise ValueError("Each note must be at most 500 characters")
    return cleaned


class Position(BaseModel):
    x: float
    y: float


class GroupTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    assignee: str = Field(default="", max_length=100)
    due_date: date | None = None
    parent_id: uuid.UUID | None = None
    notes: list[str] = Field(default_factory=list, max_length=MAX_NOTES)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        return _strip_required(value)

    @field_validator("assignee")
    @classmethod
    def strip_assignee(cls, value: str) -> str:
        return value.strip()

    @field_validator("notes")
    @classmethod
    def clean_notes(cls, value: list[str]) -> list[str]:
        return _clean_notes(value)


class GroupTaskUpdate(BaseModel):
    """Partial update. Send `position: null` to reset a node to auto-layout."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    assignee: str | None = Field(default=None, max_length=100)
    due_date: date | None = None
    done: bool | None = None
    parent_id: uuid.UUID | None = None
    notes: list[str] | None = Field(default=None, max_length=MAX_NOTES)
    position: Position | None = None

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str | None) -> str | None:
        return _strip_required(value) if value is not None else None

    @field_validator("assignee")
    @classmethod
    def strip_assignee(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("notes")
    @classmethod
    def clean_notes(cls, value: list[str] | None) -> list[str] | None:
        return _clean_notes(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        for field in ("title", "done", "notes"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class GroupTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID
    parent_id: uuid.UUID | None
    title: str
    assignee: str
    due_date: date | None
    done: bool
    notes: list[str]
    position: Position | None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def build_position(cls, data):
        # ORM rows store position as two nullable columns; expose them as one object.
        if hasattr(data, "position_x"):
            x, y = data.position_x, data.position_y
            return {
                **{key: getattr(data, key) for key in (
                    "id", "group_id", "parent_id", "title", "assignee", "due_date", "done",
                    "notes", "created_by", "created_at", "updated_at",
                )},
                "position": {"x": x, "y": y} if x is not None and y is not None else None,
            }
        return data
