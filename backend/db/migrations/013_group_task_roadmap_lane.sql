-- ============================================================================
-- 013 — Group the tasks of one applied AI roadmap (TaskFlowBoard draws each roadmap
-- as its own lane, so a new roadmap never lands on top of an older one).
-- NULL = a task added by hand. Idempotent.
-- ============================================================================

begin;

alter table public.group_tasks add column if not exists roadmap_id uuid;

commit;
