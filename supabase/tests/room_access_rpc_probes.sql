\set ON_ERROR_STOP on

-- Required inputs are three existing Supabase Auth user UUIDs:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -v participant_user_id='<uuid>' \
--   -v outsider_user_id='<uuid>' \
--   -f supabase/tests/room_access_rpc_probes.sql
--
-- Run with a privileged connection. Calls execute after SET ROLE service_role
-- so the RPC ACL is exercised. All fixtures are rolled back.

begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as invalid_room_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as invalid_room_slug,
  replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '') as join_token,
  replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '') as wrong_join_token
\gset cc_

select
  set_config('commandcanvas.test_room_id', :'cc_room_id', true),
  set_config(
    'commandcanvas.test_invalid_room_id',
    :'cc_invalid_room_id',
    true
  ),
  set_config('commandcanvas.test_room_slug', :'cc_room_slug', true),
  set_config(
    'commandcanvas.test_invalid_room_slug',
    :'cc_invalid_room_slug',
    true
  ),
  set_config('commandcanvas.test_join_token', :'cc_join_token', true),
  set_config(
    'commandcanvas.test_wrong_join_token',
    :'cc_wrong_join_token',
    true
  ),
  set_config('commandcanvas.test_host_user_id', :'host_user_id', true),
  set_config(
    'commandcanvas.test_participant_user_id',
    :'participant_user_id',
    true
  ),
  set_config(
    'commandcanvas.test_outsider_user_id',
    :'outsider_user_id',
    true
  );

do $$
declare
  v_create_oid oid := to_regprocedure(
    'public.create_room_with_host(uuid,text,text,text,uuid,text,text,text)'
  );
  v_join_oid oid := to_regprocedure(
    'public.join_room_as_participant(uuid,uuid,text,text,text,text)'
  );
