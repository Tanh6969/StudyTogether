"""Per-user daily quota for paid AI calls, stored in public.ai_usage_daily (migration 012).

Days roll over at midnight Vietnam time (UTC+7, no DST), which is what users see.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

VIETNAM_TZ = timezone(timedelta(hours=7))


def local_today() -> date:
    return datetime.now(VIETNAM_TZ).date()


async def remaining_quota(session: AsyncSession, user_id: uuid.UUID, feature: str, limit: int) -> int:
    used = await session.scalar(
        text(
            "select used from public.ai_usage_daily "
            "where user_id = :user_id and feature = :feature and usage_date = :day"
        ),
        {"user_id": user_id, "feature": feature, "day": local_today()},
    )
    return max(0, limit - (used or 0))


async def consume_quota(session: AsyncSession, user_id: uuid.UUID, feature: str, limit: int) -> int | None:
    """Atomically take one use. Returns the uses left after this one, or None if the quota is spent.

    The conditional upsert makes concurrent requests safe: the row is only bumped while used < limit.
    Committed immediately so the reservation holds even if the AI call is slow.
    """
    used = await session.scalar(
        text(
            "insert into public.ai_usage_daily (user_id, feature, usage_date, used) "
            "values (:user_id, :feature, :day, 1) "
            "on conflict (user_id, feature, usage_date) do update "
            "set used = ai_usage_daily.used + 1 where ai_usage_daily.used < :limit "
            "returning used"
        ),
        {"user_id": user_id, "feature": feature, "day": local_today(), "limit": limit},
    )
    await session.commit()
    return None if used is None else max(0, limit - used)


async def refund_quota(session: AsyncSession, user_id: uuid.UUID, feature: str) -> None:
    """Give back a use when the AI call failed on our side (not the user's fault)."""
    await session.execute(
        text(
            "update public.ai_usage_daily set used = greatest(used - 1, 0) "
            "where user_id = :user_id and feature = :feature and usage_date = :day"
        ),
        {"user_id": user_id, "feature": feature, "day": local_today()},
    )
    await session.commit()
