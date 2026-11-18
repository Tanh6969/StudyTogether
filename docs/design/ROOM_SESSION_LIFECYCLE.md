# Study Room session lifecycle (frontend ↔ backend ↔ LiveKit)

This document defines the common invariants for room participation and in-call features.
It complements the existing architecture and deliberately does not introduce a second
authorization system or replace LiveKit's own connection management.

## Source of truth and phases

1. **Pre-join**: `GET /study-rooms/{id}` supplies public/visible room metadata.
   `GET /study-rooms/{id}/session` returns **only the caller's own membership**,
   current lifecycle status and `can_connect`. Unconfirmed access is not access.
   The shared roster is for displaying other people, not authorization.
2. **Join acknowledgement**: `POST /study-rooms/{id}/join` returns the current
   user's membership row. A successful response is sufficient to enable the next
   client step. Do NOT make joining depend on a separate roster GET succeeding.
   Concurrent first joins by the same account are idempotent successes: the
   losing unique-constraint INSERT reads back the winner's active membership.
3. **Explicit media ownership**: The prejoin action allocates a tab-local
   random UUID and calls `POST /study-rooms/{id}/meeting/claim`, which atomically
   replaces the previous media owner for that **(room,user)** pair in a durable
   private PostgreSQL coordinator. Merely rendering, reconnecting or refreshing
   the page must never claim or replace another owner.
4. **In-room**: `POST /meeting/token` performs its own authorization AND
   checks the existing media owner's session ID before minting a LiveKit JWT.
   A stale token refresh returns 409 and does NOT change ownership.
   Protected moderation history, chat and room activities still depend on
   separate room membership authorization.
5. **Connected call**: LiveKit maintains media transport and its roster
   independently from both persisted room membership and the new media
   ownership claim. `GET /meeting/owner` is a read-only freshness check.
6. **Leave/revocation/end**: The backend is authoritative. A successful leave
   locally marks membership inactive; subsequent backend reads reconcile state.
   A token 401/403/404 is surfaced as a terminal authorization/session error.

## Critical invariants

- A failed roster GET due to transport errors means **unknown / temporarily unavailable**, not **no member**.
  Current-user authority is determined exclusively by `GET /session` or a committed
  POST `/join`/`/leave` response. Before either responds, participation is unconfirmed.
  A definitive 401/403/404 must invalidate local participation, unlike transient IO errors.
- All roster refresh sources (join/leave, periodic polling, Supabase Realtime)
  use the same increasing request revision. Discard results from older revisions.
- Realtime events and the 10-second poll refresh BOTH the roster and the caller's
  `/session`. They are not themselves authorization; late responses are versioned and
  cannot supersede a newer confirmed join/leave.
- Protected moderation history is requested after confirmed room membership;
  a 403 from that supplementary endpoint must not masquerade as a video failure.
  A response received after leaving is ignored using the same request-revision pattern.
- The chat hook uses the same membership gate; other protected features should
  follow the same rule instead of inventing feature-specific join semantics.
- Every room route instance is keyed by its `roomId`. A same-component navigation
  from room A to B must never present A's member, room metadata, permissions or
  moderation as belonging to B. The hook independently filters old responses by
  room id and request generation as a second line of defense.
- A tab may only issue an explicit leave with a confirmed `joined_at` generation.
  Without that generation, leaving the UI is a no-op for backend membership;
  it must not evict an active session opened in another tab.
- Route-change/pagehide cleanup retains the old room generation but may
  conditionally leave only when the tab has its own confirmed media claim.
  It sends `client_session_id`: the backend rejects cleanup from an owner
  superseded by another tab, preventing the old tab from revoking new media.
  An old tab with DB membership but no media claim must NOT fire unload leave.
- A background room metadata refresh must not toggle the page-wide initial
  loading state, because that unmounts and recreates the LiveKit provider.
- Token request status is NOT media connection status:
  `idle` (no request), `loading` (token in flight), `ready` (token received),
  `error` (token request failed). Video establishment happens afterward.
