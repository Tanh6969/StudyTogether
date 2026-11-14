# StudyTogether backend (MVP)

FastAPI + SQLAlchemy (async) + Supabase (Postgres, Auth, Storage, Realtime) + LiveKit.

Forked from `python-naitei26_study-together-system`, trimmed to study groups/rooms + goals:
the `forum` and `moderation` (bans/reports) modules were removed. Notifications keep the
legacy `post_id`/`comment_id` columns (no FK) so the API shape is unchanged.

## Run

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
cp .env.example .env        # fill in values, see below
.venv/Scripts/python run.py # http://localhost:8000/docs
```

`DATABASE_URL` must use the **pooler** host (IPv4). The direct host
`db.<ref>.supabase.co` is IPv6-only and won't resolve on most local networks:

```
postgresql+psycopg://postgres.<ref>:<password>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
```

## Database

Plain SQL in `db/migrations/`, applied manually (psql or Supabase SQL editor), in order:

| File | What |
|---|---|
| `001_init_schema.sql` | Enums + tables. **Generated** from `app/*/entities` by `db/dump_ddl.py`. |
| `002_security_realtime_storage.sql` | Constraints/indexes, triggers (group owner membership, streaks, `updated_at`), RLS, Realtime publication, Storage buckets + policies. Idempotent. |
| `003_group_tasks.sql` | `group_tasks` table for the group task flow board (new in the MVP). |

New schema changes go in `004_*.sql`, `005_*.sql`, … Don't regenerate 001 on a live DB.

## Demo data

```bash
.venv/Scripts/python scripts/seed_demo.py
```

Creates (or re-sets the password of) 3 confirmed accounts, password `123456`:
`minhanh@study.local`, `hoangnam@study.local`, `thutrang@study.local`. Then wipes and
re-creates everything those accounts own: 4 groups with channels, messages, rooms, notes,
group task boards, plus personal tasks and roadmaps. Re-run any time to reset the demo.
The frontend login page shows quick-login buttons for these (`frontend/src/lib/demoAccounts.ts`).

## MVP-only features

- **Group task board** — `app/group_tasks`, `GET/POST /groups/{id}/tasks`,
  `PATCH/DELETE /groups/{id}/tasks/{taskId}`. Any active group member can edit. Tasks form a
  tree (`parent_id`); deleting a task deletes its subtree; re-parenting into its own subtree is
  rejected. `position` stores the manual canvas position (`null` = auto layout).
- **Roadmaps without a 20-phase cap** — `MAX_PHASES = 200` is only an abuse guard.

Access model: the backend connects as `postgres` (bypasses RLS) and does all writes. RLS is
enabled on every public table; only the SELECT policies the browser needs for Realtime exist,
plus INSERT policies for the two public image buckets.

## Tests

```bash
.venv/Scripts/python -m pytest -q --ignore=tests/integration
```

21 tests in `test_messages.py` / `test_study_rooms.py` / `test_groups.py` fail exactly as they
do in the original project (stale AsyncMock setup); not caused by the fork.

## Before deploying

- `app/auth/services/auth_service.py` accepts any `dev-token-<uuid>` bearer token as that
  user. Remove or gate it behind an env flag before exposing the API publicly.
