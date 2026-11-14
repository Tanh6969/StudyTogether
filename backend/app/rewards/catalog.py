"""Cosmetic reward catalog. Mirrors frontend/src/lib/rewards.ts -- keep the two in step.

`tier` is the group streak (consecutive weeks with a recorded milestone) that unlocks the
item for every active member of that group. The frontend owns how each item looks/sounds;
the backend only knows ids, kinds and tiers so it can grant and validate choices."""

from dataclasses import dataclass

DEFAULT_CHEER = "clap"


@dataclass(frozen=True)
class Reward:
    id: str
    kind: str  # "frame" | "cheer"
    tier: int


REWARDS: tuple[Reward, ...] = (
    Reward("ring-sky", "frame", 1),
    Reward("drum", "cheer", 1),
    Reward("ring-sunset", "frame", 2),
    Reward("fanfare", "cheer", 2),
    Reward("ring-aurora", "frame", 3),
    Reward("sparkle", "cheer", 3),
    Reward("ring-gold", "frame", 5),
    Reward("crowd", "cheer", 5),
)

BY_ID = {r.id: r for r in REWARDS}


def items_unlocked_by(streak: int) -> list[Reward]:
    return [r for r in REWARDS if r.tier <= streak]


def next_tier_after(streak: int) -> int | None:
    tiers = sorted({r.tier for r in REWARDS if r.tier > streak})
    return tiers[0] if tiers else None
