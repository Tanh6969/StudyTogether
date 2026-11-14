import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.db.enums import ProfileRole, RoomTaskStatus
from app.db.session import get_db_session
from app.main import app
from app.room_tasks.entities.room_task_entity import RoomTask
from app.room_tasks.routers import room_task_router

AUTH_HEADERS = {"Authorization": "Bearer testtoken"}


@pytest.fixture
def user():
    return CurrentUser(id=uuid.uuid4(), email="member@example.com", role="authenticated")


@pytest.fixture
def session():
    s = AsyncMock()
    s.add = MagicMock()
    return s


@pytest.fixture
def room():
    return SimpleNamespace(id=uuid.uuid4(), group_id=uuid.uuid4(), deleted_at=None, is_private=False)


@pytest.fixture(autouse=True)
def overrides(user, session, room, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: user

    async def session_dependency():
        yield session

    app.dependency_overrides[get_db_session] = session_dependency
    monkeypatch.setattr(room_task_router.study_rooms_service, "get_by_id", AsyncMock(return_value=room))
    monkeypatch.setattr(room_task_router, "can_view_room", AsyncMock(return_value=True))
    monkeypatch.setattr(room_task_router, "can_access_room", AsyncMock(return_value=True))
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def _profile(user_id: uuid.UUID):
    return SimpleNamespace(id=user_id, username="someone", display_name="Someone", avatar_url=None, role=ProfileRole.USER)


def _task(room_id: uuid.UUID, user_id: uuid.UUID, **kw) -> RoomTask:
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=uuid.uuid4(), room_id=room_id, user_id=user_id, title="Đọc Cambridge 17",
        status=RoomTaskStatus.TODO, done_at=None, created_at=now, updated_at=now,
    )
    defaults.update(kw)
    task = RoomTask(**{k: v for k, v in defaults.items()})
    task.user = _profile(user_id)
    return task


def _url(room, task_id=None):
    base = f"/study-rooms/{room.id}/tasks"
    return f"{base}/{task_id}" if task_id else base


async def test_list_returns_everyones_tasks_with_user_summary(async_client, session, room, user):
    other = uuid.uuid4()
    result = MagicMock()
    result.scalars.return_value = [_task(room.id, user.id), _task(room.id, other, status=RoomTaskStatus.DOING)]
    session.execute.return_value = result

    response = await async_client.get(_url(room), headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert [t["status"] for t in body] == ["todo", "doing"]
    assert body[1]["user"]["username"] == "someone"


async def test_list_404_for_private_room_hidden_from_caller(async_client, room, monkeypatch):
    room.is_private = True
    monkeypatch.setattr(room_task_router, "can_view_room", AsyncMock(return_value=False))
    response = await async_client.get(_url(room), headers=AUTH_HEADERS)
    assert response.status_code == 404


async def test_create_requires_active_room_membership(async_client, session, room, monkeypatch):
    monkeypatch.setattr(room_task_router, "can_access_room", AsyncMock(return_value=False))
    response = await async_client.post(_url(room), json={"title": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 403
    session.add.assert_not_called()


async def test_create_assigns_caller_and_strips_title(async_client, session, room, user):
    created = _task(room.id, user.id, title="Viết Task 2")
    session.scalar.side_effect = [0, created]

    response = await async_client.post(_url(room), json={"title": "  Viết Task 2  "}, headers=AUTH_HEADERS)
    assert response.status_code == 201
    added = session.add.call_args.args[0]
    assert added.user_id == user.id and added.title == "Viết Task 2"
    assert response.json()["user_id"] == str(user.id)


async def test_create_rejects_blank_title(async_client, session, room):
    response = await async_client.post(_url(room), json={"title": "   "}, headers=AUTH_HEADERS)
    assert response.status_code == 422
    session.add.assert_not_called()


async def test_update_someone_elses_task_forbidden(async_client, session, room):
    task = _task(room.id, uuid.uuid4())
    session.scalar.return_value = task
    response = await async_client.patch(_url(room, task.id), json={"status": "done"}, headers=AUTH_HEADERS)
    assert response.status_code == 403
    session.commit.assert_not_called()


async def test_update_to_doing_demotes_other_doing_task(async_client, session, room, user):
    task = _task(room.id, user.id)
    session.scalar.return_value = task

    response = await async_client.patch(_url(room, task.id), json={"status": "doing"}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert task.status == RoomTaskStatus.DOING and task.done_at is None
    # The "only one focus at a time" UPDATE ran before commit.
    session.execute.assert_awaited_once()
    session.commit.assert_awaited_once()


async def test_update_to_done_sets_done_at_and_back_to_todo_clears_it(async_client, session, room, user):
    task = _task(room.id, user.id)
    session.scalar.return_value = task

    response = await async_client.patch(_url(room, task.id), json={"status": "done"}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert task.status == RoomTaskStatus.DONE and task.done_at is not None
    session.execute.assert_not_awaited()  # no demotion needed for done

    response = await async_client.patch(_url(room, task.id), json={"status": "todo"}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert task.status == RoomTaskStatus.TODO and task.done_at is None


async def test_update_with_no_fields_is_422(async_client, room):
    response = await async_client.patch(_url(room, uuid.uuid4()), json={}, headers=AUTH_HEADERS)
    assert response.status_code == 422


async def test_delete_own_task(async_client, session, room, user):
    task = _task(room.id, user.id)
    session.scalar.return_value = task
    response = await async_client.delete(_url(room, task.id), headers=AUTH_HEADERS)
    assert response.status_code == 204
    session.delete.assert_awaited_once_with(task)


async def test_delete_someone_elses_task_forbidden(async_client, session, room):
    task = _task(room.id, uuid.uuid4())
    session.scalar.return_value = task
    response = await async_client.delete(_url(room, task.id), headers=AUTH_HEADERS)
    assert response.status_code == 403
    session.delete.assert_not_awaited()
