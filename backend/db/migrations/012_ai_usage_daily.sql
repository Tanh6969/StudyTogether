-- ============================================================================
-- 012 — Daily AI usage quota per user (app/core/ai_quota.py).
-- One row per (user, feature, Vietnam-local day). Backend-only: RLS on, no policies,
-- so PostgREST clients can neither read nor reset their counters. Idempotent.
-- ============================================================================

begin;

create table if not exists public.ai_usage_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  feature text not null,
  usage_date date not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, feature, usage_date)
);

alter table public.ai_usage_daily enable row level security;

commit;
