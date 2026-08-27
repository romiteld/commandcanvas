\set ON_ERROR_STOP on

-- Required input is one existing Supabase Auth user UUID:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -f supabase/tests/demo_room_storage_caps_probes.sql
--
-- Run with a privileged connection. Every fixture is rolled back.

begin;

select
  gen_random_uuid() as revision_room_id,
  gen_random_uuid() as object_room_id,
  gen_random_uuid() as standard_room_id,
  gen_random_uuid() as revision_400_receipt_id,
  gen_random_uuid() as rejected_revision_receipt_id,
  gen_random_uuid() as accepted_transform_receipt_id,
  gen_random_uuid() as rejected_object_receipt_id,
  gen_random_uuid() as standard_receipt_id
\gset cc_cap_

select
  pg_catalog.set_config(
    'commandcanvas.cap_revision_room_id',
    :'cc_cap_revision_room_id',
    true
  ),
  pg_catalog.set_config(
    'commandcanvas.cap_object_room_id',
    :'cc_cap_object_room_id',
    true
  ),
  pg_catalog.set_config(
    'commandcanvas.cap_standard_room_id',
    :'cc_cap_standard_room_id',
    true
  ),
  pg_catalog.set_config(
    'commandcanvas.cap_rejected_revision_receipt_id',
    :'cc_cap_rejected_revision_receipt_id',
    true
  ),
  pg_catalog.set_config(
    'commandcanvas.cap_rejected_object_receipt_id',
    :'cc_cap_rejected_object_receipt_id',
    true
  ),
  pg_catalog.set_config(
    'commandcanvas.cap_host_user_id',
    :'host_user_id',
    true
  );

insert into public.rooms (
  id,
  slug,
  name,
  mode,
  revision,
  created_by
) values
  (
    :'cc_cap_revision_room_id'::uuid,
    'cap-revision-' || replace(:'cc_cap_revision_room_id', '-', ''),
    'Demo revision cap probe',
    'demo',
    399,
    :'host_user_id'::uuid
  ),
  (
    :'cc_cap_object_room_id'::uuid,
    'cap-objects-' || replace(:'cc_cap_object_room_id', '-', ''),
    'Demo object cap probe',
    'demo',
    1,
    :'host_user_id'::uuid
  ),
  (
    :'cc_cap_standard_room_id'::uuid,
    'cap-standard-' || replace(:'cc_cap_standard_room_id', '-', ''),
    'Standard room control',
    'standard',
    400,
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
    :'cc_cap_revision_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'Storage cap host',
    '#2563EB'
  ),
  (
    :'cc_cap_object_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'Storage cap host',
    '#2563EB'
  ),
  (
    :'cc_cap_standard_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'Storage cap host',
    '#2563EB'
  );

insert into public.canvas_objects (
  id,
  room_id,
  object_type,
  title,
  x,
  y,
  width,
  height,
  z_index,
  minimized,
  pinned,
  created_by,
  version,
  revision,
  metadata,
  payload
) values (
  'demo-revision-object',
  :'cc_cap_revision_room_id'::uuid,
  'note',
  'Revision cap note',
  10,
  10,
  280,
  180,
  1,
  false,
  false,
  :'host_user_id'::uuid,
  1,
  399,
  '{}'::jsonb,
  '{"text":"Revision cap probe","tone":"sky"}'::jsonb
);

insert into public.canvas_objects (
  id,
  room_id,
  object_type,
  title,
  x,
  y,
  width,
  height,
  z_index,
  minimized,
  pinned,
  created_by,
  version,
  revision,
  metadata,
  payload
)
select
  'demo-cap-object-' || pg_catalog.lpad(series_value::text, 3, '0'),
  :'cc_cap_object_room_id'::uuid,
  'note',
  'Demo object ' || series_value,
  series_value,
  20,
  280,
  180,
  series_value,
  false,
  false,
  :'host_user_id'::uuid,
  1,
  1,
  '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'text', 'Demo cap fixture ' || series_value,
    'tone', 'sky'
  )
