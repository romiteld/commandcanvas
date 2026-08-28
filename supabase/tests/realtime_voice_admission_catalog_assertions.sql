\set ON_ERROR_STOP on

-- Run after all migrations with a privileged connection. The Realtime voice
-- admission ledger is service-only and every paid-call limit is durable across
-- Vercel instances.

do $$
declare
  v_admit_oid oid := pg_catalog.to_regprocedure(
    'public.admit_realtime_voice_session(uuid,uuid)'
  );
begin
  if pg_catalog.to_regclass('private.realtime_voice_admissions') is null then
    raise exception 'realtime_voice_admission_table_missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'realtime_voice_admissions'
      and relation.relrowsecurity
  ) then
    raise exception 'realtime_voice_admission_rls_missing';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'private.realtime_voice_admissions',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'private.realtime_voice_admissions',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'private.realtime_voice_admissions',
       'SELECT,INSERT,UPDATE,DELETE'
     )
  then
    raise exception 'realtime_voice_admission_table_acl_invalid';
  end if;

  if v_admit_oid is null then
    raise exception 'realtime_voice_admission_rpc_missing';
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
       'authenticated',
       v_admit_oid,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       v_admit_oid,
       'EXECUTE'
     )
  then
    raise exception 'realtime_voice_admission_rpc_security_invalid';
  end if;

  if pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'pg_advisory_xact_lock'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'voice_actor_rate_limit'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'voice_actor_daily_limit'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'voice_room_daily_limit'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'voice_global_daily_limit'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'auth.users'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'is_anonymous'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'email_confirmed_at'
     or pg_catalog.pg_get_functiondef(v_admit_oid) !~ 'realtime_voice_permanent_member_required'
     or pg_catalog.pg_get_functiondef(v_admit_oid) ~ 'voice_demo_room_required'
  then
    raise exception 'realtime_voice_admission_guard_branch_missing';
  end if;
end;
$$;

\echo realtime_voice_admission_catalog_assertions_passed
