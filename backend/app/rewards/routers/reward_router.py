"""Group streak milestones and the cosmetic rewards they unlock (migration 006).

The streak is manual by design (image 2 of the product brief: "chuỗi nhóm thủ công"): a group
manager records that the group hit its weekly milestone. Automatic detection can come later
without changing this API -- it would just call the same grant step."""

import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.core.permissions import is_active_group_member, is_group_manager
from app.db.enums import MemberStatus
from app.db.session import get_db_session
from app.groups.entities.group_entity import GroupMember
from app.profiles.entities.profile_entity import Profile
from app.rewards.achievements import evaluate_and_grant
from app.rewards.catalog import DEFAULT_CHEER, group_streak_items, next_group_tier
from app.rewards.dto.reward_dto import (
    GroupStreakResponse,
    MilestoneCreate,
    MilestoneRecorded,
    MilestoneResponse,
    MyRewardsResponse,
    MyRewardsUpdate,
)
from app.rewards.entities.reward_entity import GroupMilestone, UserReward

router = APIRouter(tags=["Rewards"])


def week_key_for(day: date) -> str:
    iso = day.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _monday_of(key: str) -> date:
    year, week = int(key[:4]), int(key[6:])
    return date.fromisocalendar(year, week, 1)


def compute_streak(week_keys: set[str], today: date) -> int:
    """Consecutive recorded weeks ending at this week, or at last week if this week isn't
    recorded yet (the current week is still in progress, it shouldn't break the chain)."""
    current = week_key_for(today)
    if current not in week_keys:
        current = week_key_for(today - timedelta(days=7))
        if current not in week_keys:
            return 0
    streak = 0
    cursor = _monday_of(current)
    while week_key_for(cursor) in week_keys:
        streak += 1
        cursor -= timedelta(days=7)
    return streak


async def _week_keys(session: AsyncSession, group_id: uuid.UUID) -> set[str]:
    result = await session.execute(select(GroupMilestone.week_key).where(GroupMilestone.group_id == group_id))
    return set(result.scalars())


@router.get("/groups/{group_id}/streak", response_model=GroupStreakResponse)
async def get_group_streak(
    group_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    if not await is_active_group_member(session, group_id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only active group members can see the group streak")
    keys = await _week_keys(session, group_id)
    today = date.today()
    streak = compute_streak(keys, today)
    nxt = next_group_tier(streak)
    recent = await session.execute(
        select(GroupMilestone)
        .where(GroupMilestone.group_id == group_id)
        .order_by(GroupMilestone.week_key.desc())
        .limit(8)
    )
    return GroupStreakResponse(
        streak=streak,
        total_milestones=len(keys),
        current_week_key=week_key_for(today),
        current_week_recorded=week_key_for(today) in keys,
        next_tier=nxt,
        next_tier_items=[r.id for r in group_streak_items(nxt) if r.threshold == nxt] if nxt else [],
        recent=[MilestoneResponse.model_validate(m) for m in recent.scalars()],
    )


@router.post("/groups/{group_id}/milestones", response_model=MilestoneRecorded, status_code=status.HTTP_201_CREATED)
async def record_milestone(
    group_id: uuid.UUID,
    data: MilestoneCreate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Record this week's milestone and grant every tier the new streak reaches to all active
    members (idempotent per user+reward, so re-reaching a tier never duplicates)."""
    if not await is_group_manager(session, group_id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a group owner or moderator can record a milestone")
    today = date.today()
    key = week_key_for(today)
    keys = await _week_keys(session, group_id)
    if key in keys:
        raise HTTPException(status.HTTP_409_CONFLICT, "This week's milestone is already recorded")

    milestone = GroupMilestone(group_id=group_id, week_key=key, note=data.note, recorded_by=current_user.id)
    session.add(milestone)
    keys.add(key)
    streak = compute_streak(keys, today)

    members = await session.execute(
        select(GroupMember.user_id).where(GroupMember.group_id == group_id, GroupMember.status == MemberStatus.ACTIVE)
    )
    member_ids = list(members.scalars())
    rewards = group_streak_items(streak)
    unlocked: list[str] = []
    if member_ids and rewards:
        rows = [
            {"user_id": uid, "reward_id": r.id, "group_id": group_id}
            for uid in member_ids
            for r in rewards
        ]
        result = await session.execute(
            pg_insert(UserReward)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["user_id", "reward_id"])
            .returning(UserReward.reward_id)
        )
        order = {r.id: i for i, r in enumerate(rewards)}  # catalog order: tier, then frame before cheer
        unlocked = sorted({rid for rid in result.scalars()}, key=lambda rid: order.get(rid, len(order)))
    try:
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not record milestone: {e}")
    await session.refresh(milestone)
    return MilestoneRecorded(milestone=MilestoneResponse.model_validate(milestone), streak=streak, unlocked=unlocked)


async def _owned(session: AsyncSession, user_id: uuid.UUID) -> list[str]:
    result = await session.execute(
        select(UserReward.reward_id).where(UserReward.user_id == user_id).order_by(UserReward.created_at)
    )
    return list(result.scalars())


@router.get("/rewards/me", response_model=MyRewardsResponse)
async def get_my_rewards(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Also the moment personal achievements are evaluated: anything newly earned is granted
    here and reported in `just_unlocked`, so opening the rewards page is what "collects"."""
    profile = await session.get(Profile, current_user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    progress, just_unlocked = await evaluate_and_grant(session, current_user.id)
    if just_unlocked:
        await session.commit()
    return MyRewardsResponse(
        owned=await _owned(session, current_user.id),
        avatar_frame=profile.avatar_frame,
        cheer_style=profile.cheer_style or DEFAULT_CHEER,
        progress=progress,
        just_unlocked=just_unlocked,
    )


@router.put("/rewards/me", response_model=MyRewardsResponse)
async def update_my_rewards(
    data: MyRewardsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Pick what to wear. Only an unlocked item (or none / the default cheer) is accepted."""
    profile = await session.get(Profile, current_user.id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    owned = set(await _owned(session, current_user.id))
    if "avatar_frame" in data.model_fields_set:
        if data.avatar_frame is not None and data.avatar_frame not in owned:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You have not unlocked this frame yet")
        profile.avatar_frame = data.avatar_frame
    if "cheer_style" in data.model_fields_set:
        style = data.cheer_style or DEFAULT_CHEER
        if style != DEFAULT_CHEER and style not in owned:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You have not unlocked this cheer yet")
        profile.cheer_style = style
    try:
        await session.commit()
    except Exception as e:
        await session.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not update rewards: {e}")
    return MyRewardsResponse(owned=sorted(owned), avatar_frame=profile.avatar_frame, cheer_style=profile.cheer_style)
