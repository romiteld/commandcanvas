\set ON_ERROR_STOP on

-- Inputs must be two distinct, room-free Supabase Auth user UUIDs. The
-- control user also exercises participant invite grace. Everything rolls back.
begin;

select
  pg_catalog.clock_timestamp() as started_at,
  gen_random_uuid() as old_room_id,
  gen_random_uuid() as latest_room_id,
  gen_random_uuid() as control_room_id,
  gen_random_uuid() as proposed_one_id,
  gen_random_uuid() as proposed_two_id,
  gen_random_uuid() as legacy_two_id,
  gen_random_uuid() as legacy_three_id,
  gen_random_uuid() as rejected_id,
  gen_random_uuid() as receipt_id,
  gen_random_uuid() as undo_receipt_id,
  'note-' || pg_catalog.replace(gen_random_uuid()::text, '-', '') as object_id
\gset cc_

select
  set_config('ccr.host', :'host_user_id', true),
  set_config('ccr.control', :'control_user_id', true),
  set_config('ccr.started', :'cc_started_at', true),
  set_config('ccr.old_room', :'cc_old_room_id', true),
  set_config('ccr.latest_room', :'cc_latest_room_id', true),
  set_config('ccr.control_room', :'cc_control_room_id', true),
  set_config('ccr.proposed_one', :'cc_proposed_one_id', true),
  set_config('ccr.proposed_two', :'cc_proposed_two_id', true),
  set_config('ccr.legacy_two', :'cc_legacy_two_id', true),
  set_config('ccr.legacy_three', :'cc_legacy_three_id', true),
  set_config('ccr.rejected', :'cc_rejected_id', true),
  set_config('ccr.receipt', :'cc_receipt_id', true),
  set_config('ccr.undo_receipt', :'cc_undo_receipt_id', true),
  set_config('ccr.object', :'cc_object_id', true);

do $$
begin
  if current_setting('ccr.host')::uuid = current_setting('ccr.control')::uuid then
    raise exception 'recovery_probe_users_must_differ';
  end if;
  if (
    select pg_catalog.count(*)
    from auth.users
    where id in (
      current_setting('ccr.host')::uuid,
      current_setting('ccr.control')::uuid
    )
  ) <> 2 then
    raise exception 'recovery_probe_auth_user_missing';
  end if;
  if exists (
    select 1 from public.rooms
    where created_by in (
      current_setting('ccr.host')::uuid,
      current_setting('ccr.control')::uuid
    )
  ) then
    raise exception 'recovery_probe_user_already_owns_room';
  end if;
end;
$$;

do $$
declare
  v_open regprocedure := pg_catalog.to_regprocedure(
    'public.open_demo_room_with_host(uuid,text,text,uuid,text,text,text)'
  );
  v_public_execute boolean;
begin
  select pg_catalog.coalesce(
    pg_catalog.bool_or(
      privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ),
    false
  )
  into v_public_execute
  from pg_catalog.pg_proc procedure_row
  cross join lateral pg_catalog.aclexplode(procedure_row.proacl) privilege
  where procedure_row.oid = v_open;

  if v_open is null
     or not exists (
       select 1 from pg_catalog.pg_proc
       where oid = v_open
         and prosecdef
         and provolatile = 'v'
         and proconfig = array['search_path=""']
     )
     or v_public_execute
     or pg_catalog.has_function_privilege('anon', v_open, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_open, 'execute')
     or not pg_catalog.has_function_privilege('service_role', v_open, 'execute')
  then
    raise exception 'open_demo_room_function_security_contract_invalid';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'receipts_undoes_receipt_id_fkey'
      and conrelid = 'public.receipts'::regclass
      and confdeltype = 'a'
      and condeferrable
      and condeferred
  ) then
    raise exception 'receipt_undo_constraint_not_deferred';
  end if;
  if pg_catalog.to_regclass('public.rooms_demo_host_activity_idx') is null then
    raise exception 'demo_host_activity_index_missing';
  end if;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform public.open_demo_room_with_host(
      gen_random_uuid(),
      'denied-' || pg_catalog.replace(gen_random_uuid()::text, '-', ''),
      'Denied',
      current_setting('ccr.host')::uuid,
      'Host',
      '#2563EB',
      'denied_recovery_token_0123456789_ab'
    );
    raise exception 'authenticated_open_was_callable';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Direct INSERT preserves explicit old timestamps; rooms_touch_updated_at is
