-- ============================================================================
-- 006 — Group streak milestones + cosmetic rewards (avatar frames, cheer styles).
--
-- A group manager records one milestone per ISO week ("the group did its thing this week").
-- Consecutive weeks form the group's streak; reaching a tier grants that tier's rewards
-- (see app/rewards/catalog.py) to every active member. A member then picks which frame to
-- wear and which cheer the "Cổ vũ" button plays. Mirrors app/rewards/entities. Idempotent.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists avatar_frame text,
  add column if not exists cheer_style text not null default 'clap';

create table if not exists public.group_milestones (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- ISO week, e.g. '2026-W46'. One milestone per group per week.
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  note text not null default '' check (char_length(note) <= 200),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (group_id, week_key)
);

create index if not exists ix_group_milestones_group on public.group_milestones (group_id);

create table if not exists public.user_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reward_id text not null,
  -- Which group's streak earned it; informational only.
  group_id uuid references public.groups (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, reward_id)
);

create index if not exists ix_user_rewards_user on public.user_rewards (user_id);

alter table public.group_milestones enable row level security;
alter table public.user_rewards enable row level security;

drop policy if exists group_milestones_select_member on public.group_milestones;
create policy group_milestones_select_member on public.group_milestones
  for select to authenticated using (public.is_active_group_member(group_id));

drop policy if exists user_rewards_select_own on public.user_rewards;
create policy user_rewards_select_own on public.user_rewards
  for select to authenticated using (user_id = (select auth.uid()));

commit;
