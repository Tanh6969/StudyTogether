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

## Vietnamese live captions

Enable `LIVE_CAPTIONS_ENABLED=true` and set `SONIOX_API_KEY` on the API server.
The call toolbar offers captions once an authenticated participant connects to LiveKit.
Run the caption endpoint on one API worker so viewers in the same room share the
microphone streams. The API sends audio from unmuted microphones to Soniox while
the room has a caption viewer. The caption panel keeps recent text in memory for
the viewer. `LIVE_CAPTIONS_TERMS` is a comma-separated set of recognition hints
for project names and course terminology.

## Database

Plain SQL in `db/migrations/`, applied manually (psql or Supabase SQL editor), in order:

| File | What |
|---|---|
| `001_init_schema.sql` | Enums + tables. **Generated** from `app/*/entities` by `db/dump_ddl.py`. |
| `002_security_realtime_storage.sql` | Constraints/indexes, triggers (group owner membership, streaks, `updated_at`), RLS, Realtime publication, Storage buckets + policies. Idempotent. |
| `003_group_tasks.sql` | `group_tasks` table for the group task flow board (new in the MVP). |
| `004_private_study_rooms.sql` | `study_rooms.is_private` (hidden rooms, join by invite code only) + updated `can_access_room` / RLS. |
| `005_room_tasks.sql` | `room_tasks` (per-person session tasks shown to the whole room) + Realtime/RLS for `room_moderation_actions` (hand raise). |
| `006_rewards.sql` | `group_milestones` (one per group per ISO week → streak), `user_rewards`, and `profiles.avatar_frame` / `cheer_style`. |

New schema changes go in `007_*.sql`, `008_*.sql`, … Don't regenerate 001 on a live DB.

## Demo data

```bash
.venv/Scripts/python scripts/seed_demo.py
```

Creates (or re-sets the password of) 6 confirmed accounts, password `123456`:
`minhanh@study.local`, `hoangnam@study.local`, `thutrang@study.local`,
`duchuy@study.local`, `lanphuong@study.local`, `quocbao@study.local`. Then wipes and
re-creates everything those accounts own: 4 groups with channels, messages, rooms, notes,
group task boards, plus personal tasks and roadmaps. Re-run any time to reset the demo.
The frontend login page shows quick-login buttons for these (`frontend/src/lib/demoAccounts.ts`).

## MVP-only features

- **Group task board** — `app/group_tasks`, `GET/POST /groups/{id}/tasks`,
  `PATCH/DELETE /groups/{id}/tasks/{taskId}`. Any active group member can edit. Tasks form a
  tree (`parent_id`); deleting a task deletes its subtree; re-parenting into its own subtree is
  rejected. `position` stores the manual canvas position (`null` = auto layout).
- **Room session tasks** — `app/room_tasks`, `GET/POST /study-rooms/{id}/tasks`,
  `PATCH/DELETE /study-rooms/{id}/tasks/{taskId}`. Each participant keeps their own list
  (`todo` / `doing` / `done`, one `doing` at a time); everyone who can see the room reads all
  lists. Claps are a Supabase Realtime broadcast on the same channel, never stored.
- **Group streak + cosmetic rewards** — `app/rewards`. A group manager records this week's
  milestone (`POST /groups/{id}/milestones`, one per ISO week); consecutive weeks form the
  streak (`GET /groups/{id}/streak`). Each tier in `app/rewards/catalog.py` (1, 2, 3, 5 weeks)
  grants an avatar frame + a cheer style to every active member. `GET/PUT /rewards/me` picks
  what to wear; frames are pure CSS and cheers are synthesized on the frontend
  (`frontend/src/lib/rewards.ts` mirrors the catalog — keep both in step).
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