from pg_catalog.generate_series(1, 160) series_value;

insert into public.canvas_objects (
  id,
  room_id,
  object_type,
  title,
  x,
  y,
  width,
  height,
  z_index,
  minimized,
  pinned,
  created_by,
  version,
  revision,
  metadata,
  payload
)
select
  'standard-cap-object-' || pg_catalog.lpad(series_value::text, 3, '0'),
  :'cc_cap_standard_room_id'::uuid,
  'note',
  'Standard object ' || series_value,
  series_value,
  20,
  280,
  180,
  series_value,
  false,
  false,
  :'host_user_id'::uuid,
  1,
  400,
  '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'text', 'Standard control fixture ' || series_value,
    'tone', 'sky'
  )
from pg_catalog.generate_series(1, 160) series_value;

set local role service_role;

-- Revision 400 is admitted for a demo room.
select public.commit_canvas_mutation_at_revision(
  p_room_id => :'cc_cap_revision_room_id'::uuid,
  p_expected_room_revision => 399,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'transform',
  p_description => 'Storage cap host moved the revision probe note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', 'demo-revision-object',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Revision cap note',
        'x', 20,
        'y', 10,
        'width', 280,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Revision cap probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_cap_revision_400_receipt_id'::uuid
);

do $$
begin
  if (
       select revision
       from public.rooms
       where id = current_setting(
         'commandcanvas.cap_revision_room_id'
       )::uuid
     ) <> 400
     or (
       select version
       from public.canvas_objects
       where id = 'demo-revision-object'
     ) <> 2
  then
    raise exception 'demo_revision_400_was_not_admitted';
  end if;
end;
$$;

-- Any 401st demo revision is refused before persisted state changes.
do $$
begin
  begin
    perform public.commit_canvas_mutation_at_revision(
      p_room_id => current_setting(
        'commandcanvas.cap_revision_room_id'
      )::uuid,
      p_expected_room_revision => 400,
      p_actor_user_id => current_setting(
        'commandcanvas.cap_host_user_id'
      )::uuid,
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'transform',
      p_description => 'This 401st demo revision must be refused.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', 'demo-revision-object',
          'expectedVersion', 2,
          'after', jsonb_build_object(
            'type', 'note',
            'title', 'Revision cap note',
            'x', 30,
            'y', 10,
            'width', 280,
            'height', 180,
            'zIndex', 1,
            'minimized', false,
            'pinned', false,
            'deletedAt', null,
            'metadata', '{}'::jsonb,
            'payload', '{"text":"Revision cap probe","tone":"sky"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => current_setting(
        'commandcanvas.cap_rejected_revision_receipt_id'
      )::uuid
    );
    raise exception 'demo_revision_401_was_admitted';
  exception
    when raise_exception then
      if sqlerrm <> 'demo_room_storage_limit_reached' then
        raise;
      end if;
  end;

  if (
       select revision
       from public.rooms
       where id = current_setting(
         'commandcanvas.cap_revision_room_id'
       )::uuid
     ) <> 400
     or (
       select version
       from public.canvas_objects
       where id = 'demo-revision-object'
     ) <> 2
     or (
       select x
       from public.canvas_objects
       where id = 'demo-revision-object'
     ) <> 20
     or exists (
       select 1
       from public.receipts
       where id = current_setting(
         'commandcanvas.cap_rejected_revision_receipt_id'
       )::uuid
     )
  then
    raise exception 'demo_revision_cap_changed_persisted_state';
  end if;
end;
$$;

-- At exactly 160 live objects, a non-growing mutation remains valid.
select public.commit_canvas_mutation_at_revision(
  p_room_id => :'cc_cap_object_room_id'::uuid,
  p_expected_room_revision => 1,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'transform',
  p_description => 'Storage cap host moved one existing object.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', 'demo-cap-object-001',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Demo object 1',
        'x', 50,
        'y', 20,
        'width', 280,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Demo cap fixture 1","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_cap_accepted_transform_receipt_id'::uuid
);

