\set ON_ERROR_STOP on

-- Run after all migrations with a privileged connection. Relay token minting
-- must stay behind one durable, service-only admission decision.
do $$
declare
  v_admit_oid oid := pg_catalog.to_regprocedure(
    'public.admit_private_hand_relay_session(uuid,uuid)'
  );
  v_guard_oid oid := pg_catalog.to_regprocedure(
    'private.admit_private_hand_relay_session_without_expiry_guard(uuid,uuid)'
  );
begin
  if pg_catalog.to_regclass(
       'private.hand_relay_session_admissions'
     ) is null
  then
    raise exception 'hand_relay_admission_table_missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'hand_relay_session_admissions'
      and relation.relrowsecurity
  ) then
    raise exception 'hand_relay_admission_rls_missing';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'private.hand_relay_session_admissions',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'private.hand_relay_session_admissions',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'private.hand_relay_session_admissions',
       'SELECT,INSERT,UPDATE,DELETE'
     )
  then
    raise exception 'hand_relay_admission_table_acl_invalid';
  end if;

  if v_admit_oid is null then
    raise exception 'hand_relay_admission_rpc_missing';
  end if;

  if v_guard_oid is null then
    raise exception 'hand_relay_admission_private_guard_missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_admit_oid
      and function_row.prosecdef
      and function_row.provolatile = 'v'
      and exists (
        select 1
        from pg_catalog.unnest(function_row.proconfig) as config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
  )
     or pg_catalog.has_function_privilege('anon', v_admit_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated', v_admit_oid, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_admit_oid, 'EXECUTE'
     )
  then
    raise exception 'hand_relay_admission_rpc_security_invalid';
  end if;

  if pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'private\.assert_room_active\(p_room_id\)'
     or pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'private\.admit_private_hand_relay_session_without_expiry_guard'
  then
    raise exception 'hand_relay_admission_public_wrapper_invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_guard_oid
      and function_row.prosecdef
      and function_row.provolatile = 'v'
      and exists (
        select 1
        from pg_catalog.unnest(function_row.proconfig) as config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
  )
     or pg_catalog.has_function_privilege('public', v_guard_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_guard_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated', v_guard_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('service_role', v_guard_oid, 'EXECUTE')
  then
    raise exception 'hand_relay_admission_private_guard_security_invalid';
  end if;

  if pg_catalog.pg_get_functiondef(v_guard_oid)
       !~ 'pg_advisory_xact_lock'
     or pg_catalog.pg_get_functiondef(v_guard_oid)
       !~ 'hand_relay_global_burst_rate_limit'
     or pg_catalog.pg_get_functiondef(v_guard_oid)
       !~ 'hand_relay_global_daily_rate_limit'
     or pg_catalog.pg_get_functiondef(v_guard_oid)
       !~ 'hand_relay_actor_rate_limit'
     or pg_catalog.pg_get_functiondef(v_guard_oid)
       !~ 'hand_relay_room_rate_limit'
     or pg_catalog.pg_get_functiondef(v_guard_oid)
       !~ 'hand_relay_member_required'
  then
    raise exception 'hand_relay_admission_guard_branch_missing';
  end if;
end;
$$;

\echo hand_relay_admission_catalog_assertions_passed
