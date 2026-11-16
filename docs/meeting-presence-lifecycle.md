# StudyTogether — Live call presence / session lifecycle

## Scope and source of truth
- **LiveKit** owns who is presently connected to a video meeting. Camera/microphone muted participants still count. `MeetingVideoGrid` and the meeting header/task participants now consume the same `useParticipants()` roster through `MeetingProvider`.
- **study_room_members** owns authorization, room role, profile and long-lived session membership. Its `left_at` is not evidence of an active media connection.
- **Supabase Auth** owns the browser login session. The header awaits a confirmed `signOut({ scope: 'local' })`; failed logout stays on the page and surfaces an error.

## Leaving and reconnecting
- Explicit `POST /study-rooms/{id}/leave`: commit the membership departure and request LiveKit participant removal by authenticated user identity. A LiveKit RPC failure is logged and never undoes the DB commit.
- Background `pagehide` / React unmount sends `expected_joined_at` (original membership timestamp) with its best-effort keepalive request. Backend uses an atomic SQL `UPDATE` conditioned on matching `joined_at` and `left_at IS NULL`; zero affected rows means a newer join/session is protected. The background path **does not** remove a LiveKit identity: an old tab must not evict a newly connected device.
- Closing a browser/crashing is not a reliable network transaction. LiveKit will eventually detect a lost connection; presence can lag during network timeout, then converges. Reloading quickly must preserve the newer connection.
- The pagehide request is best effort and cannot be relied upon for durable membership cleanup. The UI does **not** use that stale DB row to count current callers.
- Supabase local signout does not guarantee already issued access tokens are immediately cryptographically invalidated; access control must continue on backend endpoints.

## Regression coverage
- Frontend: `MeetingProvider.test.tsx`, `MeetingVideoGrid.test.tsx`, `useStudyRoom.test.ts`, `Header.test.tsx`.
- Backend: leave tests in `test_study_rooms.py`, atomic predicate in `test_study_room_generation.py`, LiveKit RPC tests in `test_livekit_service.py`.
- No schema migration. No changes to `main`, production services or deployed infrastructure.

## Real manual acceptance (requires isolated actual Supabase/LiveKit credentials in local .env)
1. Join one room as seven distinct connected accounts. Verify seven LiveKit tiles/avatars, `Gọi Video (7)`, and seven participant entries in the session tasks panel. A camera-off user **remains counted**.
2. Close a remote participant's tab without pressing Leave. Wait for LiveKit disconnection detection, then verify all three surfaces converge to six.
3. Close and immediately reopen the same account on another device. Ensure a delayed old `pagehide` does not mark the new membership left and cannot evict the new LiveKit participant.
4. Press Leave deliberately. Ensure room access and LiveKit connection end; rejoin remains possible only via the existing authorized flow.
5. Simulate a failing logout API response. Confirm error is visible and page does not pretend the session ended. Then complete successful logout and check protected room access requires a new session.
6. Verify whiteboard, task completion, chat, screen sharing, moderation, and game features have not regressed.

A frontend-only demo is available on local port 3000 without a backend, but **does not validate multiuser LiveKit**. Never copy production secrets into Vite's `VITE_*` environment or check any credentials into Git.

## Pre-existing authentication release blocker (not changed in this focused patch)
The backend auth service currently accepts a `dev-token-*` prefix unconditionally (see `app/auth/services/auth_service.py` and the warning in `backend/README.md`). This bypass must be gated to an explicit, isolated development environment before any security-sensitive release. The UI logout correction does not by itself close that existing server-side authentication gap.
