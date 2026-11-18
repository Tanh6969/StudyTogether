# StudyTogether — separate frontend/backend preview with opt-in shared resources

## Isolation contract

Review branch: `fix/room-session-lifecycle-20261118` (local AWS Git only).
Do not push/merge/deploy production until the PM accepts real two-user QA.

| Component | Preview | Production |
|---|---|---|
| Frontend | Built assets, loopback 5179 | Existing Caddy website |
| Backend | FastAPI, loopback 8181 | Existing service, port 8000 |
| PostgreSQL | Isolated local DB by default; production Supabase DB after explicit opt-in | Existing Supabase production |
| Authentication | Real Supabase Auth, existing-account login; no account writes | Existing Supabase Auth |
| LiveKit | Disabled by default; existing LiveKit after explicit opt-in | Existing LiveKit |
| Browser access | Temporary Cloudflare Tunnel, one-click private invitation link | Stable main domain |

The preview backend accepts local PostgreSQL by default. It can be explicitly
switched to the **existing production Supabase DB and LiveKit**, as the PM
requested on 2026-11-18, but only when its configuration validates the exact
known Supabase project and a deliberate shared-production acknowledgement.
No additional Supabase or LiveKit project is needed. Frontend/backend preview
remain separate processes. The public preview proxy must forward `/api` to
port 8181, never to the production backend. `preview.env` is outside Git and
mode 600; never print its contents.

The local PostgreSQL has all ten repository migrations and minimal compatible
`auth/storage` stubs, but it is not a full Supabase Realtime/Storage service.
In **isolated** mode, preview login verifies real Supabase-issued JWTs and
writes local profile rows only to the isolated database. In **shared-production**
mode, this provisioning is disabled entirely: existing production Auth/database
users and their profiles are used as-is. No schema migration or data import is
performed. Account registration, password reset, account settings, and password
updates stay disabled in the preview frontend to avoid unintended Auth writes.

Media requests intentionally return HTTP 503 until real LiveKit credentials
have been added with explicit shared-production opt-in. After opt-in, the
existing token endpoint generates genuine LiveKit tokens for authorized room
members using the existing LiveKit project. Its identifiers are the existing
`study-room-{UUID}` pattern, so **only create/use dedicated test room UUIDs**.
Do not mistake a signed token for a successful real camera/microphone connection.

## Shared architecture invariants

- `GET /study-rooms/{id}/session` is the server-owned current-user
  membership snapshot, independent of the shared roster.
- Successful `POST /join` is authoritative for the caller. Concurrent
  first joins are idempotent, using the unique membership constraint.
- 401/403/404 invalidate confirmed access; network errors retain the
  previously verified state while showing a diagnostic.
- Out-of-order roster/session requests cannot undo newer join/leave receipts.
- Moderation/chat loading is gated on confirmed participation.
- `POST /leave` with join generation only removes that generation.
  A stale tab cannot close the new membership or evict its LiveKit identity.
- Superseded LiveKit callbacks cannot fail the newer connection.
- All conversation message reads/writes use canonical permission checks:
  private-channel history is not accessible through group membership alone.
- Backend rejects unsigned frontend mock access tokens unconditionally.

## Repeatable checks

- `backend/tests/integration/smoke_room_session_real_db.py`: FastAPI
  plus actual isolated PostgreSQL transactions for session/join/token
  authorization/leave/rejoin/kick/chat. External Auth and LiveKit calls mocked.
- `backend/tests/integration/smoke_concurrent_join_real_db.py`: two
  simultaneous first joins on real PostgreSQL; expect 200/200.
- These scripts refuse to run unless `DATABASE_URL` equals the precise
  localhost-only preview URL.
- `pytest -q tests --ignore=tests/integration` under the safe fake-service
  test environment validates backend rules.
- React/Vitest and Vite production build validate frontend source.
- Chromium tests verify preview login, blocked Auth-write routes, JS console
  and preview `/api/health`. They do not prove real audio/video.
- Full regression on 2026-11-18: backend 723/723 tests; frontend 314/314 tests
  across 36 test files (run in six batches to survive MCP connection resets).
  Vite production build succeeded; Chromium verified the newly exposed `/session`
  OpenAPI route and no login/registration runtime JS errors.
- Pre-existing `NotesStackPanel.test.tsx` expected an obsolete expand/collapse
  design. Its coverage was realigned to the existing compact 42px note bar,
  retaining 20 role/actions/navigation/error tests, without altering the UI.
- Room A-to-B navigation and leaving with an unconfirmed join generation now
  have explicit regression tests. These are separate from real LiveKit QA.

## Shared production resources: administrator one-time setup

