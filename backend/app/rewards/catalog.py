"""Cosmetic reward catalog. Mirrors frontend/src/lib/rewards.ts -- keep the two in step.

Each reward has one unlock condition: `unlock` names a counter and `threshold` the value that
unlocks it. `group_streak` is granted when a manager records a milestone (reward_router);
every other counter is a personal achievement computed from existing tables on demand
(achievements.py). The frontend owns how each item looks/sounds; the backend only knows ids,
kinds and unlock rules so it can grant and validate choices."""

from dataclasses import dataclass

DEFAULT_CHEER = "clap"

GROUP_STREAK = "group_streak"  # weeks (see reward_router.compute_streak)
TASKS_DONE = "tasks_done"  # room_tasks marked done by the user
SESSIONS = "sessions"  # study rooms joined
STUDY_HOURS = "study_hours"  # hours inside rooms (each stay capped at 6h)
NIGHT_OWL = "night_owl"  # tasks done 23:00-03:59 (Asia/Ho_Chi_Minh)
EARLY_BIRD = "early_bird"  # tasks done 05:00-06:59
ROOMS_HOSTED = "rooms_hosted"  # study rooms created
DAY_STREAK = "day_streak"  # consecutive days with a session or a done task

PERSONAL_COUNTERS = (TASKS_DONE, SESSIONS, STUDY_HOURS, NIGHT_OWL, EARLY_BIRD, ROOMS_HOSTED, DAY_STREAK)


@dataclass(frozen=True)
class Reward:
    id: str
    kind: str  # "frame" | "cheer"
    unlock: str
    threshold: int


REWARDS: tuple[Reward, ...] = (
    # Group streak tiers: a frame + a cheer each.
    Reward("ring-sky", "frame", GROUP_STREAK, 1),
    Reward("drum", "cheer", GROUP_STREAK, 1),
    Reward("ring-sunset", "frame", GROUP_STREAK, 2),
    Reward("fanfare", "cheer", GROUP_STREAK, 2),
    Reward("ring-aurora", "frame", GROUP_STREAK, 3),
    Reward("sparkle", "cheer", GROUP_STREAK, 3),
    Reward("ring-gold", "frame", GROUP_STREAK, 5),
    Reward("crowd", "cheer", GROUP_STREAK, 5),
    # Personal achievements, roughly in order of effort.
    Reward("shadow", "frame", SESSIONS, 5),
    Reward("frost", "frame", EARLY_BIRD, 1),
    Reward("storm", "frame", TASKS_DONE, 25),
    Reward("void", "frame", NIGHT_OWL, 5),
    Reward("neon", "frame", SESSIONS, 20),
    Reward("inferno", "frame", DAY_STREAK, 7),
    Reward("crown", "frame", ROOMS_HOSTED, 10),
    Reward("galaxy", "frame", STUDY_HOURS, 50),
    Reward("toxic", "frame", TASKS_DONE, 100),
    Reward("bloodmoon", "frame", NIGHT_OWL, 30),
    Reward("dragon", "frame", DAY_STREAK, 30),
)

BY_ID = {r.id: r for r in REWARDS}


def group_streak_items(streak: int) -> list[Reward]:
    return [r for r in REWARDS if r.unlock == GROUP_STREAK and r.threshold <= streak]


def next_group_tier(streak: int) -> int | None:
    tiers = sorted({r.threshold for r in REWARDS if r.unlock == GROUP_STREAK and r.threshold > streak})
    return tiers[0] if tiers else None


def personal_items_met(progress: dict[str, int]) -> list[Reward]:
    return [
        r for r in REWARDS
        if r.unlock in PERSONAL_COUNTERS and progress.get(r.unlock, 0) >= r.threshold
    ]