begin
  if to_regclass('private.room_join_capabilities') is null then
    raise exception 'room_access_private_capability_table_missing';
  end if;

  if not (
    select relation.relrowsecurity
    from pg_class relation
    where relation.oid = 'private.room_join_capabilities'::regclass
  ) then
    raise exception 'room_access_private_capability_rls_missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rooms'
      and column_name in (
        'join_token',
        'join_token_hash',
        'join_capability',
        'join_capability_hash'
      )
  ) then
    raise exception 'room_access_capability_leaked_into_room_row';
  end if;

  if v_create_oid is null then
    raise exception 'room_access_create_rpc_missing';
  end if;

  if v_join_oid is null then
    raise exception 'room_access_join_rpc_missing';
  end if;

  if (
    select count(*)
    from pg_proc function_row
    where function_row.oid in (v_create_oid, v_join_oid)
      and function_row.prosecdef
      and exists (
        select 1
        from unnest(function_row.proconfig) as config(setting)
        where config.setting like 'search_path=%'
      )
  ) <> 2 then
    raise exception 'room_access_rpc_security_configuration_invalid';
  end if;

  if has_function_privilege('anon', v_create_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_create_oid, 'EXECUTE')
     or has_function_privilege('anon', v_join_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_join_oid, 'EXECUTE')
  then
    raise exception 'room_access_rpc_browser_execute_present';
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
    where function_row.oid in (v_create_oid, v_join_oid)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'room_access_rpc_public_execute_present';
  end if;

  if not has_function_privilege('service_role', v_create_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_join_oid, 'EXECUTE')
  then
    raise exception 'room_access_rpc_service_execute_missing';
  end if;

  if has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_table_privilege(
       'anon',
       'private.room_join_capabilities',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'private.room_join_capabilities',
       'SELECT'
     )
  then
    raise exception 'room_access_private_capability_browser_access_present';
  end if;

  if not exists (
    select 1
    from pg_index index_row
    where index_row.indrelid = 'public.outbound_shares'::regclass
      and index_row.indisvalid
      and index_row.indisready
      and (
        select array_agg(attribute.attname order by key_position.ordinality)
        from unnest(index_row.indkey::smallint[])
          with ordinality as key_position(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key_position.attnum
        where key_position.ordinality <= 3
      ) = array['room_id', 'packet_id', 'send_request_id']::name[]
  ) then
    raise exception 'room_access_outbound_composite_fk_covering_index_missing';
  end if;
end;
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.create_room_with_host(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_slug => current_setting('commandcanvas.test_room_slug'),
      p_name => 'Browser call must fail',
      p_mode => 'demo',
      p_host_user_id => current_setting(
        'commandcanvas.test_host_user_id'
      )::uuid,
      p_display_name => 'Browser host',
      p_color => '#2563EB',
      p_join_token => current_setting('commandcanvas.test_join_token')
    );
    raise exception 'room_access_authenticated_create_succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;

select public.create_room_with_host(
  p_room_id => :'cc_room_id'::uuid,
  p_slug => :'cc_room_slug',
  p_name => 'CommandCanvas room access probe',
  p_mode => 'demo',
  p_host_user_id => :'host_user_id'::uuid,
  p_display_name => 'Probe Host',
  p_color => '#2563EB',
  p_join_token => :'cc_join_token'
) as create_result
\gset cc_

reset role;

select set_config(
  'commandcanvas.test_create_result',
  :'cc_create_result',
  true
);

do $$
declare
  v_result jsonb := current_setting('commandcanvas.test_create_result')::jsonb;
  v_room_json jsonb;
begin
  if v_result ->> 'roomId' <> current_setting('commandcanvas.test_room_id')
     or v_result ->> 'role' <> 'host'
     or (v_result ->> 'joined')::boolean is not true
  then
    raise exception 'room_access_create_result_invalid';
  end if;

  if v_result ?| array[
       'joinToken',
       'join_token',
       'joinTokenHash',
       'join_token_hash'
     ]
     or v_result::text like '%' || current_setting(
       'commandcanvas.test_join_token'
     ) || '%'
  then
    raise exception 'room_access_create_result_leaked_capability';
  end if;

  select to_jsonb(room_row)
  into v_room_json
  from public.rooms room_row
  where room_row.id = current_setting('commandcanvas.test_room_id')::uuid;

  if v_room_json ?| array[
       'joinToken',
       'join_token',
       'joinTokenHash',
       'join_token_hash'
     ]
     or v_room_json::text like '%' || current_setting(
       'commandcanvas.test_join_token'
     ) || '%'
  then
    raise exception 'room_access_room_row_leaked_capability';
  end if;

  if (
       select count(*)
       from public.room_members
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
         and user_id = current_setting(
           'commandcanvas.test_host_user_id'
         )::uuid
         and role = 'host'
         and display_name = 'Probe Host'
         and color = '#2563EB'
     ) <> 1
  then
    raise exception 'room_access_create_host_membership_missing';
  end if;

  if (
       select octet_length(capability.join_token_sha256)
       from private.room_join_capabilities capability
       where capability.room_id = current_setting(
         'commandcanvas.test_room_id'
       )::uuid
     ) <> 32
     or (
       select capability.join_token_sha256
       from private.room_join_capabilities capability
       where capability.room_id = current_setting(
         'commandcanvas.test_room_id'
       )::uuid
     ) <> sha256(
       convert_to(current_setting('commandcanvas.test_join_token'), 'UTF8')
     )
  then
    raise exception 'room_access_capability_hash_not_exact_sha256';
  end if;
end;
$$;

set local role service_role;

do $$
begin
  begin
    perform public.create_room_with_host(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_slug => current_setting('commandcanvas.test_invalid_room_slug'),
      p_name => 'Duplicate identifier probe',
      p_mode => 'demo',
      p_host_user_id => current_setting(
        'commandcanvas.test_host_user_id'
      )::uuid,
      p_display_name => 'Probe Host',
      p_color => '#2563EB',
      p_join_token => current_setting('commandcanvas.test_join_token')
    );
    raise exception 'room_access_duplicate_room_id_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_id_already_exists' then
        raise;
      end if;
  end;

  begin
    perform public.create_room_with_host(
      p_room_id => current_setting(
        'commandcanvas.test_invalid_room_id'
      )::uuid,
      p_slug => current_setting('commandcanvas.test_room_slug'),
      p_name => 'Duplicate slug probe',
      p_mode => 'demo',
      p_host_user_id => current_setting(
        'commandcanvas.test_host_user_id'
      )::uuid,
      p_display_name => 'Probe Host',
      p_color => '#2563EB',
      p_join_token => current_setting('commandcanvas.test_join_token')
    );
    raise exception 'room_access_duplicate_room_slug_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_slug_already_exists' then
        raise;
      end if;
  end;

  begin
    perform public.join_room_as_participant(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_user_id => current_setting('commandcanvas.test_outsider_user_id')::uuid,
      p_display_name => 'Outsider',
      p_color => '#16A34A',
      p_join_token => current_setting(
        'commandcanvas.test_wrong_join_token'
      ),
      p_requested_role => 'participant'
    );
    raise exception 'room_access_token_mismatch_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_join_token_mismatch' then
        raise;
      end if;
  end;

  begin
    perform public.join_room_as_participant(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_user_id => current_setting('commandcanvas.test_outsider_user_id')::uuid,
      p_display_name => 'Escalation attempt',
      p_color => '#16A34A',
      p_join_token => current_setting('commandcanvas.test_join_token'),
      p_requested_role => 'host'
    );
    raise exception 'room_access_host_role_escalation_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_join_role_escalation_forbidden' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.room_members
    where room_id = current_setting('commandcanvas.test_room_id')::uuid
      and user_id = current_setting('commandcanvas.test_outsider_user_id')::uuid
  ) then
    raise exception 'room_access_rejected_join_wrote_membership';
  end if;