-- A 161st live object is refused after the inner mutation; the raised
-- exception must roll back its object, receipt, and revision atomically.
do $$
begin
  begin
    perform public.commit_canvas_mutation_at_revision(
      p_room_id => current_setting(
        'commandcanvas.cap_object_room_id'
      )::uuid,
      p_expected_room_revision => 2,
      p_actor_user_id => current_setting(
        'commandcanvas.cap_host_user_id'
      )::uuid,
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'create',
      p_description => 'This 161st demo object must be refused.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', 'demo-cap-object-161',
          'expectedVersion', null,
          'after', jsonb_build_object(
            'type', 'note',
            'title', 'Rejected object 161',
            'x', 161,
            'y', 20,
            'width', 280,
            'height', 180,
            'zIndex', 161,
            'minimized', false,
            'pinned', false,
            'deletedAt', null,
            'metadata', '{}'::jsonb,
            'payload', '{"text":"Must roll back","tone":"amber"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => current_setting(
        'commandcanvas.cap_rejected_object_receipt_id'
      )::uuid
    );
    raise exception 'demo_object_161_was_admitted';
  exception
    when raise_exception then
      if sqlerrm <> 'demo_room_storage_limit_reached' then
        raise;
      end if;
  end;

  if (
       select revision
       from public.rooms
       where id = current_setting(
         'commandcanvas.cap_object_room_id'
       )::uuid
     ) <> 2
     or (
       select pg_catalog.count(*)
       from public.canvas_objects
       where room_id = current_setting(
         'commandcanvas.cap_object_room_id'
       )::uuid
         and deleted_at is null
     ) <> 160
     or exists (
       select 1
       from public.canvas_objects
       where id = 'demo-cap-object-161'
     )
     or exists (
       select 1
       from public.receipts
       where id = current_setting(
         'commandcanvas.cap_rejected_object_receipt_id'
       )::uuid
     )
  then
    raise exception 'demo_object_cap_did_not_roll_back_atomically';
  end if;
end;
$$;

-- Standard rooms keep their existing unbounded behavior.
select public.commit_canvas_mutation_at_revision(
  p_room_id => :'cc_cap_standard_room_id'::uuid,
  p_expected_room_revision => 400,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'create',
  p_description => 'Standard room created object 161 after revision 400.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', 'standard-cap-object-161',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Standard object 161',
        'x', 161,
        'y', 20,
        'width', 280,
        'height', 180,
        'zIndex', 161,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Standard rooms are unchanged","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_cap_standard_receipt_id'::uuid
);

do $$
declare
  v_function_oid oid;
begin
  if (
       select revision
       from public.rooms
       where id = current_setting(
         'commandcanvas.cap_standard_room_id'
       )::uuid
     ) <> 401
     or (
       select pg_catalog.count(*)
       from public.canvas_objects
       where room_id = current_setting(
         'commandcanvas.cap_standard_room_id'
       )::uuid
         and deleted_at is null
     ) <> 161
  then
    raise exception 'standard_room_behavior_changed_by_demo_caps';
  end if;

  v_function_oid := pg_catalog.to_regprocedure(
    'public.commit_canvas_mutation_at_revision(uuid,bigint,uuid,text,text,text,text,jsonb,jsonb,boolean,uuid,uuid)'
  );

  if v_function_oid is null then
    raise exception 'demo_storage_cap_rpc_missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_function_oid
      and function_row.prosecdef
      and function_row.provolatile = 'v'
      and function_row.proconfig = array['search_path=""']
  ) then
    raise exception 'demo_storage_cap_rpc_security_configuration_invalid';
  end if;

  if pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_function_oid,
       'EXECUTE'
     )
  then
    raise exception 'demo_storage_cap_rpc_role_grants_invalid';
  end if;
end;
$$;

reset role;
rollback;
