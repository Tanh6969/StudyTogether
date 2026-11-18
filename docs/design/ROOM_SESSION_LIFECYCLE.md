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
3. **In-room**: Backend token issuance (`POST /meeting/token`) performs its own
   authorization. Protected moderation history, chat and in-room activities are
   enabled only after room membership has been confirmed.
4. **Connected call**: LiveKit maintains its own media connection and participant
   roster, distinct from persisted study-room membership.
5. **Leave/revocation/end**: The backend is authoritative. A successful leave
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
- Route-change cleanup retains the old room's generation until that room's
  effect cleanup has run, then may conditionally leave the old membership.
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
- After LiveKit exhausts transient reconnection and disconnects, retain the
  room UI, refresh metadata non-disruptively, surface the disconnect and allow
  an explicit fresh-token retry. Never reload the entire page as recovery.
  A teardown callback from a previous LiveKit token must not be treated as a
  disconnect of the current attempt; explicit leave/disable is not a network error.

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
No database schema changes are needed; the new backend API reads existing tables. Backend and frontend must deploy together after review.

## Operational notes

The local review branch is independent of the running production service.
Do not push, merge or deploy it until the product owner accepts an interactive
test of join, video, reconnect, membership revocation and room end.
