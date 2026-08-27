\set ON_ERROR_STOP on

-- Required input is one existing Supabase Auth user UUID:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -f supabase/tests/room_revision_cas_probes.sql
--
-- Run with a privileged connection. Every fixture is rolled back.

begin;

select
  gen_random_uuid() as target_room_id,
  gen_random_uuid() as unrelated_room_id,
  gen_random_uuid() as target_receipt_id,
  gen_random_uuid() as rejected_receipt_id,
  gen_random_uuid() as unrelated_receipt_id,
  gen_random_uuid() as missing_room_id,
  'note-' || replace(gen_random_uuid()::text, '-', '') as target_object_id,
  'note-' || replace(gen_random_uuid()::text, '-', '') as unrelated_object_id
\gset cc_

select
  set_config('commandcanvas.cas_target_room_id', :'cc_target_room_id', true),
  set_config('commandcanvas.cas_unrelated_room_id', :'cc_unrelated_room_id', true),
  set_config('commandcanvas.cas_target_receipt_id', :'cc_target_receipt_id', true),
  set_config('commandcanvas.cas_rejected_receipt_id', :'cc_rejected_receipt_id', true),
  set_config('commandcanvas.cas_target_object_id', :'cc_target_object_id', true),
  set_config('commandcanvas.cas_missing_room_id', :'cc_missing_room_id', true),
  set_config('commandcanvas.cas_host_user_id', :'host_user_id', true);

insert into public.rooms (
  id,
  slug,
  name,
  mode,
  created_by
) values
  (
    :'cc_target_room_id'::uuid,
    'cas-target-' || replace(:'cc_target_room_id', '-', ''),
    'Revision CAS target room',
    'demo',
    :'host_user_id'::uuid
  ),
  (
    :'cc_unrelated_room_id'::uuid,
    'cas-control-' || replace(:'cc_unrelated_room_id', '-', ''),
    'Revision CAS control room',
    'demo',
    :'host_user_id'::uuid
  );

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
) values
  (
    :'cc_target_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'CAS host',
    '#2563EB'
  ),
  (
    :'cc_unrelated_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'CAS host',
    '#2563EB'
  );

set local role service_role;

-- Give the unrelated room persisted object and receipt state. The rejected
-- target-room mutation must leave this complete control state untouched.
select public.commit_canvas_mutation(
  p_room_id => :'cc_unrelated_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'create',
  p_description => 'CAS host created the unrelated control note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_unrelated_object_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Unrelated control note',
        'x', 420,
        'y', 80,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Control state must remain exact","tone":"amber"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_unrelated_receipt_id'::uuid
);

-- Exact room revision zero succeeds and advances only the target room.
select public.commit_canvas_mutation_at_revision(
  p_room_id => :'cc_target_room_id'::uuid,
  p_expected_room_revision => 0,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'create',
  p_description => 'CAS host created the target note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_target_object_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Revision guarded note',
        'x', 40,
        'y', 60,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Exact revision create","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_target_receipt_id'::uuid
);

do $$
begin
  if (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.cas_target_room_id')::uuid
     ) <> 1
     or (
       select version
       from public.canvas_objects
       where id = current_setting('commandcanvas.cas_target_object_id')
     ) <> 1
     or (
       select count(*)
       from public.receipts
       where room_id = current_setting('commandcanvas.cas_target_room_id')::uuid
     ) <> 1
     or (
       select source
       from public.receipts
       where room_id = current_setting('commandcanvas.cas_target_room_id')::uuid
         and revision = 1
     ) <> 'system'
  then
    raise exception 'room_revision_cas_exact_revision_failed';
  end if;
end;
$$;

-- Snapshot complete persisted rows before the stale attempt. Equality after
-- refusal proves the guard caused zero room/object writes, not just equal
-- business columns after a compensating update.
select
  set_config(
    'commandcanvas.cas_target_room_snapshot',
    (select to_jsonb(room_row)::text
     from public.rooms room_row
     where room_row.id = :'cc_target_room_id'::uuid),
    true
  ),
  set_config(
    'commandcanvas.cas_target_object_snapshot',
    (select to_jsonb(object_row)::text
     from public.canvas_objects object_row
     where object_row.id = :'cc_target_object_id'),
    true
  ),
  set_config(
    'commandcanvas.cas_unrelated_room_snapshot',
    (select to_jsonb(room_row)::text
     from public.rooms room_row
     where room_row.id = :'cc_unrelated_room_id'::uuid),
    true
  ),
  set_config(
    'commandcanvas.cas_unrelated_object_snapshot',
    (select to_jsonb(object_row)::text
     from public.canvas_objects object_row
     where object_row.id = :'cc_unrelated_object_id'),
    true
  ),
  set_config(
    'commandcanvas.cas_unrelated_receipt_snapshot',
    (select to_jsonb(receipt_row)::text
     from public.receipts receipt_row
     where receipt_row.id = :'cc_unrelated_receipt_id'::uuid),
    true
  );

