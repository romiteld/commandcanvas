begin;

create or replace function private.reject_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A room-owned receipt may disappear only as the nested DELETE issued by
  -- the rooms -> receipts foreign-key action. At that point the exact parent
  -- row is no longer visible. The trigger-depth and parent-absence checks are
  -- both required so a direct or otherwise nested receipt DELETE cannot use
  -- this exception while its room still exists.
  if tg_op = 'DELETE'
     and tg_table_schema = 'public'
     and tg_table_name = 'receipts'
     and pg_catalog.pg_trigger_depth() > 1
     and not exists (
       select 1
       from public.rooms room_row
       where room_row.id = old.room_id
     )
  then
    return old;
  end if;

  raise exception using
    errcode = '55000',
    message = 'receipts are immutable';
end;
$$;

revoke execute on function private.reject_receipt_mutation()
  from public, anon, authenticated, service_role;

commit;
