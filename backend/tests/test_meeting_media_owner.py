"""Media-session fencing: authorization, refresh and explicit takeover."""
import uuid
from unittest.mock import AsyncMock
from datetime import datetime, timezone
import pytest

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.core import permissions
from app.core.config import settings
from app.db.enums import GroupMemberRole, MemberStatus, ProfileRole, StudyRoomMemberRole
from app.db.session import get_db_session
from app.groups.entities.group_entity import GroupMember
from app.profiles.entities.profile_entity import Profile
from app.main import app
from app.study_rooms.entities.study_room_entity import StudyRoom, StudyRoomMember
from app.study_rooms.routers import study_room_router as router

AUTH = {"Authorization": "Bearer testtoken"}


@pytest.fixture(autouse=True)
def db_and_user(fake_user=None):
    user = CurrentUser(id=uuid.uuid4(), email="test@example.com", role="authenticated")
    async def fake_db():
        yield AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_session] = fake_db
    yield user
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def allow_room(monkeypatch, user):
    room = StudyRoom(id=uuid.uuid4(), group_id=uuid.uuid4(), name="QA", host_id=uuid.uuid4(), status="active", max_participants=50)
    monkeypatch.setattr(router.service, "get_by_id", AsyncMock(return_value=room))
    monkeypatch.setattr(permissions.groups_service, "get_member", AsyncMock(return_value=GroupMember(role=GroupMemberRole.MEMBER,status=MemberStatus.ACTIVE)))
    monkeypatch.setattr(permissions.study_rooms_service, "get_member", AsyncMock(return_value=StudyRoomMember(room_id=room.id,user_id=user.id)))
    return room


async def test_claim_replaces_only_after_backend_authorization(async_client, monkeypatch, db_and_user):
    user = db_and_user
    room = allow_room(monkeypatch, user)
    claim = AsyncMock()
    monkeypatch.setattr(router.meeting_session_service, "claim", claim)
    sid = uuid.uuid4()
    response = await async_client.post(f"/study-rooms/{room.id}/meeting/claim",
        json={"client_session_id":str(sid)}, headers=AUTH)
    assert response.status_code == 200, response.text
    assert response.json() == {"active": True}
    claim.assert_awaited_once_with(room.id,user.id,sid)


async def test_old_session_refresh_denied_without_reclaiming(async_client, monkeypatch, db_and_user):
    user = db_and_user
    room = allow_room(monkeypatch, user)
    is_owner = AsyncMock(return_value=False)
    claim = AsyncMock()
    monkeypatch.setattr(router.meeting_session_service, "is_owner", is_owner)
    monkeypatch.setattr(router.meeting_session_service, "claim", claim)
    sid=uuid.uuid4()
    response = await async_client.post(f"/study-rooms/{room.id}/meeting/token",
        json={"client_session_id":str(sid)},headers=AUTH)
    assert response.status_code == 409
    claim.assert_not_awaited()


async def test_current_session_can_refresh_token(async_client, monkeypatch, db_and_user):
    user = db_and_user
    room=allow_room(monkeypatch,user)
    monkeypatch.setattr(router.meeting_session_service, "is_owner", AsyncMock(return_value=True))
    monkeypatch.setattr(router.profiles_service,"get_by_id",AsyncMock(return_value=None))
    response=await async_client.post(f"/study-rooms/{room.id}/meeting/token",
        json={"client_session_id":str(uuid.uuid4())},headers=AUTH)
    assert response.status_code == 200, response.text
    assert response.json()["participant_token"]


async def test_missing_media_session_rejected_in_strict_mode(async_client, monkeypatch, db_and_user):
    room=allow_room(monkeypatch,db_and_user)
    monkeypatch.setattr(settings,"meeting_session_required",True)
    response=await async_client.post(f"/study-rooms/{room.id}/meeting/token",headers=AUTH)
    assert response.status_code == 400


async def test_read_only_ownership_false_does_not_claim(async_client,monkeypatch,db_and_user):
    room=allow_room(monkeypatch,db_and_user)
    sid=uuid.uuid4()
    check=AsyncMock(return_value=False)
    monkeypatch.setattr(router.meeting_session_service,"is_owner",check)
    response=await async_client.get(f"/study-rooms/{room.id}/meeting/owner?client_session_id={sid}",headers=AUTH)
    assert response.status_code == 200
    assert response.json()=={"active":False}
    check.assert_awaited_once_with(room.id,db_and_user.id,sid)


async def test_stale_tab_unload_leave_cannot_change_membership(async_client,monkeypatch,db_and_user):
    room=allow_room(monkeypatch,db_and_user)
    monkeypatch.setattr(router.meeting_session_service,"is_owner",AsyncMock(return_value=False))
    leave=AsyncMock()
    monkeypatch.setattr(router.service,"leave",leave)
    member=StudyRoomMember(id=uuid.uuid4(),room_id=room.id,user_id=db_and_user.id,
        role=StudyRoomMemberRole.PARTICIPANT,joined_at=datetime.now(timezone.utc))
    member.user=Profile(id=db_and_user.id,username=None,display_name='Test',avatar_url=None,role=ProfileRole.USER)
    monkeypatch.setattr(router.service,"get_member",AsyncMock(return_value=member))
    response=await async_client.post(f"/study-rooms/{room.id}/leave?client_session_id={uuid.uuid4()}",headers=AUTH)
    assert response.status_code == 200
    leave.assert_not_awaited()


async def test_strict_leave_missing_media_id_is_refused(async_client, monkeypatch, db_and_user):
    """Never permit a no-ID unload to revoke a newer tab in strict mode."""
    user = db_and_user
    room = allow_room(monkeypatch, user)
    monkeypatch.setattr(settings, "meeting_session_required", True)
    member = StudyRoomMember(
        id=uuid.uuid4(), room_id=room.id, user_id=user.id,
        role=StudyRoomMemberRole.PARTICIPANT, joined_at=datetime.now(timezone.utc),
    )
    member.user = Profile(
        id=user.id, username=None, display_name="Test",
        avatar_url=None, role=ProfileRole.USER,
    )
    monkeypatch.setattr(router.service, "get_member", AsyncMock(return_value=member))
    leave = AsyncMock()
    monkeypatch.setattr(router.service, "leave", leave)
    response = await async_client.post(f"/study-rooms/{room.id}/leave", headers=AUTH)
    assert response.status_code == 409
    leave.assert_not_awaited()
