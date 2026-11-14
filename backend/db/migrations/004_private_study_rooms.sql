-- ============================================================================
-- 004 — Private (hidden) study rooms.
-- A private room is only visible to / joinable by: active group owners/moderators,
-- and users who already have a study_room_members row (the host, or someone who
-- redeemed an invitation code). Mirrors the channels.is_private model.
-- Mirrors app/study_rooms/entities/study_room_entity.py + app/core/permissions.can_view_room.
-- Idempotent.
-- ============================================================================

begin;

alter table public.study_rooms
  add column if not exists is_private boolean not null default false;

-- Room visibility (list/detail/members/realtime). Previously only "active group member";
-- now private rooms additionally require manager role or an existing room membership row.
create or replace function public.can_access_room(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.study_rooms r
    where r.id = p_room_id
      and r.deleted_at is null
      and public.is_active_group_member(r.group_id)
      and (
        not r.is_private
        or public.is_group_manager(r.group_id)
        or exists (select 1 from public.study_room_members m
                   where m.room_id = r.id and m.user_id = (select auth.uid()))
      )
  );
$$;

drop policy if exists study_rooms_select_member on public.study_rooms;
create policy study_rooms_select_member on public.study_rooms
  for select to authenticated using (deleted_at is null and public.can_access_room(id));

commit;
