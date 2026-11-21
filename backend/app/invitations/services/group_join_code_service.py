"""Persistent group join codes (table public.group_join_codes, migration 014).

Unlike CODE invitations (single-use, 5-minute, shown once, stored hashed), a group join code
works like a Teams "team code": reusable by anyone who has it, viewable again by the group's
managers, and replaced or switched off by them at any time. It is stored in plaintext so
managers can see it again -- the table is backend-only (RLS on, no policies).

Format: 7 characters from the same unambiguous alphabet as invitation codes, no dash, so it
can never collide in shape with an invitation code (XXXX-XXXX). Input is normalized
(spaces/dashes dropped, upper-cased) so "abc 12xy" still matches.
"""

import re
import secrets
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.invitations.services.invitation_service import _CODE_ALPHABET

CODE_LENGTH = 7
_MAX_GENERATION_ATTEMPTS = 5


def normalize_code(raw: str) -> str:
    return re.sub(r"[\s-]", "", raw).upper()


def _is_well_formed(code: str) -> bool:
    return len(code) == CODE_LENGTH and all(c in _CODE_ALPHABET for c in code)


@dataclass(frozen=True)
class GroupJoinCode:
    group_id: uuid.UUID
    code: str
    created_by: uuid.UUID | None


class GroupJoinCodeService:
    def generate(self) -> str:
        return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(CODE_LENGTH))

    async def get_code(self, session: AsyncSession, group_id: uuid.UUID) -> str | None:
        return await session.scalar(
            text("select code from public.group_join_codes where group_id = :group_id"), {"group_id": group_id}
        )

    async def find(self, session: AsyncSession, raw_code: str) -> GroupJoinCode | None:
        code = normalize_code(raw_code)
        if not _is_well_formed(code):
            return None
        row = (
            await session.execute(
                text("select group_id, code, created_by from public.group_join_codes where code = :code"),
                {"code": code},
            )
        ).one_or_none()
        return GroupJoinCode(row.group_id, row.code, row.created_by) if row else None

    async def rotate(self, session: AsyncSession, group_id: uuid.UUID, created_by: uuid.UUID) -> str:
        """Create the group's code, or replace it (the old code stops working immediately).
        Retries on the (astronomically unlikely) clash with another group's code. Commits."""
        for _ in range(_MAX_GENERATION_ATTEMPTS):
            code = self.generate()
            try:
                async with session.begin_nested():
                    await session.execute(
                        text(
                            "insert into public.group_join_codes (group_id, code, created_by) "
                            "values (:group_id, :code, :created_by) "
                            "on conflict (group_id) do update "
                            "set code = excluded.code, created_by = excluded.created_by, created_at = now()"
                        ),
                        {"group_id": group_id, "code": code, "created_by": created_by},
                    )
            except IntegrityError:
                continue
            await session.commit()
            return code
        raise RuntimeError("Could not generate a unique group join code")

    async def disable(self, session: AsyncSession, group_id: uuid.UUID) -> None:
        await session.execute(
            text("delete from public.group_join_codes where group_id = :group_id"), {"group_id": group_id}
        )
        await session.commit()
