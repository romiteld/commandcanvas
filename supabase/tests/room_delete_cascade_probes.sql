\set ON_ERROR_STOP on

-- Required inputs are two existing Supabase Auth user UUIDs:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -v unrelated_host_user_id='<uuid>' \
--   -f supabase/tests/room_delete_cascade_probes.sql
--
-- Run with a privileged connection. Service-role mutations exercise the
-- production grants and trigger behavior. Every fixture is rolled back.

begin;

select
  gen_random_uuid() as target_room_id,
  gen_random_uuid() as unrelated_room_id,
  gen_random_uuid() as target_receipt_id,
  gen_random_uuid() as target_undo_receipt_id,
  gen_random_uuid() as unrelated_receipt_id,
  'note-' || replace(gen_random_uuid()::text, '-', '') as target_object_id,
  'note-' || replace(gen_random_uuid()::text, '-', '') as unrelated_object_id
\gset cc_

select
  set_config('commandcanvas.target_room_id', :'cc_target_room_id', true),
  set_config('commandcanvas.unrelated_room_id', :'cc_unrelated_room_id', true),
  set_config('commandcanvas.target_receipt_id', :'cc_target_receipt_id', true),
  set_config(
    'commandcanvas.target_undo_receipt_id',
    :'cc_target_undo_receipt_id',
    true
  ),
  set_config('commandcanvas.unrelated_receipt_id', :'cc_unrelated_receipt_id', true),
  set_config('commandcanvas.target_object_id', :'cc_target_object_id', true),
  set_config(
    'commandcanvas.unrelated_object_id',
    :'cc_unrelated_object_id',
    true
  );

set local role service_role;

select public.create_room_with_host(
  p_room_id => :'cc_target_room_id'::uuid,
  p_slug => 'cascade-target-' || replace(:'cc_target_room_id', '-', ''),
  p_name => 'Cascade target room',
  p_mode => 'demo',
  p_host_user_id => :'host_user_id'::uuid,
  p_display_name => 'Cascade host',
  p_color => '#2563EB',
  p_join_token => 'target_join_token_0123456789_abcdef'
);

select public.create_room_with_host(
  p_room_id => :'cc_unrelated_room_id'::uuid,
  p_slug => 'cascade-other-' || replace(:'cc_unrelated_room_id', '-', ''),
  p_name => 'Unrelated room',
  p_mode => 'demo',
  p_host_user_id => :'unrelated_host_user_id'::uuid,
  p_display_name => 'Unrelated host',
  p_color => '#F97316',
  p_join_token => 'unrelated_join_token_0123456789_ab'
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_target_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_action => 'create',
  p_description => 'Cascade host created the target note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_target_object_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Target note',
        'x', 40,
        'y', 60,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Delete with parent only","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_target_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_unrelated_room_id'::uuid,
  p_actor_user_id => :'unrelated_host_user_id'::uuid,
  p_actor_type => 'human',
  p_action => 'create',
  p_description => 'Unrelated host created the control note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_unrelated_object_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Control note',
        'x', 80,
        'y', 100,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Must remain","tone":"amber"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_unrelated_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_target_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_action => 'undo',
  p_description => 'Cascade host undid the target note creation.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_target_receipt_id'::uuid,
  p_receipt_id => :'cc_target_undo_receipt_id'::uuid
);

do $$
begin
  begin
    update public.receipts
    set description = 'service-role tamper'
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'receipt_update_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'receipts are immutable' then
        raise;
      end if;
  end;

  begin
    delete from public.receipts
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'receipt_delete_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'receipts are immutable' then
        raise;
      end if;
  end;
end;
$$;

reset role;

do $$
begin
  begin
    update public.receipts
    set description = 'owner tamper'
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'owner_receipt_update_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'receipts are immutable' then
        raise;
      end if;
  end;

  begin
    delete from public.receipts
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'owner_receipt_delete_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'receipts are immutable' then
        raise;
      end if;
  end;
end;
$$;

set local role authenticated;

do $$
begin
  begin
    update public.receipts
    set description = 'authenticated tamper'
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'authenticated_receipt_update_was_accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    delete from public.receipts
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'authenticated_receipt_delete_was_accepted';
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
    update public.receipts
    set description = 'anonymous tamper'
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'anonymous_receipt_update_was_accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    delete from public.receipts
    where id = current_setting('commandcanvas.target_receipt_id')::uuid;
    raise exception 'anonymous_receipt_delete_was_accepted';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
set local role service_role;

delete from public.rooms
where id = :'cc_target_room_id'::uuid;

reset role;

do $$
begin
  if exists (
    select 1
    from public.rooms room_row
    where room_row.id = current_setting('commandcanvas.target_room_id')::uuid
  ) then
    raise exception 'target_room_not_deleted';
  end if;

  if exists (
    select 1
    from public.room_members member
    where member.room_id = current_setting('commandcanvas.target_room_id')::uuid
  ) then
    raise exception 'target_room_members_not_cascaded';
  end if;

  if exists (
    select 1
    from public.canvas_objects object_row
    where object_row.room_id = current_setting('commandcanvas.target_room_id')::uuid
  ) then
    raise exception 'target_canvas_objects_not_cascaded';
  end if;

  if exists (
    select 1
    from public.receipts receipt
    where receipt.room_id = current_setting('commandcanvas.target_room_id')::uuid
  ) then
    raise exception 'target_receipts_not_cascaded';
  end if;

  if exists (
    select 1
    from private.room_join_capabilities capability
    where capability.room_id = current_setting('commandcanvas.target_room_id')::uuid
  ) then
    raise exception 'target_join_capability_not_cascaded';
  end if;

  if not exists (
    select 1
    from public.rooms room_row
    where room_row.id = current_setting('commandcanvas.unrelated_room_id')::uuid
  )
  or not exists (
    select 1
    from public.room_members member
    where member.room_id = current_setting('commandcanvas.unrelated_room_id')::uuid
  )
  or not exists (
    select 1
    from public.canvas_objects object_row
    where object_row.id = current_setting('commandcanvas.unrelated_object_id')
  )
  or not exists (
    select 1
    from public.receipts receipt
    where receipt.id = current_setting('commandcanvas.unrelated_receipt_id')::uuid
  )
  or not exists (
    select 1
    from private.room_join_capabilities capability
    where capability.room_id = current_setting('commandcanvas.unrelated_room_id')::uuid
  ) then
    raise exception 'unrelated_room_was_modified';
  end if;

  if not (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = 'private.reject_receipt_mutation()'::regprocedure
  ) then
    raise exception 'receipt_guard_not_security_definer';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = 'private.reject_receipt_mutation()'::regprocedure
      and procedure.proconfig @> array['search_path=""']
  ) then
    raise exception 'receipt_guard_search_path_not_empty';
  end if;

  if has_function_privilege(
       'service_role',
       'private.reject_receipt_mutation()',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'private.reject_receipt_mutation()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'private.reject_receipt_mutation()',
       'execute'
     )
  then
    raise exception 'receipt_guard_execute_acl_too_broad';
  end if;

  raise notice 'room_delete_cascade_probes_passed';
end;
$$;

rollback;
