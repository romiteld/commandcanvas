\set ON_ERROR_STOP on

-- Required inputs are two existing Supabase Auth user UUIDs. The host fixture
-- must not own any rooms before this rolled-back probe starts.
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<fresh-auth-user-uuid>' \
--   -v participant_user_id='<auth-user-uuid>' \
--   -f supabase/tests/demo_room_lifecycle_probes.sql

begin;

select
  gen_random_uuid() as room_one_id,
  gen_random_uuid() as room_two_id,
  gen_random_uuid() as room_three_id,
  gen_random_uuid() as rejected_room_id,
  gen_random_uuid() as replacement_room_id,
  gen_random_uuid() as receipt_id,
  'note-' || replace(gen_random_uuid()::text, '-', '') as object_id
\gset cc_

select
  set_config('commandcanvas.lifecycle.host_user_id', :'host_user_id', true),
  set_config(
    'commandcanvas.lifecycle.participant_user_id',
    :'participant_user_id',
    true
  ),
  set_config('commandcanvas.lifecycle.room_one_id', :'cc_room_one_id', true),
  set_config('commandcanvas.lifecycle.room_two_id', :'cc_room_two_id', true),
  set_config('commandcanvas.lifecycle.room_three_id', :'cc_room_three_id', true),
  set_config(
    'commandcanvas.lifecycle.rejected_room_id',
    :'cc_rejected_room_id',
    true
  ),
  set_config(
    'commandcanvas.lifecycle.replacement_room_id',
    :'cc_replacement_room_id',
    true
  );

do $$
begin
  if exists (
    select 1
    from public.rooms room_row
    where room_row.created_by = current_setting(
      'commandcanvas.lifecycle.host_user_id'
    )::uuid
  ) then
    raise exception 'demo_room_lifecycle_host_fixture_not_fresh';
  end if;
end;
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.delete_demo_room_as_host(
      current_setting('commandcanvas.lifecycle.room_one_id')::uuid,
      current_setting('commandcanvas.lifecycle.host_user_id')::uuid
    );
    raise exception 'authenticated_demo_delete_rpc_was_callable';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;

select public.create_room_with_host(
  :'cc_room_one_id'::uuid,
  'demo-one-' || replace(:'cc_room_one_id', '-', ''),
  'Demo room one',
  'demo',
  :'host_user_id'::uuid,
  'Lifecycle host',
  '#2563EB',
  'demo_room_one_join_token_0123456789'
);

select public.create_room_with_host(
  :'cc_room_two_id'::uuid,
  'demo-two-' || replace(:'cc_room_two_id', '-', ''),
  'Demo room two',
  'demo',
  :'host_user_id'::uuid,
  'Lifecycle host',
  '#2563EB',
  'demo_room_two_join_token_0123456789'
);

select public.create_room_with_host(
  :'cc_room_three_id'::uuid,
  'demo-three-' || replace(:'cc_room_three_id', '-', ''),
  'Demo room three',
  'demo',
  :'host_user_id'::uuid,
  'Lifecycle host',
  '#2563EB',
  'demo_room_three_join_token_01234567'
);

do $$
begin
  begin
    perform public.create_room_with_host(
      current_setting('commandcanvas.lifecycle.rejected_room_id')::uuid,
      'demo-rejected-' || pg_catalog.replace(
        current_setting('commandcanvas.lifecycle.rejected_room_id'),
        '-',
        ''
      ),
      'Rejected fourth demo room',
      'demo',
      current_setting('commandcanvas.lifecycle.host_user_id')::uuid,
      'Lifecycle host',
      '#2563EB',
      'demo_room_rejected_join_token_012345'
    );
    raise exception 'fourth_demo_room_was_admitted';
  exception
    when raise_exception then
      if sqlerrm <> 'demo_room_limit_reached' then
        raise;
      end if;
  end;
end;
$$;

