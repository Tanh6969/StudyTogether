# StudyTogether — isolated room-session preview

## Isolation contract

Review branch: `fix/room-session-lifecycle-20261118` (local AWS Git only).
Do not push/merge/deploy production until the PM accepts real two-user QA.

| Component | Preview | Production |
|---|---|---|
| Frontend | Built assets, loopback 5179 | Existing Caddy website |
| Backend | FastAPI, loopback 8181 | Existing service, port 8000 |
| PostgreSQL | 16, loopback 6544, `studytogether_preview` | Supabase production |
| Authentication | Production Supabase **Auth only**, existing-account login | Supabase production Auth |
| LiveKit | Explicitly **disabled** pending real test credentials | Existing LiveKit |
| Browser access | Temporary Cloudflare OTP-protected Quick Tunnel | Stable main domain |

The preview backend refuses a database URL other than the exact loopback
preview database. The public preview proxy must forward `/api` to port 8181,
never production. `preview.env` is outside Git and mode 600; do not print it.

The local PostgreSQL has all ten repository migrations and minimal compatible
`auth/storage` stubs, but it is not a full Supabase Realtime/Storage service.
Preview login verifies real Supabase-issued JWTs and then writes profiles
**only to the local preview database**. Account registration, password reset,
account settings and password updates are disabled on the preview frontend
to avoid production Auth writes.

Media requests intentionally return HTTP 503 with an explicit explanation
until distinct test `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
`LIVEKIT_API_SECRET` have been securely provisioned. No fake LiveKit token
should be passed off as a connected call.

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

## Outstanding gates

1. **Separate Supabase staging project:** quote is $0/month for a new
   project in the existing Free org. PM must choose/confirm the org.
   The alternative project branch quotes $0.01344/hour; do not create
   a paid branch without explicit price approval.
2. **Real LiveKit QA project/credentials:** secure delivery only, never
   paste credentials into chat. Prefer a separate project.
3. Validate authenticated two-person camera/microphone, screen-sharing,
   hand raising, chat, join/leave/rejoin, kick, permissions, network
   loss/reconnect, and room end, across browsers.
4. Coordinate backend+frontend release only after PM acceptance.
5. **Security priority:** Original production backend contained an unsigned
   development-token acceptance path. This review branch closes it, but
   production is unchanged pending PM release approval.

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
