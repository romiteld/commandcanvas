begin;

create or replace function private.broadcast_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'roomId', new.room_id,
      'revision', new.revision,
      'receiptId', new.id
    ),
    'revision',
    'room:' || new.room_id::text,
    true
  );

  return new;
end;
$$;

revoke execute on function private.broadcast_receipt()
  from public, anon, authenticated;

commit;