select public.join_room_as_participant(
  :'cc_room_one_id'::uuid,
  :'participant_user_id'::uuid,
  'Lifecycle participant',
  '#A855F7',
  'demo_room_one_join_token_0123456789',
  'participant'
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_room_one_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'create',
  p_description => 'Lifecycle host created a disposable note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_object_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Disposable note',
        'x', 40,
        'y', 60,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Cascade with the demo room","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_receipt_id'::uuid
);

do $$
begin
  begin
    perform public.delete_demo_room_as_host(
      current_setting('commandcanvas.lifecycle.room_one_id')::uuid,
      current_setting('commandcanvas.lifecycle.participant_user_id')::uuid
    );
    raise exception 'participant_deleted_demo_room';
  exception
    when raise_exception then
      if sqlerrm <> 'demo_room_delete_forbidden' then
        raise;
      end if;
  end;
end;
$$;

select public.delete_demo_room_as_host(
  :'cc_room_one_id'::uuid,
  :'host_user_id'::uuid
) as delete_result
\gset cc_

select set_config(
  'commandcanvas.lifecycle.delete_result',
  :'cc_delete_result',
  true
);

select public.create_room_with_host(
  :'cc_replacement_room_id'::uuid,
  'demo-replacement-' || replace(:'cc_replacement_room_id', '-', ''),
  'Replacement demo room',
  'demo',
  :'host_user_id'::uuid,
  'Lifecycle host',
  '#2563EB',
  'demo_room_replacement_token_01234567'
);

reset role;

do $$
declare
  v_delete_result jsonb := current_setting(
    'commandcanvas.lifecycle.delete_result'
  )::jsonb;
begin
  if v_delete_result <> pg_catalog.jsonb_build_object(
    'roomId', current_setting('commandcanvas.lifecycle.room_one_id')::uuid,
    'deleted', true
  ) then
    raise exception 'demo_room_delete_result_invalid';
  end if;

  if exists (
    select 1
    from public.rooms
    where id = current_setting('commandcanvas.lifecycle.room_one_id')::uuid
  ) or exists (
    select 1
    from public.room_members
    where room_id = current_setting('commandcanvas.lifecycle.room_one_id')::uuid
  ) or exists (
    select 1
    from public.canvas_objects
    where room_id = current_setting('commandcanvas.lifecycle.room_one_id')::uuid
  ) or exists (
    select 1
    from public.receipts
    where room_id = current_setting('commandcanvas.lifecycle.room_one_id')::uuid
  ) or exists (
    select 1
    from private.room_join_capabilities
    where room_id = current_setting('commandcanvas.lifecycle.room_one_id')::uuid
  ) then
    raise exception 'deleted_demo_room_children_remained';
  end if;

  if exists (
    select 1
    from public.rooms
    where id = current_setting('commandcanvas.lifecycle.rejected_room_id')::uuid
  ) then
    raise exception 'rejected_demo_room_was_persisted';
  end if;

  if (
    select pg_catalog.count(*)
    from public.rooms room_row
    where room_row.created_by = current_setting(
      'commandcanvas.lifecycle.host_user_id'
    )::uuid
      and room_row.mode = 'demo'
  ) <> 3 then
    raise exception 'demo_room_slot_was_not_reclaimed';
  end if;

  if (
    select pg_catalog.count(*)
    from public.rooms
    where id in (
      current_setting('commandcanvas.lifecycle.room_two_id')::uuid,
      current_setting('commandcanvas.lifecycle.room_three_id')::uuid,
      current_setting('commandcanvas.lifecycle.replacement_room_id')::uuid
    )
  ) <> 3 then
    raise exception 'unrelated_demo_rooms_changed';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.delete_demo_room_as_host(uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.delete_demo_room_as_host(uuid,uuid)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.delete_demo_room_as_host(uuid,uuid)',
       'execute'
     )
  then
    raise exception 'demo_room_delete_rpc_acl_invalid';
  end if;

  if not (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.delete_demo_room_as_host(uuid,uuid)'::regprocedure
  ) then
    raise exception 'demo_room_delete_rpc_not_security_definer';
  end if;

  raise notice 'demo_room_lifecycle_probes_passed';
end;
$$;

rollback;