- A token request has a 15-second deadline and an AbortController. A stalled
  request becomes a visible retryable error, never an indefinite spinner.
  A superseded request's late response must never reactivate a revoked session.
- Explicit `POST /leave` is generation-safe when supplied `expected_joined_at` and
  `disconnect_livekit=true`. If an old tab's generation is no longer active it must
  neither close the newer DB membership nor evict the new LiveKit connection.
  Page-unload cleanup uses conditional leave WITHOUT media eviction. Serialize stale
  ORM members before rollback to prevent SQLAlchemy `MissingGreenlet`.
- Backend conversation reads and writes use the SAME `can_access_conversation`
  permission: active group membership alone is NOT authorization for a private channel.
- Backend must reject unsigned frontend mock identity tokens in every environment.
- LiveKit `DUPLICATE_IDENTITY` is a **signal**, not the sole authority: check
  the backend media owner. If the owner has changed, the old tab unmounts
  LiveKit, exits the call layout, and displays a terminal transferred notice,
  with NO automatic retry. To reclaim, the user must return to the room list,
  open prejoin again and explicitly click Join.
- Media owner is also checked read-only at connect time, on window focus
  and every five seconds, so cross-device takeover works even if LiveKit
  emits an unexpected reason. Network failures do not imply takeover.
- When a disconnect is not a takeover, keep normal LiveKit network recovery,
  refresh metadata without unmounting the room, and permit a retry with
  the SAME `client_session_id`. The backend rejects this if ownership changed
  while the user was offline. A teardown callback from an old token cannot
  invalidate the current connection.
- Durable owner state uses a private PostgreSQL table and atomic UPSERT,
  not memory/localStorage or a Supabase Realtime stream. Its storage must be
  shared between backend workers in any eventual multi-instance deployment.
- Media owner is NOT membership: changing the video tab must not revoke
  chat, message history or stored room permissions by default.
- **LiveKit caveat:** LiveKit JWTs remain valid until expiry; a malicious
  client manually reusing an old previously issued JWT can attempt to connect
  even after backend token refresh is fenced. Normal browser UI and API cannot
  silently reclaim. A stronger server-level guarantee would require a
  controlled LiveKit webhook/participant-eviction integration, tested before
  production rollout. Never describe app-level fencing as JWT revocation.

## Regression contract

Relevant frontend tests:
- `useStudyRoom.test.ts`: protected-data gating, successful join + roster
  outage, stale roster response, non-disruptive background refresh.
- `useMeetingToken.test.ts`: token success/403/404, timeout, cancellation,
  explicit retry.
- `MeetingProvider.test.tsx`: connection callbacks and terminal disconnect.
- `MeetingVideoGrid.test.tsx`: visible distinction between idle/loading/error.

Backend token and permission tests remain authoritative. They must run before
a release, followed by two-user testing with actual Supabase and LiveKit.
Migration `backend/db/migrations/011_meeting_media_session_owner.sql` adds a
private `meeting_internal.media_session` table on the coordinator database.
For the current preview it was applied **only on local PostgreSQL (127.0.0.1:6544)**,
not the shared Supabase production DB; the preview uses
`MEETING_SESSION_DATABASE_URL` and `MEETING_SESSION_REQUIRED=true`.
Production rollout later requires choosing a durable shared coordinator,
running migration 011 there through normal review/backup, and atomically
shipping frontend + backend + strict-mode configuration. Do not enable strict
mode on production backend without migrating the coordinator first.

New tests: `backend/tests/test_meeting_media_owner.py` (authorization,
stale token 409, strict legacy gate, stale unload), local-only PostgreSQL
race test in `tests/integration/test_meeting_media_owner_local_pg.py`, and
frontend takeover/no-retry/timeout/unload tests. Legacy media JWT identity
remains the user UUID, preserving existing LiveKit moderation, roster and
whiteboard mappings. Backend and frontend must deploy together after review.

## Operational notes

The local review branch is independent of the running production service.
Do not push, merge or deploy it until the product owner accepts an interactive
test of join, video, reconnect, membership revocation and room end.
