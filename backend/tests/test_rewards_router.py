import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.db.session import get_db_session
from app.main import app
from app.rewards.routers import reward_router
from app.rewards.routers.reward_router import compute_streak, week_key_for

AUTH_HEADERS = {"Authorization": "Bearer testtoken"}


# --- pure streak maths ----------------------------------------------------------------


def _keys(today: date, *offsets_in_weeks: int) -> set[str]:
    from datetime import timedelta
    return {week_key_for(today - timedelta(days=7 * w)) for w in offsets_in_weeks}


def test_streak_counts_consecutive_weeks_ending_this_week():
    today = date(2026, 11, 15)
    assert compute_streak(_keys(today, 0, 1, 2), today) == 3


def test_streak_survives_an_unrecorded_current_week():
    """The week in progress must not break the chain before the group has had a chance."""
    today = date(2026, 11, 15)
    assert compute_streak(_keys(today, 1, 2), today) == 2


def test_streak_breaks_on_a_gap():
    today = date(2026, 11, 15)
    assert compute_streak(_keys(today, 0, 2, 3), today) == 1
    assert compute_streak(_keys(today, 2, 3), today) == 0


def test_streak_empty():
    assert compute_streak(set(), date(2026, 11, 15)) == 0


# --- endpoints ------------------------------------------------------------------------


@pytest.fixture
def user():
    return CurrentUser(id=uuid.uuid4(), email="member@example.com", role="authenticated")


@pytest.fixture
def session():
    s = AsyncMock()
    s.add = MagicMock()
    return s


@pytest.fixture(autouse=True)
def overrides(user, session, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: user

    async def session_dependency():
        yield session

    app.dependency_overrides[get_db_session] = session_dependency
    monkeypatch.setattr(reward_router, "is_active_group_member", AsyncMock(return_value=True))
    monkeypatch.setattr(reward_router, "is_group_manager", AsyncMock(return_value=True))
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def _scalars(values):
    result = MagicMock()
    result.scalars.return_value = list(values)
    return result


async def test_record_milestone_forbidden_for_plain_member(async_client, session, monkeypatch):
    monkeypatch.setattr(reward_router, "is_group_manager", AsyncMock(return_value=False))
    response = await async_client.post(f"/groups/{uuid.uuid4()}/milestones", json={}, headers=AUTH_HEADERS)
    assert response.status_code == 403
    session.add.assert_not_called()


async def test_record_milestone_twice_in_a_week_conflicts(async_client, session):
    session.execute.return_value = _scalars([week_key_for(date.today())])
    response = await async_client.post(f"/groups/{uuid.uuid4()}/milestones", json={}, headers=AUTH_HEADERS)
    assert response.status_code == 409
    session.add.assert_not_called()


async def test_record_milestone_grants_tier_rewards_to_active_members(async_client, session, user):
    group_id = uuid.uuid4()
    other = uuid.uuid4()
    # 1) existing week keys (none) 2) active member ids 3) the insert's RETURNING reward ids
    session.execute.side_effect = [_scalars([]), _scalars([user.id, other]), _scalars(["ring-sky", "drum", "ring-sky", "drum"])]

    async def refresh(milestone):
        milestone.id = uuid.uuid4()
        milestone.created_at = datetime.now(timezone.utc)

    session.refresh.side_effect = refresh

    response = await async_client.post(f"/groups/{group_id}/milestones", json={"note": "  Xong 3 đề  "}, headers=AUTH_HEADERS)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["streak"] == 1
    assert body["unlocked"] == ["ring-sky", "drum"]
    assert body["milestone"]["note"] == "Xong 3 đề"
    assert body["milestone"]["week_key"] == week_key_for(date.today())
    added = session.add.call_args.args[0]
    assert added.group_id == group_id and added.recorded_by == user.id


async def test_update_my_rewards_rejects_locked_frame(async_client, session, user):
    session.get.return_value = SimpleNamespace(avatar_frame=None, cheer_style="clap")
    session.execute.return_value = _scalars([])  # owns nothing
    response = await async_client.put("/rewards/me", json={"avatar_frame": "ring-sky"}, headers=AUTH_HEADERS)
    assert response.status_code == 403
    session.commit.assert_not_called()


async def test_update_my_rewards_accepts_owned_items_and_default_cheer(async_client, session):
    profile = SimpleNamespace(avatar_frame=None, cheer_style="clap")
    session.get.return_value = profile
    session.execute.return_value = _scalars(["ring-sky", "drum"])
    response = await async_client.put("/rewards/me", json={"avatar_frame": "ring-sky", "cheer_style": "drum"}, headers=AUTH_HEADERS)
    assert response.status_code == 200, response.text
    assert profile.avatar_frame == "ring-sky" and profile.cheer_style == "drum"

    response = await async_client.put("/rewards/me", json={"avatar_frame": None, "cheer_style": "clap"}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert profile.avatar_frame is None and profile.cheer_style == "clap"


async def test_update_my_rewards_unknown_ids_are_422(async_client):
    response = await async_client.put("/rewards/me", json={"avatar_frame": "ring-nope"}, headers=AUTH_HEADERS)
    assert response.status_code == 422
    response = await async_client.put("/rewards/me", json={}, headers=AUTH_HEADERS)
    assert response.status_code == 422


# --- personal achievements ------------------------------------------------------------

from app.rewards import achievements  # noqa: E402
from app.rewards.achievements import consecutive_days  # noqa: E402
from app.rewards.catalog import personal_items_met  # noqa: E402


def test_consecutive_days_counts_run_ending_today_or_yesterday():
    from datetime import timedelta
    today = date(2026, 11, 15)
    days = [today - timedelta(days=i) for i in (0, 1, 2, 4)]
    assert consecutive_days(days, today) == 3
    assert consecutive_days([today - timedelta(days=1), today - timedelta(days=2)], today) == 2
    assert consecutive_days([today - timedelta(days=2)], today) == 0
    assert consecutive_days([], today) == 0


def test_personal_items_met_respects_thresholds():
    met = {r.id for r in personal_items_met({"sessions": 20, "tasks_done": 25, "day_streak": 7})}
    assert met == {"shadow", "neon", "storm", "inferno"}
    assert personal_items_met({}) == []


async def test_get_my_rewards_grants_newly_met_achievements(async_client, session, monkeypatch):
    session.get.return_value = SimpleNamespace(avatar_frame=None, cheer_style="clap")
    monkeypatch.setattr(
        reward_router, "evaluate_and_grant",
        AsyncMock(return_value=({"tasks_done": 30, "sessions": 2}, ["storm"])),
    )
    session.execute.return_value = _scalars(["storm"])  # _owned after the grant

    response = await async_client.get("/rewards/me", headers=AUTH_HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["just_unlocked"] == ["storm"]
    assert body["owned"] == ["storm"]
    assert body["progress"]["tasks_done"] == 30
    session.commit.assert_awaited_once()


async def test_evaluate_and_grant_inserts_only_met_items(session, monkeypatch):
    uid = uuid.uuid4()
    monkeypatch.setattr(
        achievements, "compute_progress",
        AsyncMock(return_value={"tasks_done": 25, "sessions": 0, "study_hours": 0, "night_owl": 0, "early_bird": 0, "rooms_hosted": 0, "day_streak": 0}),
    )
    session.execute.return_value = _scalars(["storm"])
    progress, granted = await achievements.evaluate_and_grant(session, uid)
    assert granted == ["storm"] and progress["tasks_done"] == 25
    stmt = session.execute.call_args.args[0]
    assert "user_rewards" in str(stmt)
