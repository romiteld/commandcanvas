\set ON_ERROR_STOP on

do $$
declare
  v_definition text := pg_get_functiondef(
    'private.broadcast_receipt()'::regprocedure
  );
begin
  if v_definition like '%room_revision_committed%'
     or v_definition not like '%''roomId''%'
     or v_definition not like '%''receiptId''%'
     or v_definition not like '%''revision''%'
     or v_definition like '%''action''%'
     or v_definition like '%''affectedObjectIds''%'
  then
    raise exception 'realtime_revision_contract_mismatch';
  end if;

  raise notice 'realtime_contract_assertions_passed';
end;
$$;
