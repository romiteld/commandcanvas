\set ON_ERROR_STOP on

-- Run after all migrations with a privileged connection. This verifies the
-- deployed contract rather than trusting migration history.

do $$
declare
  v_admit_oid oid := pg_catalog.to_regprocedure(
    'public.admit_sketch_transform(uuid,uuid,text,bigint,text,text,text,text,uuid,text)'
  );
  v_complete_oid oid := pg_catalog.to_regprocedure(
    'public.complete_sketch_transform(text,uuid,text,text,jsonb)'
  );
  v_release_oid oid := pg_catalog.to_regprocedure(
    'public.release_sketch_transform(text,uuid,text)'
  );
  v_demo_limit_oid oid := pg_catalog.to_regprocedure(
    'private.enforce_demo_vision_limits()'
  );
  v_function_oid oid;
begin
  if pg_catalog.to_regprocedure(
       'public.admit_sketch_transform(uuid,uuid,text,bigint,text,text,text,text,uuid)'
     ) is not null
  then
    raise exception 'vision_admission_legacy_rpc_still_present';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid =
          'private.sketch_transform_admissions'::pg_catalog.regclass
      and attribute.attname = 'normalized_narration_sha256'
      and not attribute.attisdropped
      and attribute.atttypid = 'pg_catalog.text'::pg_catalog.regtype
  )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'private.sketch_transform_admissions'::pg_catalog.regclass
         and constraint_row.conname =
             'sketch_transform_admission_narration_hash'
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
     )
  then
    raise exception 'vision_admission_narration_contract_missing';
  end if;

  if pg_catalog.to_regclass('private.sketch_transform_admissions') is null
     or pg_catalog.to_regclass('private.sketch_transform_attempts') is null
     or pg_catalog.to_regclass('private.demo_vision_usage') is null
  then
    raise exception 'vision_admission_private_tables_missing';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in (
        'sketch_transform_admissions',
        'sketch_transform_attempts',
        'demo_vision_usage'
      )
      and relation.relrowsecurity
  ) <> 3 then
    raise exception 'vision_admission_private_table_rls_missing';
  end if;

  if pg_catalog.has_table_privilege(
       'service_role',
       'private.sketch_transform_admissions',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'private.sketch_transform_attempts',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'service_role',
       'private.demo_vision_usage',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'private.sketch_transform_admissions',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'private.sketch_transform_admissions',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'anon',
       'private.demo_vision_usage',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or pg_catalog.has_table_privilege(
       'authenticated',
       'private.demo_vision_usage',
       'SELECT,INSERT,UPDATE,DELETE'
     )
  then
    raise exception 'vision_admission_direct_table_privilege_present';
  end if;

  if v_admit_oid is null
     or v_complete_oid is null
     or v_release_oid is null
     or v_demo_limit_oid is null
  then
    raise exception 'vision_admission_rpc_missing';
  end if;

  foreach v_function_oid in array array[
    v_admit_oid,
    v_complete_oid,
    v_release_oid
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_proc function_row
      where function_row.oid = v_function_oid
        and function_row.prosecdef
        and function_row.provolatile = 'v'
        and exists (
          select 1
          from pg_catalog.unnest(function_row.proconfig) as config(setting)
          where config.setting in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'vision_admission_rpc_security_invalid:%', v_function_oid;
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
      raise exception 'vision_admission_rpc_acl_invalid:%', v_function_oid;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc function_row,
           lateral pg_catalog.aclexplode(
             coalesce(
               function_row.proacl,
               pg_catalog.acldefault('f', function_row.proowner)
             )
           ) acl
      where function_row.oid = v_function_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'vision_admission_rpc_public_execute_present:%',
        v_function_oid;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_demo_limit_oid
      and function_row.prosecdef
      and function_row.provolatile = 'v'
      and exists (
        select 1
        from pg_catalog.unnest(function_row.proconfig) as config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
  )
     or pg_catalog.has_function_privilege(
       'service_role',
       v_demo_limit_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       v_demo_limit_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_demo_limit_oid, 'EXECUTE')
  then
    raise exception 'demo_vision_limit_trigger_function_security_invalid';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
          'private.sketch_transform_attempts'::pg_catalog.regclass
      and trigger_row.tgname = 'enforce_demo_vision_limits_before_attempt'
      and not trigger_row.tgisinternal
      and trigger_row.tgfoid = v_demo_limit_oid
  ) then
    raise exception 'demo_vision_limit_trigger_missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'private.demo_vision_usage'::pg_catalog.regclass
      and constraint_row.contype = 'f'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
          ~* 'REFERENCES public\.rooms'
  ) then
    raise exception 'demo_vision_usage_room_cascade_present';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
          'private.sketch_transform_admissions'::pg_catalog.regclass
      and constraint_row.conname = 'sketch_transform_admission_key_exact'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  ) then
    raise exception 'vision_admission_key_constraint_missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'private'
      and index_row.indexname = 'sketch_transform_attempts_actor_window_idx'
  )
     or not exists (
       select 1
       from pg_catalog.pg_indexes index_row
       where index_row.schemaname = 'private'
         and index_row.indexname = 'sketch_transform_attempts_room_time_idx'
     )
     or not exists (
       select 1
       from pg_catalog.pg_indexes index_row
       where index_row.schemaname = 'private'
         and index_row.indexname = 'demo_vision_usage_actor_day_idx'
     )
     or not exists (
       select 1
       from pg_catalog.pg_indexes index_row
       where index_row.schemaname = 'private'
         and index_row.indexname = 'demo_vision_usage_global_day_idx'
     )
  then
    raise exception 'vision_admission_limit_index_missing';
  end if;

  if pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'pg_advisory_xact_lock'
     or pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'lease_expires_at'
     or pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'transform_rate_limited'
     or pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'room_transform_busy'
     or pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'demo_transform_limit'
     or pg_catalog.pg_get_functiondef(v_admit_oid)
       !~ 'daily_transform_limit'
  then
    raise exception 'vision_admission_guard_branch_missing';
  end if;
end;
$$;

\echo vision_admission_catalog_assertions_passed
