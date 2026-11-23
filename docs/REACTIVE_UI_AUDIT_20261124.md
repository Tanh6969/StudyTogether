# StudyTogether — Reactive UI audit, 2026-11-24

## Scope and acceptance
Audit all user-visible create/edit/delete/upload operations. Production and GitHub main remain unchanged until the reviewer accepts the isolated preview.

## Root causes identified
- The public.resources table was not in the Supabase Realtime publication; there was no cross-user resource event delivery. A database migration is staged but has NOT been applied.
- Late REST list responses could overwrite a successful upload or other mutation, making the new item apparently disappear until F5.
- Channel, room and group-member lists shared one generation counter; independent reloads could cancel each other.
- Late chat snapshot responses could replace new incoming Realtime messages.
- Several screens had no mounted-view invalidation on other-tab writes, reconnects, window focus, or missed Realtime events.
- Four Realtime test suites ran implicitly in demo mode; 25 previously failing tests were disabled subscriptions in tests, not necessarily runtime failures.

## Changes by surface
| Surface | Immediate own update | Other tab | Other device |
|---|---|---|---|
| Resources upload/delete | Verified response merged; stale GET ignored | Event-based refetch | Realtime after migration 015; interim 15-second fallback |
| Group notes | Verified create/edit/delete and guarded list | Event-based refetch | Existing DB Realtime and fallback |
| Group task board | Verified CRUD, guarded reloads | Event-based refetch | Existing DB Realtime and fallback |
| Groups and membership | Immediate join and guarded list refresh | Event-based refetch | Focus and 15-second fallback |
| Channels, rooms, members | Independent request counters | Event-based refetch | Existing targeted Realtime and fallback |
| Room tasks | Guarded writes/refresh | Event-based refetch | Existing Realtime and fallback |
| Chat | Merge new messages with in-flight snapshots | Event-based refetch | Existing Realtime and fallback |
| Personal tasks and roadmap | Verified updates, guarded refresh | Event-based refetch | Focus and 15-second fallback |
| Notifications | Correct count refetch, avoids duplicate increments | Event-based refetch | Existing Realtime and 30-second fallback |

Successful API writes notify mounted views only after the backend confirms success; same-origin tabs use BroadcastChannel. Only request path and method are transmitted, never record data or authorization. Receivers refetch with their own credentials. Realtime subscriptions are supplementary, and fallback revalidation runs only while the document is visible.

## Database production hold
Migration 015_resource_realtime_sync.sql is prepared but not applied. It grants group-member-scoped RLS SELECT on resource metadata and adds the resources table to the Realtime publication. No production database, storage, or schema change occurred during preview. Cross-device updates for collections not in the publication still have a foreground fallback of about 15 seconds rather than true push-instantaneous updates.

## Isolated preview
Standalone backend (8182), separate PostgreSQL (6544), private frontend (5180) and a private one-click Cloudflare tunnel; no production Storage admin credentials. The local preview Storage adapter uses expiring HMAC-signed URLs and a private file directory. Real Supabase Auth is used for sign-in, but actual application records/files stay in the preview backend's own database and blob directory.

## QA results
- Isolated backend E2E: create group, signed upload, verify file appears in list, signed download byte-for-byte, reject non-member, delete metadata/blob and verify disappearance: PASS.
- Backend tests: 773 passed, 9 skipped (meeting-session requirement disabled in the test process only).
- Frontend: 367 passed across 45 test files in seven memory-bounded batches; previous four Realtime suites now explicitly use non-demo mode.
- TypeScript and optimized Vite build: PASS. Lint: 0 errors and 15 nonblocking warnings.
- Public preview login page: HTTP 200, no console errors. Private gate rejects non-invited requests with HTTP 403.

## Reviewer sign-off before production
Sign in with an existing StudyTogether account, upload/remove resources without refreshing, add/edit/delete notes and tasks, create and join a group, create room/channel, check chat messages and notifications, and repeat with two tabs/users. Do not merge to main or deploy to production until approved.
