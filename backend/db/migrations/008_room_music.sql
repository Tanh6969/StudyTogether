-- ============================================================================
-- 008 — Shared music queue for a room's music activity (docs/design/hoat-dong-trong-call.md §3).
--
-- room_music_queue: one row per queued track. Anyone in the room may add; the DJ reorders;
-- the adder or the DJ removes. Playback state itself (current item, playing, position,
-- anchor time, DJ) is NOT a table: it lives in room_activities.snapshot of the owning
-- 'music' activity, written by the DJ on every play/pause/seek/next and broadcast live over
-- the LiveKit data channel. `position` is a float so a track can be inserted between two
-- others without renumbering. Idempotent.
-- ============================================================================

begin;

create table if not exists public.room_music_queue (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.room_activities (id) on delete cascade,
  room_id uuid not null references public.study_rooms (id) on delete cascade,
  position double precision not null,
  provider text not null check (provider in ('youtube', 'soundcloud', 'spotify')),
  provider_id text not null,
  url text not null,
  title text not null,
  author text,
  thumbnail_url text,
  duration_ms integer,
  start_ms integer not null default 0,
  added_by uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  played_at timestamptz
);

create index if not exists ix_room_music_queue_activity_position on public.room_music_queue (activity_id, position);

alter table public.room_music_queue enable row level security;

drop policy if exists room_music_queue_select on public.room_music_queue;
create policy room_music_queue_select on public.room_music_queue
  for select to authenticated using (public.can_access_room(room_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_music_queue') then
    execute 'alter publication supabase_realtime add table public.room_music_queue';
  end if;
end $$;

alter table public.room_music_queue replica identity full;

commit;
