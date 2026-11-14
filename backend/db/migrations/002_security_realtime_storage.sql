-- ============================================================================
-- 002 — Everything the SQLAlchemy entities can't express:
--   constraints/indexes, triggers the backend relies on, RLS, Realtime, Storage.
--
-- Access model (MVP):
--   * The FastAPI backend connects as `postgres` → bypasses RLS. All writes go
--     through the backend.
--   * The browser (anon/authenticated via supabase-js) only needs: Realtime
--     SELECT on a few tables + uploads to two public image buckets.
--   * RLS is ON for every public table; tables without a policy are simply not
--     readable/writable through PostgREST/Realtime.
--
-- Ported (simplified) from python-naitei26 migrations 004, 006, 008, 013, 020,
-- 023, 025, 026, 030, 033 and the storage-bucket migrations 003/014/017/023.
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. profiles ↔ auth.users
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_id_fkey') then
    alter table public.profiles
      add constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Constraints & indexes (orig. 004/006/013/021/022/025/030)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_type_target_check') then
    alter table public.conversations add constraint conversations_type_target_check check (
      (type = 'channel' and channel_id is not null and room_id is null)
      or (type = 'room' and room_id is not null and channel_id is null)
      or (type = 'direct' and channel_id is null and room_id is null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_direct_pair_check') then
    alter table public.conversations add constraint conversations_direct_pair_check check (
      (type = 'direct' and direct_user_min_id is not null and direct_user_max_id is not null
        and direct_user_min_id < direct_user_max_id)
      or (type <> 'direct' and direct_user_min_id is null and direct_user_max_id is null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invitations_email_recipient') then
    alter table public.invitations add constraint invitations_email_recipient check (
      (method = 'email' and recipient_email is not null) or (method = 'code' and recipient_email is null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'message_reactions_emoji_check') then
    alter table public.message_reactions add constraint message_reactions_emoji_check
      check (emoji in ('👍', '❤️', '😆', '😮', '😢', '😡'));
  end if;
end $$;

-- One conversation per channel / per room / per direct pair. The service layer's
-- get_or_create_direct relies on the pair index to resolve races.
create unique index if not exists conversations_channel_id_key on public.conversations (channel_id) where channel_id is not null;
create unique index if not exists conversations_room_id_key on public.conversations (room_id) where room_id is not null;
create unique index if not exists conversations_direct_pair_key
  on public.conversations (direct_user_min_id, direct_user_max_id) where type = 'direct';
create unique index if not exists messages_attachment_path_key on public.messages (attachment_path) where attachment_path is not null;

create index if not exists idx_conversation_members_user on public.conversation_members (user_id);
create index if not exists idx_messages_conversation_created on public.messages (conversation_id, created_at desc, id desc);
create index if not exists idx_message_reactions_conversation on public.message_reactions (conversation_id);
create index if not exists idx_group_members_user on public.group_members (user_id);
create index if not exists idx_channels_group on public.channels (group_id);
create index if not exists idx_study_rooms_group on public.study_rooms (group_id);
create index if not exists idx_study_room_members_room on public.study_room_members (room_id);
create index if not exists idx_group_notes_group_id on public.group_notes (group_id);
create index if not exists idx_resources_group on public.resources (group_id);
create index if not exists idx_invitations_pending_email_recipient
  on public.invitations (recipient_email) where method = 'email' and status = 'pending';
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread_user on public.notifications (user_id) where is_read = false;
create index if not exists roadmaps_user_created_at_idx on public.roadmaps (user_id, created_at desc);
create index if not exists roadmap_phases_roadmap_position_idx on public.roadmap_phases (roadmap_id, position);
create index if not exists tasks_user_due_date_idx on public.tasks (user_id, due_date);

-- ----------------------------------------------------------------------------
-- 3. updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','groups','channels','conversations','messages','group_notes','resources'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Group owner auto-membership (orig. 008). GroupsService.create relies on this
--    trigger and deliberately does NOT insert the owner row itself.
-- ----------------------------------------------------------------------------
create or replace function public.add_group_owner()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  insert into public.group_members (group_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'active')
  on conflict (group_id, user_id) do update set role = 'owner', status = 'active';
  return new;
end $$;

drop trigger if exists groups_add_owner on public.groups;
create trigger groups_add_owner after insert on public.groups
  for each row execute function public.add_group_owner();

-- ----------------------------------------------------------------------------
-- 5. Group streaks (orig. 033)
-- ----------------------------------------------------------------------------
create or replace function public.update_group_streak(p_group_id uuid, p_type text, p_amount int)
returns void language plpgsql security definer set search_path = 'public' as $$
declare
  v_today date := current_date;
  v_streak record;
begin
  select * into v_streak from public.group_streaks where group_id = p_group_id for update;
  if not found then
    insert into public.group_streaks (group_id, activity_date) values (p_group_id, v_today)
    returning * into v_streak;
  end if;

  if v_streak.activity_date < v_today then
    if v_streak.last_streak_date is null or v_streak.last_streak_date < v_today - 1 then
      v_streak.current_streak := 0;
    end if;
    v_streak.today_messages_count := 0;
    v_streak.today_study_minutes := 0;
  end if;

  if p_type = 'message' then
    v_streak.today_messages_count := v_streak.today_messages_count + p_amount;
  elsif p_type = 'study' then
    v_streak.today_study_minutes := v_streak.today_study_minutes + p_amount;
  end if;

  if (v_streak.today_messages_count >= 5 or v_streak.today_study_minutes >= 10)
     and (v_streak.last_streak_date is null or v_streak.last_streak_date < v_today) then
    v_streak.current_streak := v_streak.current_streak + 1;
    v_streak.highest_streak := greatest(v_streak.highest_streak, v_streak.current_streak);
    v_streak.last_streak_date := v_today;
  end if;

  update public.group_streaks set
    current_streak = v_streak.current_streak,
    highest_streak = v_streak.highest_streak,
    last_streak_date = v_streak.last_streak_date,
    activity_date = v_today,
    today_messages_count = v_streak.today_messages_count,
    today_study_minutes = v_streak.today_study_minutes
  where group_id = p_group_id;
end $$;

create or replace function public.trigger_update_streak_on_message()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare v_group_id uuid;
begin
  select coalesce(c.group_id, r.group_id) into v_group_id
  from public.conversations conv
  left join public.channels c on conv.channel_id = c.id
  left join public.study_rooms r on conv.room_id = r.id
  where conv.id = new.conversation_id;
  if v_group_id is not null then
    perform public.update_group_streak(v_group_id, 'message', 1);
  end if;
  return new;
end $$;

drop trigger if exists on_message_insert_for_streak on public.messages;
create trigger on_message_insert_for_streak after insert on public.messages
  for each row execute function public.trigger_update_streak_on_message();

create or replace function public.trigger_update_streak_on_study()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare v_group_id uuid; v_minutes int;
begin
  if new.left_at is not null and old.left_at is null then
    v_minutes := extract(epoch from (new.left_at - old.joined_at)) / 60;
    if v_minutes > 0 then
      select group_id into v_group_id from public.study_rooms where id = new.room_id;
      if v_group_id is not null then
        perform public.update_group_streak(v_group_id, 'study', v_minutes);
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_study_room_leave_for_streak on public.study_room_members;
create trigger on_study_room_leave_for_streak after update of left_at on public.study_room_members
  for each row execute function public.trigger_update_streak_on_study();

-- ----------------------------------------------------------------------------
-- 6. RLS helpers (security definer so policies don't recurse through RLS)
-- ----------------------------------------------------------------------------
create or replace function public.is_active_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = (select auth.uid()) and gm.status = 'active'
  );
$$;

create or replace function public.is_group_manager(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = (select auth.uid())
      and gm.status = 'active' and gm.role in ('owner', 'moderator')
  );
$$;

create or replace function public.can_access_channel(p_channel_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.channels c
    where c.id = p_channel_id
      and c.deleted_at is null
      and public.is_active_group_member(c.group_id)
      and (
        not c.is_private
        or public.is_group_manager(c.group_id)
        or exists (select 1 from public.channel_members cm
                   where cm.channel_id = c.id and cm.user_id = (select auth.uid()))
      )
  );
$$;

create or replace function public.can_access_room(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.study_rooms r
    where r.id = p_room_id and r.deleted_at is null and public.is_active_group_member(r.group_id)
  );
$$;

create or replace function public.can_access_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations conv
    where conv.id = p_conversation_id
      and case conv.type
        when 'channel' then public.can_access_channel(conv.channel_id)
        when 'room' then public.can_access_room(conv.room_id)
        when 'direct' then exists (
          select 1 from public.conversation_members m
          where m.conversation_id = conv.id and m.user_id = (select auth.uid()))
      end
  );
$$;

revoke execute on function public.update_group_streak(uuid, text, int) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS: enable everywhere, then grant SELECT only where the browser needs it
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

drop policy if exists channels_select_member on public.channels;
create policy channels_select_member on public.channels
  for select to authenticated using (public.can_access_channel(id));

drop policy if exists study_rooms_select_member on public.study_rooms;
create policy study_rooms_select_member on public.study_rooms
  for select to authenticated using (deleted_at is null and public.is_active_group_member(group_id));

drop policy if exists study_room_members_select_member on public.study_room_members;
create policy study_room_members_select_member on public.study_room_members
  for select to authenticated using (public.can_access_room(room_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated using (public.can_access_conversation(conversation_id));

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated using (public.can_access_conversation(conversation_id));

drop policy if exists group_notes_select_member on public.group_notes;
create policy group_notes_select_member on public.group_notes
  for select to authenticated using (public.is_active_group_member(group_id));

drop policy if exists group_streaks_select_member on public.group_streaks;
create policy group_streaks_select_member on public.group_streaks
  for select to authenticated using (public.is_active_group_member(group_id));

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 8. Realtime
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['messages','message_reactions','channels','study_rooms',
                           'study_room_members','group_notes','notifications'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- DELETE events must carry message_id/conversation_id, not just the PK.
alter table public.message_reactions replica identity full;

-- ----------------------------------------------------------------------------
-- 9. Storage
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('message-attachments', 'message-attachments', false, 10485760,
    array['image/jpeg','image/png','image/webp','application/pdf','text/plain']),
  ('group-resources', 'group-resources', false, 20971520,
    array['image/jpeg','image/png','image/webp','application/pdf','text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  ('profile-avatars', 'profile-avatars', true, 5242880,
    array['image/jpeg','image/png','image/webp','image/gif']),
  ('group-backgrounds', 'group-backgrounds', true, 5242880,
    array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Private buckets (message-attachments, group-resources) get no policies: the
-- backend issues signed upload/download URLs with the secret key.

drop policy if exists "Users can upload their own profile avatar" on storage.objects;
create policy "Users can upload their own profile avatar" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
  );

drop policy if exists "Group managers can upload group background" on storage.objects;
create policy "Group managers can upload group background" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'group-backgrounds'
    and (storage.foldername(name))[1] = 'groups'
    and public.is_group_manager(((storage.foldername(name))[2])::uuid)
  );

commit;
