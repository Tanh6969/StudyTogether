import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MeetingTokenResponse(BaseModel):
    server_url: str
    participant_token: str
    captions_available: bool = False
    recording_available: bool = False


class MeetingSessionClaim(BaseModel):
    client_session_id: uuid.UUID


class MeetingSessionStatus(BaseModel):
    active: bool


class MeetingTokenRequest(BaseModel):
    client_session_id: uuid.UUID


class MeetingRecordingControl(MeetingTokenRequest):
    participant_sid: str = Field(min_length=1, max_length=128)


class MeetingRecordingResponse(BaseModel):
    id: uuid.UUID
    status: Literal["starting", "active", "ending", "complete", "failed"]
    started_at: datetime
    ended_at: datetime | None


class MeetingCaptureResponse(BaseModel):
    id: uuid.UUID
    livekit_sid: str
    started_at: datetime
    ended_at: datetime | None
    has_transcript: bool
    recordings: list[MeetingRecordingResponse]
