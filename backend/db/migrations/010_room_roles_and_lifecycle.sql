-- ============================================================================
-- 010 — Room roles cleanup + no more start/end lifecycle.
--
-- 1. study_room_member_role 'moderator' -> 'editor'. The value only ever meant "may draw on
--    the board / control slides"; calling it moderator made it look like a GROUP moderator.
-- 2. Rooms are live as soon as they exist: no waiting -> active -> ended cycle any more.
--    * waiting rooms become active (they were already fully usable).
--    * ended rooms become soft-deleted (they were read-only history; "delete" is now the
--      only way to close a room). Their messages, members and room tasks stay in the
--      database, so achievements computed from them are unaffected.
-- 3. Exactly one host per room: if older data ever produced several HOST rows in one room,
--    keep the one matching study_rooms.host_id and demote the rest.
-- Idempotent.
-- ============================================================================

begin;

do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'study_room_member_role' and e.enumlabel = 'moderator'
  ) then
    alter type public.study_room_member_role rename value 'moderator' to 'editor';
  end if;
end $$;

update public.study_rooms set status = 'active', started_at = coalesce(started_at, created_at)
where status = 'waiting' and deleted_at is null;

update public.study_rooms set deleted_at = coalesce(ended_at, now())
where status = 'ended' and deleted_at is null;

alter table public.study_rooms alter column status set default 'active'::public.study_room_status;

update public.study_room_members m
set role = 'participant'
from public.study_rooms r
where m.room_id = r.id and m.role = 'host' and m.user_id <> r.host_id;

commit;