-- intentionally not disabled.
insert into public.rooms (
  id, slug, name, mode, created_by, created_at, updated_at
) values
  (
    :'cc_old_room_id'::uuid,
    'old-' || pg_catalog.replace(:'cc_old_room_id', '-', ''),
    'Older stale room', 'demo', :'host_user_id'::uuid,
    pg_catalog.clock_timestamp() - interval '26 hours',
    pg_catalog.clock_timestamp() - interval '26 hours'
  ),
  (
    :'cc_latest_room_id'::uuid,
    'latest-' || pg_catalog.replace(:'cc_latest_room_id', '-', ''),
    'Latest stale room', 'demo', :'host_user_id'::uuid,
    pg_catalog.clock_timestamp() - interval '25 hours',
    pg_catalog.clock_timestamp() - interval '25 hours'
  ),
  (
    :'cc_control_room_id'::uuid,
    'control-' || pg_catalog.replace(:'cc_control_room_id', '-', ''),
    'Other actor room', 'demo', :'control_user_id'::uuid,
    pg_catalog.clock_timestamp() - interval '25 hours',
    pg_catalog.clock_timestamp() - interval '25 hours'
  );

insert into public.room_members (room_id, user_id, role, display_name, color)
values
  (:'cc_old_room_id'::uuid, :'host_user_id'::uuid, 'host', 'Host', '#2563EB'),
  (:'cc_latest_room_id'::uuid, :'host_user_id'::uuid, 'host', 'Host', '#2563EB'),
  (:'cc_control_room_id'::uuid, :'control_user_id'::uuid, 'host', 'Control', '#F97316');

insert into private.room_join_capabilities (room_id, join_token_sha256)
values
  (
    :'cc_old_room_id'::uuid,
    pg_catalog.sha256(pg_catalog.convert_to('old_room_join_token_0123456789_ab', 'UTF8'))
  ),
  (
    :'cc_latest_room_id'::uuid,
    pg_catalog.sha256(pg_catalog.convert_to('latest_room_join_token_0123456789_ab', 'UTF8'))
  ),
  (
    :'cc_control_room_id'::uuid,
    pg_catalog.sha256(pg_catalog.convert_to('control_room_join_token_0123456789_ab', 'UTF8'))
  );

insert into public.canvas_objects (
  id, room_id, object_type, title, x, y, width, height, z_index,
  minimized, pinned, created_by, version, revision, metadata, payload
) values (
  :'cc_object_id', :'cc_old_room_id'::uuid, 'note', 'Stale child',
  40, 60, 300, 180, 1, false, false, :'host_user_id'::uuid, 1, 1,
  '{}'::jsonb,
  '{"text":"Must cascade with old room","tone":"sky"}'::jsonb
);

insert into public.receipts (
  id, room_id, revision, actor_user_id, actor_type, source,
  actor_display_name, action, affected_object_ids, previous_state,
  resulting_state, inverse_command, reversible, undoes_receipt_id, description
) values
  (
    :'cc_receipt_id'::uuid, :'cc_old_room_id'::uuid, 1,
    :'host_user_id'::uuid, 'human', 'system', 'Host', 'create',
    array[:'cc_object_id'], '[]'::jsonb, '[]'::jsonb, null, true, null,
    'Host created a stale child.'
  ),
  (
    :'cc_undo_receipt_id'::uuid, :'cc_old_room_id'::uuid, 2,
    :'host_user_id'::uuid, 'human', 'system', 'Host', 'undo',
    array[:'cc_object_id'], '[]'::jsonb, '[]'::jsonb, null, false,
    :'cc_receipt_id'::uuid, 'Host undid the stale child.'
  );