do $$
begin
  begin
    perform public.commit_canvas_mutation_at_revision(
      p_room_id => current_setting('commandcanvas.cas_target_room_id')::uuid,
      p_expected_room_revision => 0,
      p_actor_user_id => current_setting('commandcanvas.cas_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'transform',
      p_description => 'This stale room revision must not mutate state.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', current_setting('commandcanvas.cas_target_object_id'),
          'expectedVersion', 1,
          'after', jsonb_build_object(
            'type', 'note',
            'title', 'Revision guarded note',
            'x', 240,
            'y', 60,
            'width', 300,
            'height', 180,
            'zIndex', 1,
            'minimized', false,
            'pinned', false,
            'deletedAt', null,
            'metadata', '{}'::jsonb,
            'payload', '{"text":"Exact revision create","tone":"sky"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => current_setting(
        'commandcanvas.cas_rejected_receipt_id'
      )::uuid
    );
    raise exception 'stale_room_revision_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_room_revision_conflict' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  if (
       select to_jsonb(room_row)::text
       from public.rooms room_row
       where room_row.id = current_setting(
         'commandcanvas.cas_target_room_id'
       )::uuid
     ) is distinct from current_setting(
       'commandcanvas.cas_target_room_snapshot'
     )
     or (
       select to_jsonb(object_row)::text
       from public.canvas_objects object_row
       where object_row.id = current_setting(
         'commandcanvas.cas_target_object_id'
       )
     ) is distinct from current_setting(
       'commandcanvas.cas_target_object_snapshot'
     )
     or exists (
       select 1
       from public.receipts receipt
       where receipt.id = current_setting(
         'commandcanvas.cas_rejected_receipt_id'
       )::uuid
     )
     or (
       select count(*)
       from public.receipts receipt
       where receipt.room_id = current_setting(
         'commandcanvas.cas_target_room_id'
       )::uuid
     ) <> 1
  then
    raise exception 'stale_room_revision_changed_target_state';
  end if;

  if (
       select to_jsonb(room_row)::text
       from public.rooms room_row
       where room_row.id = current_setting(
         'commandcanvas.cas_unrelated_room_id'
       )::uuid
     ) is distinct from current_setting(
       'commandcanvas.cas_unrelated_room_snapshot'
     )
     or (
       select to_jsonb(object_row)::text
       from public.canvas_objects object_row
       where object_row.room_id = current_setting(
         'commandcanvas.cas_unrelated_room_id'
       )::uuid
     ) is distinct from current_setting(
       'commandcanvas.cas_unrelated_object_snapshot'
     )
     or (
       select to_jsonb(receipt_row)::text
       from public.receipts receipt_row
       where receipt_row.room_id = current_setting(
         'commandcanvas.cas_unrelated_room_id'
       )::uuid
     ) is distinct from current_setting(
       'commandcanvas.cas_unrelated_receipt_snapshot'
     )
  then
    raise exception 'stale_room_revision_changed_unrelated_room';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.commit_canvas_mutation_at_revision(
      p_room_id => current_setting('commandcanvas.cas_missing_room_id')::uuid,
      p_expected_room_revision => 0,
      p_actor_user_id => current_setting('commandcanvas.cas_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'create',
      p_description => 'Missing room probe.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'missing_room_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_room_not_found' then
        raise;
      end if;
  end;
end;
$$;

reset role;

do $$
declare
  v_function_oid oid;
begin
  v_function_oid := to_regprocedure(
    'public.commit_canvas_mutation_at_revision(uuid,bigint,uuid,text,text,text,text,jsonb,jsonb,boolean,uuid,uuid)'
  );

  if v_function_oid is null then
    raise exception 'room_revision_cas_rpc_missing';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    where function_row.oid = v_function_oid
      and function_row.prosecdef
      and function_row.provolatile = 'v'
      and function_row.proconfig = array['search_path=""']
  ) then
    raise exception 'room_revision_cas_security_configuration_invalid';
  end if;

  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_function_oid, 'EXECUTE')
  then
    raise exception 'room_revision_cas_role_grants_invalid';
  end if;

  if exists (
    select 1
    from pg_proc function_row,
         lateral aclexplode(
           coalesce(
             function_row.proacl,
             acldefault('f', function_row.proowner)
           )
         ) acl
    where function_row.oid = v_function_oid
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee not in (
        function_row.proowner,
        'service_role'::regrole::oid
      )
  ) then
    raise exception 'room_revision_cas_unexpected_execute_grant';
  end if;
end;
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.commit_canvas_mutation_at_revision(
      p_room_id => gen_random_uuid(),
      p_expected_room_revision => 0,
      p_actor_user_id => gen_random_uuid(),
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'create',
      p_description => 'Authenticated execution probe.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'authenticated_wrapper_execution_was_accepted';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
set local role anon;

do $$
begin
  begin
    perform public.commit_canvas_mutation_at_revision(
      p_room_id => gen_random_uuid(),
      p_expected_room_revision => 0,
      p_actor_user_id => gen_random_uuid(),
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'create',
      p_description => 'Anonymous execution probe.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'anon_wrapper_execution_was_accepted';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;

do $$
begin
  raise notice 'room_revision_cas_probes_passed';
end;
$$;

rollback;