The user chose **existing production Supabase and LiveKit**, not a new project.
The MCP-PRO operating account `mcppro` cannot read the protected production
file `/opt/studytogether/backend/.env`; its AWS IAM role also cannot list
Secrets Manager or SSM managed instances. This is a deliberate access boundary.

A narrowly scoped, reviewed helper is prepared at
`deploy/staging/enable_existing_resources.py` (requires Python from the existing
`/opt/studytogether/venv`). The server administrator must review and execute it
once with local sudo permission. It reads the existing production environment
locally, verifies the DB and project identifiers, writes **only** the preview
environment file with restrictive permissions and an owner-only backup, and
prints no secrets. It does not restart/change the production application,
database, Caddy, DNS, GitHub, LiveKit projects, or Supabase configuration.

In Lightsail SSH connected as `ubuntu`, the administrator can use:

```sh
sudo install -o root -g root -m 0400 \
  /srv/mcppro/workspaces/studytogether-room-lifecycle-20261118/deploy/staging/enable_existing_resources.py \
  /root/studytogether-preview-shared.py
sudo /opt/studytogether/venv/bin/python /root/studytogether-preview-shared.py
```

The helper will refuse to change preview configuration if project DB metadata
cannot be verified. Once successful, **restart only the preview API** on
127.0.0.1:8181 and verify its `/health`, `/session` and test-only token flow.
Its environment file must never be committed or posted to chat.

### Mandatory QA safeguards when sharing production

- **All test actions now operate on real Supabase rows and the real LiveKit
  project**. Avoid existing user rooms, destructive moderation against real
  members, mass messages, or schema migrations.
- Sign in with existing authorized accounts, create a uniquely named QA group
  and QA room, and constrain testers to those IDs. Normal backend permission
  checks still apply; shared production secrets do not bypass them.
- The preview uses a Cloudflare Quick Tunnel **without OTP**. The Node
  preview web server checks a 256-bit capability link on initial entry,
  sets a Secure/HttpOnly/SameSite=Lax session cookie (24 hours), and redirects
  to normal StudyTogether login. All static/SPA/API paths return 403 without
  the cookie. Guessing a path or calling API directly is not public access.
  The token lives outside Git in the owner-only
  `/srv/mcppro/workspaces/studytogether-session-env/preview-access.key`
  (mode 600). Never paste it into code, logs or a public document.
- Open the invitation link once per browser/profile; the browser remembers
  preview access for 24 hours, without a Cloudflare OTP. Login to an existing
  StudyTogether account is still mandatory to use protected functions because
  the preview shares real Supabase/LiveKit resources.
- The Quick Tunnel hostname changes on restart: regenerate the invitation
  with the new hostname plus `/__preview/open/<capability>`. Only share it with
  permitted QA testers. Do not publish the naked hostname as a public preview.
- Verified from the public HTTPS hostname: anonymous web/API -> HTTP 403;
  valid invite -> HTTP 303 to /login with secure cookie; authorized browser ->
  HTTP 200 login and preview API, zero JavaScript runtime errors.
- As before, the backend/frontend source in production is **untouched**.
- Run two-user audio/video, join/leave/rejoin, screen share, hand raise,
  permissions, kick in the QA room, and network reconnect before PM approval.

5. **Security priority, evidence 2026-11-18:** Public API ingress rejects
   synthetic unsigned development tokens (HTTP 403 from Caddy) via an explicit
   header-matching rule in `/etc/caddy/Caddyfile`; the production FastAPI
   listener is bound to 127.0.0.1:8000 only. A single read-only `/auth/me`
   check against that loopback listener nevertheless returned HTTP 200 for a
   synthetic unsigned development token, confirming that backend verification
   remains insufficient behind the gateway. No data was read or modified.
   A minimal independent hotfix exists in local branch
   `fix/security-block-unsigned-dev-token-20261118` at commit `d257b24`,
   based on production SHA `e1828af`: 100/100 auth/meeting/permission tests
   passed. Both the hotfix and feature branch remain **undeployed**, pending
   PM approval. Do not describe the external route as currently bypassed.

Three least-privilege systemd units are prepared under `deploy/staging/`:
`studytogether-review-postgres.service`, `studytogether-review-api.service`,
`studytogether-review-web.service`. They bind loopback only and have memory/CPU
limits to protect the shared 4-GB Lightsail host. **They have not been installed
or enabled**: installing service units requires explicitly approved Linux admin
access, independent from the production StudyTogether service. Do not grant
MCP-PRO blanket root privileges just to install these units.

Until an authorized administrator installs them, local preview/tunnel processes
can end when the MCP supergateway restarts; do not advertise a Quick Tunnel URL
without rechecking it.