set local role service_role;
select public.open_demo_room_with_host(
  :'cc_proposed_one_id'::uuid,
  'proposed-one-' || pg_catalog.replace(:'cc_proposed_one_id', '-', ''),
  'Unused proposal', :'host_user_id'::uuid, 'Host', '#2563EB',
  'first_recovery_join_token_0123456789_ab'
) as first_result
\gset cc_
reset role;
select set_config('ccr.first_result', :'cc_first_result', true);

-- Force the now-deferred self-FK check during the probe, not at ROLLBACK.
set constraints receipts_undoes_receipt_id_fkey immediate;
set constraints receipts_undoes_receipt_id_fkey deferred;

do $$
begin
  if (current_setting('ccr.first_result')::jsonb ->> 'roomId')::uuid <>
     current_setting('ccr.latest_room')::uuid
     or current_setting('ccr.first_result')::jsonb ->> 'resumed' <> 'true'
  then
    raise exception 'latest_stale_room_was_not_resumed';
  end if;
  if exists (
    select 1 from public.rooms where id = current_setting('ccr.old_room')::uuid
  ) or exists (
    select 1 from public.canvas_objects where id = current_setting('ccr.object')
  ) or exists (
    select 1 from public.receipts
    where id in (
      current_setting('ccr.receipt')::uuid,
      current_setting('ccr.undo_receipt')::uuid
    )
  ) then
    raise exception 'older_stale_room_graph_remained';
  end if;
  if not exists (
    select 1 from public.rooms
    where id = current_setting('ccr.latest_room')::uuid
      and updated_at >= current_setting('ccr.started')::timestamptz
  ) or exists (
    select 1 from public.rooms where id = current_setting('ccr.proposed_one')::uuid
  ) then
    raise exception 'resume_created_or_lost_room';
  end if;
  if not exists (
    select 1 from public.rooms
    where id = current_setting('ccr.control_room')::uuid
      and name = 'Other actor room'
  ) then
    raise exception 'other_actor_room_changed';
  end if;
end;
$$;

-- The invite copied immediately before recovery remains valid for one hour.
set local role service_role;
select public.join_room_as_participant(
  :'cc_latest_room_id'::uuid, :'control_user_id'::uuid,
  'Grace participant', '#A855F7',
  'latest_room_join_token_0123456789_ab', 'participant'
) as old_invite_result
\gset cc_

select public.open_demo_room_with_host(
  :'cc_proposed_two_id'::uuid,
  'proposed-two-' || pg_catalog.replace(:'cc_proposed_two_id', '-', ''),
  'Unused second proposal', :'host_user_id'::uuid, 'Recovered Daniel',
  '#0EA5E9', 'second_recovery_join_token_0123456789_ab'
) as second_result
\gset cc_

select public.join_room_as_participant(
  :'cc_latest_room_id'::uuid, :'control_user_id'::uuid,
  'Grace participant', '#A855F7',
  'first_recovery_join_token_0123456789_ab', 'participant'
) as previous_invite_result
\gset cc_
reset role;

select
  set_config('ccr.old_invite_result', :'cc_old_invite_result', true),
  set_config('ccr.second_result', :'cc_second_result', true),
  set_config('ccr.previous_invite_result', :'cc_previous_invite_result', true);

