"""Personal achievement counters, computed on demand from tables that already exist
(room_tasks, study_room_members, study_rooms). No event hooks: `evaluate_and_grant` runs when
the user opens their rewards, so a threshold crossed during a session shows up the next time
they look -- cheap, and impossible to get out of sync."""

import uuid
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.rewards.catalog import (
    DAY_STREAK,
    EARLY_BIRD,
    NIGHT_OWL,
    ROOMS_HOSTED,
    SESSIONS,
    STUDY_HOURS,
    TASKS_DONE,
    personal_items_met,
)
from app.rewards.entities.reward_entity import UserReward

TZ = "Asia/Ho_Chi_Minh"

_COUNTERS_SQL = text(
    f"""
    select
      (select count(*) from room_tasks t where t.user_id = :uid and t.status = 'done') as tasks_done,
      (select count(*) from room_tasks t where t.user_id = :uid and t.status = 'done'
         and (extract(hour from t.done_at at time zone '{TZ}') >= 23
              or extract(hour from t.done_at at time zone '{TZ}') < 4)) as night_owl,
      (select count(*) from room_tasks t where t.user_id = :uid and t.status = 'done'
         and extract(hour from t.done_at at time zone '{TZ}') between 5 and 6) as early_bird,
      (select count(*) from study_room_members m where m.user_id = :uid) as sessions,
      (select count(*) from study_rooms r where r.host_id = :uid and r.deleted_at is null) as rooms_hosted,
      (select coalesce(floor(extract(epoch from sum(
          least(coalesce(m.left_at, now()) - m.joined_at, interval '6 hours'))) / 3600), 0)
         from study_room_members m where m.user_id = :uid) as study_hours
    """
)

_ACTIVE_DAYS_SQL = text(
    f"""
    select distinct d from (
      select (t.done_at at time zone '{TZ}')::date as d from room_tasks t
        where t.user_id = :uid and t.status = 'done' and t.done_at is not null
      union
      select (m.joined_at at time zone '{TZ}')::date as d from study_room_members m
        where m.user_id = :uid
    ) days order by d desc
    """
)


def consecutive_days(days: list[date], today: date) -> int:
    """Length of the run of consecutive active days ending today, or ending yesterday if
    today has no activity yet (today is still in progress)."""
    active = set(days)
    cursor = today if today in active else today - timedelta(days=1)
    streak = 0
    while cursor in active:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


async def compute_progress(session: AsyncSession, user_id: uuid.UUID, today: date | None = None) -> dict[str, int]:
    row = (await session.execute(_COUNTERS_SQL, {"uid": user_id})).one()
    days = [d for (d,) in (await session.execute(_ACTIVE_DAYS_SQL, {"uid": user_id})).all()]
    return {
        TASKS_DONE: int(row.tasks_done),
        NIGHT_OWL: int(row.night_owl),
        EARLY_BIRD: int(row.early_bird),
        SESSIONS: int(row.sessions),
        ROOMS_HOSTED: int(row.rooms_hosted),
        STUDY_HOURS: int(row.study_hours),
        DAY_STREAK: consecutive_days(days, today or date.today()),
    }


async def evaluate_and_grant(session: AsyncSession, user_id: uuid.UUID) -> tuple[dict[str, int], list[str]]:
    """Grant every personal reward whose threshold is met (idempotent). Returns the counters
    and the ids granted just now. The caller commits."""
    progress = await compute_progress(session, user_id)
    met = personal_items_met(progress)
    if not met:
        return progress, []
    result = await session.execute(
        pg_insert(UserReward)
        .values([{"user_id": user_id, "reward_id": r.id, "group_id": None} for r in met])
        .on_conflict_do_nothing(index_elements=["user_id", "reward_id"])
        .returning(UserReward.reward_id)
    )
    return progress, list(result.scalars())
