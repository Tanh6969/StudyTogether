-- ============================================================================
-- 007 — In-call "Activities" framework (docs/design/hoat-dong-trong-call.md §1).
--
-- room_activities: at most one live game and one live music session per study room. The
-- activity's host (not the room host) owns the authoritative state: the game engine or the
-- music clock runs in the host's browser and is broadcast over the LiveKit data channel;
-- `snapshot` is the host's last persisted copy so late joiners / reloads can catch up.
-- `participants` is an ordered JSONB array of user ids -- the order is what every client uses
-- to deterministically elect a new host when the current one drops. Idempotent.
-- ============================================================================

begin;

create table if not exists public.room_activities (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms (id) on delete cascade,
  kind text not null check (kind in ('game', 'music')),
  game text check (game is null or game in ('chalk')),
  host_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'ended')),
  participants jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  snapshot jsonb,
  snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint room_activities_game_kind check ((kind = 'game') = (game is not null))
);

create index if not exists ix_room_activities_room_id on public.room_activities (room_id);
create unique index if not exists ux_room_activities_one_live_game
  on public.room_activities (room_id) where kind = 'game' and ended_at is null;
create unique index if not exists ux_room_activities_one_live_music
  on public.room_activities (room_id) where kind = 'music' and ended_at is null;

drop trigger if exists room_activities_set_updated_at on public.room_activities;
create trigger room_activities_set_updated_at before update on public.room_activities
  for each row execute function public.set_updated_at();

alter table public.room_activities enable row level security;

drop policy if exists room_activities_select on public.room_activities;
create policy room_activities_select on public.room_activities
  for select to authenticated using (public.can_access_room(room_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_activities') then
    execute 'alter publication supabase_realtime add table public.room_activities';
  end if;
end $$;

alter table public.room_activities replica identity full;

commit;
