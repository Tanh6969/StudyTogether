import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.db.session import get_db_session
from app.group_tasks.entities.group_task_entity import GroupTask
from app.group_tasks.routers import group_task_router
from app.main import app

AUTH_HEADERS = {"Authorization": "Bearer testtoken"}
GROUP_ID = uuid.uuid4()


@pytest.fixture
def user():
    return CurrentUser(id=uuid.uuid4(), email="member@example.com", role="authenticated")


@pytest.fixture
def session():
    s = AsyncMock()
    s.add = MagicMock()

    async def refresh(task):
        now = datetime.now(timezone.utc)
        task.id = task.id or uuid.uuid4()
        task.created_at = task.created_at or now
        task.updated_at = now
        task.done = bool(task.done)
        task.notes = task.notes or []
        task.assignee = task.assignee or ""

    s.refresh.side_effect = refresh
    return s


@pytest.fixture(autouse=True)
def overrides(user, session, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: user

    async def session_dependency():
        yield session

    app.dependency_overrides[get_db_session] = session_dependency
    monkeypatch.setattr(group_task_router, "is_active_group_member", AsyncMock(return_value=True))
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def _task(**kw) -> GroupTask:
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=uuid.uuid4(), group_id=GROUP_ID, parent_id=None, title="Task", assignee="", due_date=None,
        done=False, notes=[], position_x=None, position_y=None, created_by=None, created_at=now, updated_at=now,
    )
    return GroupTask(**{**defaults, **kw})


async def test_non_member_is_forbidden(async_client, monkeypatch):
    monkeypatch.setattr(group_task_router, "is_active_group_member", AsyncMock(return_value=False))
    response = await async_client.get(f"/groups/{GROUP_ID}/tasks", headers=AUTH_HEADERS)
    assert response.status_code == 403


async def test_create_root_task_strips_fields_and_sets_creator(async_client, session, user):
    session.scalar.return_value = 0  # current task count
    response = await async_client.post(
        f"/groups/{GROUP_ID}/tasks",
        json={"title": "  Ôn chương 1  ", "assignee": " Minh Anh ", "notes": ["  a ", "   "]},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 201, response.text
    created = session.add.call_args.args[0]
    assert (created.title, created.assignee, created.notes) == ("Ôn chương 1", "Minh Anh", ["a"])
    assert created.group_id == GROUP_ID and created.created_by == user.id
    assert response.json()["position"] is None


async def test_create_rejects_parent_from_another_group(async_client, session):
    session.scalar.return_value = 0
    result = MagicMock()
    result.one_or_none.return_value = SimpleNamespace(group_id=uuid.uuid4(), parent_id=None)
    session.execute.return_value = result
    response = await async_client.post(
        f"/groups/{GROUP_ID}/tasks", json={"title": "Child", "parent_id": str(uuid.uuid4())}, headers=AUTH_HEADERS
    )
    assert response.status_code == 422
    session.add.assert_not_called()


async def test_update_sets_and_clears_position(async_client, session):
    task = _task()
    session.scalar.return_value = task

    response = await async_client.patch(
        f"/groups/{GROUP_ID}/tasks/{task.id}", json={"position": {"x": 10.5, "y": 20}, "done": True}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200, response.text
    assert response.json()["position"] == {"x": 10.5, "y": 20.0}
    assert task.done is True

    response = await async_client.patch(f"/groups/{GROUP_ID}/tasks/{task.id}", json={"position": None}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json()["position"] is None and task.position_x is None


async def test_update_rejects_moving_task_under_its_own_descendant(async_client, session):
    task = _task()
    child_id = uuid.uuid4()
    session.scalar.return_value = task
    result = MagicMock()
    # child_id's parent is the task being moved -> cycle.
    result.one_or_none.return_value = SimpleNamespace(group_id=GROUP_ID, parent_id=task.id)
    session.execute.return_value = result

    response = await async_client.patch(
        f"/groups/{GROUP_ID}/tasks/{task.id}", json={"parent_id": str(child_id)}, headers=AUTH_HEADERS
    )
    assert response.status_code == 422


async def test_update_rejects_null_title(async_client):
    response = await async_client.patch(f"/groups/{GROUP_ID}/tasks/{uuid.uuid4()}", json={"title": None}, headers=AUTH_HEADERS)
    assert response.status_code == 422


async def test_delete_missing_task_returns_404(async_client, session):
    session.scalar.return_value = None
    response = await async_client.delete(f"/groups/{GROUP_ID}/tasks/{uuid.uuid4()}", headers=AUTH_HEADERS)
    assert response.status_code == 404


async def test_generate_group_task_tree_calls_ai_and_returns_preview(async_client, session, monkeypatch):
    from app.group_tasks.dto.group_task_dto import AIGroupTaskNode, AIGroupTaskSuggestion

    suggestion = AIGroupTaskSuggestion(
        title="Lộ trình ôn JLPT",
        nodes=[AIGroupTaskNode(title="Xây nền", assignee="Cả nhóm", due_date="2026-12-01", children=[
            AIGroupTaskNode(title="Ôn 500 từ vựng", assignee="Cả nhóm", due_date="2026-12-01"),
        ])],
    )
    generate = AsyncMock(return_value=suggestion)
    monkeypatch.setattr(group_task_router.roadmap_ai_service, "suggest_group_tasks", generate)

    response = await async_client.post(
        f"/groups/{GROUP_ID}/tasks/ai/generate",
        json={
            "goal": "Đỗ JLPT N2 vào cuối năm nay",
            "due_date": "2026-12-31",
            "hours_per_week": 12,
            "current_level": "Hiện ở N3, biết khoảng 1200 từ vựng và còn yếu ngữ pháp.",
        },
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["nodes"][0]["children"][0]["title"] == "Ôn 500 từ vựng"
    generate.assert_awaited_once()


async def test_generate_rejects_missing_hours_or_level(async_client):
    response = await async_client.post(
        f"/groups/{GROUP_ID}/tasks/ai/generate",
        json={"goal": "Đỗ JLPT N2", "hours_per_week": 10, "current_level": "N3"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 422


async def test_apply_group_task_tree_adds_parent_and_child(async_client, session):
    session.scalar.return_value = 0
    session.flush = AsyncMock()

    response = await async_client.post(
        f"/groups/{GROUP_ID}/tasks/ai/apply",
        json={
            "replace_existing": False,
            "nodes": [{
                "title": "Nền tảng",
                "assignee": "Cả nhóm",
                "due_date": "2026-12-01",
                "notes": ["Ôn từng ngày"],
                "children": [{
                    "title": "Từ vựng",
                    "assignee": "Cả nhóm",
                    "due_date": "2026-12-05",
                    "notes": [],
                    "children": [],
                }],
            }],
        },
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 201
    added = [call.args[0] for call in session.add.call_args_list]
    assert len(added) == 2
    assert added[1].parent_id == added[0].id
