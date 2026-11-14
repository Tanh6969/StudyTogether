-- ============================================================================
-- 005 — Session tasks inside a study room ("Buổi học hôm nay") + realtime hand-raise.
--
-- room_tasks: what each participant is working on during a room session. Everyone who
-- can see the room sees everyone's list, so the group's effort is visible as it happens.
-- Mirrors app/room_tasks/entities/room_task_entity.py. Idempotent.
--
-- room_moderation_actions: was never in the Realtime publication and had no SELECT policy,
-- so a raised hand only reached other participants on their next full reload. Both are
-- added here (the frontend's useRoomModerationRealtime hook subscribes to it).
-- ============================================================================

begin;

do $$ begin
  create type public.room_task_status as enum ('todo', 'doing', 'done');
exception when duplicate_object then null; end $$;

create table if not exists public.room_tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status public.room_task_status not null default 'todo',
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_room_tasks_room_id on public.room_tasks (room_id);
create index if not exists ix_room_tasks_room_user on public.room_tasks (room_id, user_id);

drop trigger if exists room_tasks_set_updated_at on public.room_tasks;
create trigger room_tasks_set_updated_at before update on public.room_tasks
  for each row execute function public.set_updated_at();

alter table public.room_tasks enable row level security;

-- Visible to whoever can see the room (migration 004's can_access_room: active group member,
-- and for a private room a manager or an invited member). Writes go through the backend.
drop policy if exists room_tasks_select on public.room_tasks;
create policy room_tasks_select on public.room_tasks
  for select to authenticated using (public.can_access_room(room_id));

drop policy if exists room_moderation_actions_select on public.room_moderation_actions;
create policy room_moderation_actions_select on public.room_moderation_actions
  for select to authenticated using (public.can_access_room(room_id));

do $$
declare t text;
begin
  foreach t in array array['room_tasks', 'room_moderation_actions'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- DELETE events must carry room_id so a filtered subscription can route them.
alter table public.room_tasks replica identity full;

commit;
