# StudyTogether group membership lifecycle: audit & regression (2026-11-24)

## Source of truth
- Database: `group_members.status = active | left | banned`. A retained row with `left` or `banned` is **not** membership or authorization.
- `GET /groups/mine` already uses SQL filtering active rows; private active memberships remain visible here regardless of public discoverability.
- `GET /groups/me/memberships` returns the caller's **history** (all statuses) for discovery and self-status UX. Clients must explicitly require `status === active`.
- `group_members(group_id,user_id)` is unique, so public rejoin/invitation rejoin/manager re-add of a `left` user must reactivate the same row rather than create another.
- Rejoining always restores role `member`, never a prior moderator/owner privilege. Owner handoff still is a separate atomic operation.
- `banned` never maps to `left` through self-leave and never reactivates through join or invitation.

## Confirmed root causes
1. `StudyGroups` set `isMember: !!mine`, so all historical rows were shown as active groups despite DB accurately marking them left.
2. Regular `POST /groups/{id}/members` rejected any existing row, including departed users; groups were impossible to rejoin through discovery.
3. Invitation reactivation retained the previous role, potentially elevating a previously departed moderator on return.
4. `PUT .../status?member_status=left` previously allowed banned members to reclassify their record to left (ban bypass).
5. Direct group URL would show a workspace for a nonmember with unusable controls; private-group roster yields 403 after leaving and must be resolved against own historical membership.

## Corrected behavior
- Public group: leave -> no longer My Groups; discover with Join -> reactivate row -> immediate My Groups.
- Private group: leave -> no longer My Groups nor public discovery; valid invitation/code/manager add still can restore. Direct old URL shows exited notice.
- Banned member: discovery shows ban status and no Join; API returns 403 to self-join or to self-clear ban.
- Active members: My Groups unaffected, includes private groups.
- Owner: self-leave still requires successor/owner-leave transaction; revived old owner returns as ordinary member only.
- Bookmark, back navigation, other tab or later kick: guard group detail against inactive membership and explain/redirect; distinguish transient membership-request error with retry.
- Request races: preexisting generation guard ignores superseded group-list responses; data-change bus and visibility/foreground polling reconcile cross-tab/browser changes. Cross-device refresh is bounded by foreground 15-second fallback, not guaranteed instantaneous.

## Verification
- Red/green regression: 5 new backend tests failed before corrections; all PASS after. 3 new frontend group list assertions failed before corrections, all 4 PASS after, plus 3 direct-route notice tests.
- Full backend: **777 passed, 10 skipped**, `MEETING_SESSION_REQUIRED=false` only in the test process.
- Full frontend: **374 tests PASS over 47 suites**, run in 8 sequential memory-bounded batches.
- TypeScript, lint, Vite production build and isolated preview smoke: see PR verification notes.
- Production database queried read-only: 33 groups, 229 historical membership rows, 4 left rows. No production mutation performed.
- No SQL migration needed for this patch.

## Security boundaries
- Per-group authorization checks remain in FastAPI and SQL; frontend guards are UX defense in depth, not the security source of truth.
- Existing moderation UI `join_group` restrictions must also be independently enforced server-side before relying on them as a global permission gate; this code path is currently a separate moderation-policy concern and should not be conflated with `group_members.status = banned`.
- No automatic mutation of existing users, no production migration/deployment by this PR.
