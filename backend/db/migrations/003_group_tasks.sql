-- ============================================================================
-- 003 — Group task flow board (new in the MVP; frontend: TaskFlowBoard).
-- Mirrors app/group_tasks/entities/group_task_entity.py. Idempotent.
-- ============================================================================

begin;

create table if not exists public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Tree structure: deleting a task deletes its subtree.
  parent_id uuid references public.group_tasks (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  assignee text not null default '',
  due_date date,
  done boolean not null default false,
  notes text[] not null default '{}'::text[],
  position_x double precision,
  position_y double precision,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_tasks_not_own_parent check (parent_id is null or parent_id <> id)
);

create index if not exists ix_group_tasks_group_id on public.group_tasks (group_id);
create index if not exists ix_group_tasks_parent_id on public.group_tasks (parent_id);

drop trigger if exists group_tasks_set_updated_at on public.group_tasks;
create trigger group_tasks_set_updated_at before update on public.group_tasks
  for each row execute function public.set_updated_at();

alter table public.group_tasks enable row level security;

drop policy if exists group_tasks_select_member on public.group_tasks;
create policy group_tasks_select_member on public.group_tasks
  for select to authenticated using (public.is_active_group_member(group_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_tasks') then
    alter publication supabase_realtime add table public.group_tasks;
  end if;
end $$;

-- DELETE events must carry group_id so a filtered subscription can route them.
alter table public.group_tasks replica identity full;

commit;