do $$
begin
  if current_setting('ccr.old_invite_result')::jsonb ->> 'joined' <> 'true'
     or current_setting('ccr.previous_invite_result')::jsonb ->> 'joined' <> 'false'
  then
    raise exception 'bounded_invite_grace_failed';
  end if;
  if (current_setting('ccr.second_result')::jsonb ->> 'roomId')::uuid <>
     current_setting('ccr.latest_room')::uuid
     or current_setting('ccr.second_result')::jsonb ->> 'resumed' <> 'true'
  then
    raise exception 'second_open_did_not_resume_same_room';
  end if;
  if not exists (
    select 1 from private.room_join_capabilities
    where room_id = current_setting('ccr.latest_room')::uuid
      and join_token_sha256 = pg_catalog.sha256(
        pg_catalog.convert_to('second_recovery_join_token_0123456789_ab', 'UTF8')
      )
      and previous_join_token_sha256 = pg_catalog.sha256(
        pg_catalog.convert_to('first_recovery_join_token_0123456789_ab', 'UTF8')
      )
      and previous_join_token_valid_until > pg_catalog.clock_timestamp()
  ) then
    raise exception 'capability_rotation_invalid';
  end if;
end;
$$;

-- Reset/open share the same host lock. Removing the preserved room also lets
-- this probe exercise the no-room creation branch.
set local role service_role;
select public.delete_demo_room_as_host(
  :'cc_latest_room_id'::uuid,
  :'host_user_id'::uuid
);
select public.open_demo_room_with_host(
  :'cc_proposed_two_id'::uuid,
  'proposed-two-' || pg_catalog.replace(:'cc_proposed_two_id', '-', ''),
  'Fresh recovered room', :'host_user_id'::uuid, 'Recovered Daniel',
  '#0EA5E9', 'fresh_recovery_join_token_0123456789_ab'
) as created_result
\gset cc_
reset role;
select set_config('ccr.created_result', :'cc_created_result', true);

do $$
begin
  if (current_setting('ccr.created_result')::jsonb ->> 'roomId')::uuid <>
     current_setting('ccr.proposed_two')::uuid
     or current_setting('ccr.created_result')::jsonb ->> 'resumed' <> 'false'
  then
    raise exception 'open_create_branch_invalid';
  end if;
end;
$$;

-- The legacy RPC retains the explicit three-room abuse boundary.
set local role service_role;
select public.create_room_with_host(
  :'cc_legacy_two_id'::uuid,
  'legacy-two-' || pg_catalog.replace(:'cc_legacy_two_id', '-', ''),
  'Legacy two', 'demo', :'host_user_id'::uuid,
  'Recovered Daniel', '#0EA5E9', 'legacy_two_join_token_0123456789_ab'
);
select public.create_room_with_host(
  :'cc_legacy_three_id'::uuid,
  'legacy-three-' || pg_catalog.replace(:'cc_legacy_three_id', '-', ''),
  'Legacy three', 'demo', :'host_user_id'::uuid,
  'Recovered Daniel', '#0EA5E9', 'legacy_three_join_token_0123456789_ab'
);
do $$
begin
  begin
    perform public.create_room_with_host(
      current_setting('ccr.rejected')::uuid,
      'rejected-' || pg_catalog.replace(current_setting('ccr.rejected'), '-', ''),
      'Rejected', 'demo', current_setting('ccr.host')::uuid,
      'Recovered Daniel', '#0EA5E9', 'rejected_join_token_0123456789_abcdef'
    );
    raise exception 'legacy_fourth_room_was_admitted';
  exception when raise_exception then
    if sqlerrm <> 'demo_room_limit_reached' then raise; end if;
  end;
end;
$$;
reset role;

do $$
begin
  if (
    select pg_catalog.count(*) from public.rooms
    where created_by = current_setting('ccr.host')::uuid and mode = 'demo'
  ) <> 3 then
    raise exception 'legacy_demo_room_limit_changed';
  end if;
  if not exists (
    select 1 from public.rooms
    where id = current_setting('ccr.control_room')::uuid
      and name = 'Other actor room'
  ) then
    raise exception 'other_actor_control_room_changed';
  end if;
end;
$$;

rollback;
