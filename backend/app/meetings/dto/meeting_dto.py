from pydantic import BaseModel
import uuid


class MeetingTokenResponse(BaseModel):
    server_url: str
    participant_token: str
    captions_available: bool = False


class MeetingSessionClaim(BaseModel):
    client_session_id: uuid.UUID


class MeetingSessionStatus(BaseModel):
    active: bool


class MeetingTokenRequest(BaseModel):
    client_session_id: uuid.UUID