end;
$$;

select public.join_room_as_participant(
  p_room_id => :'cc_room_id'::uuid,
  p_user_id => :'participant_user_id'::uuid,
  p_display_name => 'Probe Participant',
  p_color => '#F97316',
  p_join_token => :'cc_join_token',
  p_requested_role => 'participant'
) as first_join_result
\gset cc_

select public.join_room_as_participant(
  p_room_id => :'cc_room_id'::uuid,
  p_user_id => :'participant_user_id'::uuid,
  p_display_name => 'Probe Participant',
  p_color => '#F97316',
  p_join_token => :'cc_join_token',
  p_requested_role => 'participant'
) as repeat_join_result
\gset cc_

reset role;

select
  set_config(
    'commandcanvas.test_first_join_result',
    :'cc_first_join_result',
    true
  ),
  set_config(
    'commandcanvas.test_repeat_join_result',
    :'cc_repeat_join_result',
    true
  );

do $$
declare
  v_first jsonb := current_setting(
    'commandcanvas.test_first_join_result'
  )::jsonb;
  v_repeat jsonb := current_setting(
    'commandcanvas.test_repeat_join_result'
  )::jsonb;
begin
  if v_first ->> 'role' <> 'participant'
     or (v_first ->> 'joined')::boolean is not true
     or v_repeat ->> 'role' <> 'participant'
     or (v_repeat ->> 'joined')::boolean is not false
  then
    raise exception 'room_access_idempotent_join_result_invalid';
  end if;

  if v_first ?| array['joinToken', 'joinTokenHash']
     or v_repeat ?| array['joinToken', 'joinTokenHash']
     or v_first::text like '%' || current_setting(
       'commandcanvas.test_join_token'
     ) || '%'
     or v_repeat::text like '%' || current_setting(
       'commandcanvas.test_join_token'
     ) || '%'
  then
    raise exception 'room_access_join_result_leaked_capability';
  end if;

  if (
    select count(*)
    from public.room_members
    where room_id = current_setting('commandcanvas.test_room_id')::uuid
      and user_id = current_setting(
        'commandcanvas.test_participant_user_id'
      )::uuid
      and role = 'participant'
      and display_name = 'Probe Participant'
      and color = '#F97316'
  ) <> 1 then
    raise exception 'room_access_idempotent_join_membership_invalid';
  end if;
end;
$$;

set local role service_role;

do $$
begin
  begin
    perform public.create_room_with_host(
      p_room_id => current_setting(
        'commandcanvas.test_invalid_room_id'
      )::uuid,
      p_slug => current_setting('commandcanvas.test_invalid_room_slug'),
      p_name => 'Invalid host profile probe',
      p_mode => 'demo',
      p_host_user_id => current_setting(
        'commandcanvas.test_outsider_user_id'
      )::uuid,
      p_display_name => '   ',
      p_color => '#16A34A',
      p_join_token => current_setting('commandcanvas.test_join_token')
    );
    raise exception 'room_access_blank_display_name_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_invalid_display_name' then
        raise;
      end if;
  end;

  begin
    perform public.join_room_as_participant(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_user_id => current_setting('commandcanvas.test_outsider_user_id')::uuid,
      p_display_name => 'Invalid color probe',
      p_color => 'orange',
      p_join_token => current_setting('commandcanvas.test_join_token'),
      p_requested_role => 'participant'
    );
    raise exception 'room_access_invalid_color_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'room_invalid_color' then
        raise;
      end if;
  end;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.rooms
    where id = current_setting('commandcanvas.test_invalid_room_id')::uuid
  ) then
    raise exception 'room_access_invalid_create_wrote_partial_room';
  end if;
end;
$$;

rollback;

\echo room_access_rpc_probes_passed
