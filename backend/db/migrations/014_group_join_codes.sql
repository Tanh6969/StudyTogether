-- ============================================================================
-- 014 — Persistent, reusable group join code (Teams-style "team code").
-- One row per group that has a code enabled; no row = joining by code is off.
-- Lives in its own table (not a groups column) because groups is readable through
-- PostgREST; this table has RLS on and no policies, so only the backend can read it.
-- The old, never-used groups.invite_code column is left untouched.
-- Idempotent.
-- ============================================================================

begin;

create table if not exists public.group_join_codes (
  group_id uuid primary key references public.groups (id) on delete cascade,
  code text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.group_join_codes enable row level security;

commit;
