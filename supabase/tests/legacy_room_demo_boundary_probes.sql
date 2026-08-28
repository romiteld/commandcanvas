\set ON_ERROR_STOP on

-- Required inputs are one confirmed, non-anonymous host and two existing Auth
-- users. The second user exercises the standard-room refusal; the third joins
-- the demo room. Every fixture is rolled back.
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<confirmed-user-uuid>' \
--   -v participant_user_id='<uuid>' \
--   -v outsider_user_id='<uuid>' \
--   -f supabase/tests/legacy_room_demo_boundary_probes.sql

begin;

select
  gen_random_uuid() as rejected_standard_room_id,
  gen_random_uuid() as standard_room_id,
  gen_random_uuid() as demo_room_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as rejected_standard_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as standard_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as demo_slug,
  replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '') as standard_join_token,
  replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '') as demo_join_token
\gset cc_

select
  set_config(
    'commandcanvas.test_rejected_standard_room_id',
    :'cc_rejected_standard_room_id',
    true
  ),
  set_config(
    'commandcanvas.test_rejected_standard_slug',
    :'cc_rejected_standard_slug',
    true
  ),
  set_config(
    'commandcanvas.test_standard_room_id',
    :'cc_standard_room_id',
    true
  ),
  set_config('commandcanvas.test_demo_room_id', :'cc_demo_room_id', true),
  set_config(
    'commandcanvas.test_standard_join_token',
    :'cc_standard_join_token',
    true
  ),
  set_config('commandcanvas.test_host_user_id', :'host_user_id', true),
  set_config(
    'commandcanvas.test_participant_user_id',
    :'participant_user_id',
    true
  );

set local role service_role;

do $$
begin
  begin
    perform public.create_room_with_host(
      p_room_id => current_setting(
        'commandcanvas.test_rejected_standard_room_id'
      )::uuid,
      p_slug => current_setting('commandcanvas.test_rejected_standard_slug'),
      p_name => 'Legacy standard create must fail',
      p_mode => 'standard',
      p_host_user_id => current_setting(
        'commandcanvas.test_host_user_id'
      )::uuid,
      p_display_name => 'Probe Host',
      p_color => '#2563EB',
      p_join_token => current_setting(
        'commandcanvas.test_standard_join_token'
      )
    );
    raise exception 'legacy_standard_room_create_was_admitted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_invalid_mode' then
        raise;
      end if;
  end;
end;
$$;

select public.create_standard_meeting_with_host(
  p_room_id => :'cc_standard_room_id'::uuid,
  p_slug => :'cc_standard_slug',
  p_name => 'Invitation-only standard room',
  p_host_user_id => :'host_user_id'::uuid,
  p_display_name => 'Probe Host',
  p_color => '#2563EB',
  p_join_token => :'cc_standard_join_token'
) as standard_create_result
\gset cc_

do $$
begin
  begin
    perform public.join_room_as_participant(
      p_room_id => current_setting('commandcanvas.test_standard_room_id')::uuid,
      p_user_id => current_setting(
        'commandcanvas.test_participant_user_id'
      )::uuid,
      p_display_name => 'Legacy Join Refused',
      p_color => '#F97316',
      p_join_token => current_setting(
        'commandcanvas.test_standard_join_token'
      ),
      p_requested_role => 'participant'
    );
    raise exception 'legacy_standard_room_join_was_admitted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_join_token_mismatch' then
        raise;
      end if;
  end;
end;
$$;

select public.create_room_with_host(
  p_room_id => :'cc_demo_room_id'::uuid,
  p_slug => :'cc_demo_slug',
  p_name => 'Legacy demo path remains available',
  p_mode => 'demo',
  p_host_user_id => :'host_user_id'::uuid,
  p_display_name => 'Probe Host',
  p_color => '#2563EB',
  p_join_token => :'cc_demo_join_token'
) as demo_create_result
\gset cc_

select public.join_room_as_participant(
  p_room_id => :'cc_demo_room_id'::uuid,
  p_user_id => :'outsider_user_id'::uuid,
  p_display_name => 'Demo Participant',
  p_color => '#16A34A',
  p_join_token => :'cc_demo_join_token',
  p_requested_role => 'participant'
) as demo_join_result
\gset cc_

reset role;

select
  set_config(
    'commandcanvas.test_standard_create_result',
    :'cc_standard_create_result',
    true
  ),
  set_config(
    'commandcanvas.test_demo_create_result',
    :'cc_demo_create_result',
    true
  ),
  set_config(
    'commandcanvas.test_demo_join_result',
    :'cc_demo_join_result',
    true
  );

do $$
declare
  v_standard_result jsonb := current_setting(
    'commandcanvas.test_standard_create_result'
  )::jsonb;
  v_demo_create_result jsonb := current_setting(
    'commandcanvas.test_demo_create_result'
  )::jsonb;
  v_demo_join_result jsonb := current_setting(
    'commandcanvas.test_demo_join_result'
  )::jsonb;
begin
  if exists (
    select 1
    from public.rooms room_row
    where room_row.id = current_setting(
      'commandcanvas.test_rejected_standard_room_id'
    )::uuid
  ) then
    raise exception 'rejected_legacy_standard_room_was_persisted';
  end if;

  if v_standard_result ->> 'roomId' <> current_setting(
       'commandcanvas.test_standard_room_id'
     )
     or v_standard_result ->> 'role' <> 'host'
     or (v_standard_result ->> 'joined')::boolean is not true
  then
    raise exception 'standard_room_create_result_invalid';
  end if;

  if exists (
    select 1
    from private.room_join_capabilities capability
    where capability.room_id = current_setting(
      'commandcanvas.test_standard_room_id'
    )::uuid
  ) then
    raise exception 'standard_room_received_legacy_join_capability';
  end if;

  if exists (
    select 1
    from public.room_members member
    where member.room_id = current_setting(
      'commandcanvas.test_standard_room_id'
    )::uuid
      and member.user_id = current_setting(
        'commandcanvas.test_participant_user_id'
      )::uuid
  ) then
    raise exception 'legacy_standard_join_persisted_membership';
  end if;

  if v_demo_create_result ->> 'roomId' <> current_setting(
       'commandcanvas.test_demo_room_id'
     )
     or v_demo_join_result ->> 'roomId' <> current_setting(
       'commandcanvas.test_demo_room_id'
     )
     or v_demo_join_result ->> 'role' <> 'participant'
     or (v_demo_join_result ->> 'joined')::boolean is not true
  then
    raise exception 'demo_room_legacy_path_regressed';
  end if;

  if not exists (
    select 1
    from private.room_join_capabilities capability
    where capability.room_id = current_setting(
      'commandcanvas.test_demo_room_id'
    )::uuid
  ) then
    raise exception 'demo_room_join_capability_missing';
  end if;

  raise notice 'legacy_room_demo_boundary_probes_passed';
end;
$$;

rollback;

\echo legacy_room_demo_boundary_probes_passed
