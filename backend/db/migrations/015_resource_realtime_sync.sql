-- 015: Enable authenticated, group-scoped Realtime for resource metadata.
-- Apply only to the intended Supabase database after preview acceptance.
-- No production database is changed by merely building/running the preview.
begin;

alter table public.resources enable row level security;

-- Resources are readable only by current group members. Direct Data API reads
-- return metadata only; storage objects still require independently signed URLs.
drop policy if exists resources_select_active_member on public.resources;
create policy resources_select_active_member on public.resources
  for select to authenticated
  using (public.is_active_group_member(group_id));

grant select on public.resources to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'resources'
  ) then
    alter publication supabase_realtime add table public.resources;
  end if;
end $$;

-- Keep replica identity DEFAULT: exposing a deleted resource's private path
-- through full-row Realtime DELETE payloads is unnecessary and unsafe.
commit;
