begin;

do $$
begin
  update storage.buckets
  set file_size_limit = 20971520
  where id = 'message-attachments';

  if not found then
    raise exception 'Storage bucket message-attachments does not exist';
  end if;
end $$;

commit;
