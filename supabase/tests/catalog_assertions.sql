\set ON_ERROR_STOP on

-- Run after the initial migration with a privileged connection. These checks
-- inspect the deployed catalog; a migration-history row alone is not proof.

do $$
declare
  v_missing_tables text[];
  v_function_oid oid;
  v_packet_signature text;
  v_rls_count integer;
  v_policy_count integer;
begin
  select array_agg(required.name order by required.name)
  into v_missing_tables
  from (
    values
      ('rooms'),
      ('room_members'),
      ('canvas_objects'),
      ('receipts'),
      ('meeting_packets'),
      ('packet_send_requests'),
      ('outbound_shares')
  ) as required(name)
  where to_regclass('public.' || required.name) is null;

  if v_missing_tables is not null then
    raise exception 'catalog_missing_tables:%', v_missing_tables;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'canvas_objects'
      and column_name in ('group_id', 'frame_id')
  ) then
    raise exception 'catalog_cut_canvas_column_present';
  end if;

  if exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.canvas_objects'::regclass
      and pg_get_constraintdef(constraint_row.oid) like '%meeting_packet_card%'
  ) then
    raise exception 'catalog_cut_object_type_present';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'canvas_objects'
      and column_name = 'id'
      and data_type = 'text'
  ) then
    raise exception 'catalog_canvas_object_id_not_text';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meeting_packets'
      and column_name = 'id'
      and data_type = 'text'
  ) then
    raise exception 'catalog_meeting_packet_id_not_text';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'receipts'
      and column_name = 'affected_object_ids'
      and udt_name = '_text'
  ) then
    raise exception 'catalog_receipt_object_ids_not_text_array';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'receipts'
      and column_name = 'source'
      and data_type = 'text'
      and is_nullable = 'NO'
  ) then
    raise exception 'catalog_receipt_source_not_durable';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.receipts'::regclass
      and constraint_row.conname = 'receipts_actor_source_consistent'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  ) then
    raise exception 'catalog_receipt_actor_source_constraint_missing';
  end if;

  select count(*)
  into v_rls_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (
      'rooms',
      'room_members',
      'canvas_objects',
      'receipts',
      'meeting_packets',
      'packet_send_requests',
      'outbound_shares'
    )
    and relation.relrowsecurity;

  if v_rls_count <> 7 then
    raise exception 'catalog_rls_missing:expected=7 actual=%', v_rls_count;
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'rooms',
        'room_members',
        'canvas_objects',
        'receipts',
        'meeting_packets',
        'packet_send_requests',
        'outbound_shares'
      )
      and grant_row.grantee in ('anon', 'authenticated')
      and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then
    raise exception 'catalog_browser_stable_write_grant_present';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'rooms',
        'room_members',
        'canvas_objects',
        'receipts',
        'meeting_packets',
        'packet_send_requests',
        'outbound_shares'
      )
      and grant_row.grantee = 'anon'
  ) then
    raise exception 'catalog_anon_table_grant_present';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'meeting_packets',
        'packet_send_requests',
        'outbound_shares'
      )
      and grant_row.grantee = 'service_role'
      and grant_row.privilege_type in (
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      )
  ) then
    raise exception 'catalog_packet_service_direct_mutation_grant_present';
  end if;

  if (
    select count(*)
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'meeting_packets',
        'packet_send_requests',
        'outbound_shares'
      )
      and grant_row.grantee = 'service_role'
      and grant_row.privilege_type = 'SELECT'
  ) <> 3 then
    raise exception 'catalog_packet_service_read_grant_missing';
  end if;

  select count(*)
  into v_policy_count
  from pg_policies policy_row
  where (policy_row.schemaname, policy_row.tablename, policy_row.policyname) in (
    ('public', 'room_members', 'room_members_select_self'),
    ('public', 'rooms', 'rooms_select_member'),
    ('public', 'canvas_objects', 'canvas_objects_select_member'),
    ('public', 'receipts', 'receipts_select_member'),
    ('public', 'meeting_packets', 'meeting_packets_select_host'),
    ('public', 'packet_send_requests', 'packet_send_requests_select_host'),
    ('public', 'outbound_shares', 'outbound_shares_select_host'),
    ('realtime', 'messages', 'commandcanvas_room_realtime_read'),
    ('realtime', 'messages', 'commandcanvas_room_realtime_write')
  );

  if v_policy_count <> 9 then
    raise exception 'catalog_policy_missing:expected=9 actual=%', v_policy_count;
  end if;

  v_function_oid := to_regprocedure(
    'public.commit_canvas_mutation(uuid,uuid,text,text,text,text,jsonb,jsonb,boolean,uuid,uuid)'
  );

  if v_function_oid is null then
    raise exception 'catalog_mutation_rpc_missing';
  end if;

  if to_regprocedure(
       'public.commit_canvas_mutation(uuid,uuid,text,text,text,jsonb,jsonb,boolean,uuid,uuid)'
     ) is not null
  then
    raise exception 'catalog_legacy_mutation_rpc_still_present';
  end if;

  if not exists (
    select 1
    from pg_proc function_row
    where function_row.oid = v_function_oid
      and function_row.prosecdef
      and exists (
        select 1
        from unnest(function_row.proconfig) as config(setting)
        where config.setting like 'search_path=%'
      )
  ) then
    raise exception 'catalog_mutation_rpc_security_configuration_invalid';
  end if;

  if has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     )
     or has_function_privilege('anon', v_function_oid, 'EXECUTE')
  then
    raise exception 'catalog_mutation_rpc_browser_execute_present';
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
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'catalog_mutation_rpc_public_execute_present';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception 'catalog_mutation_rpc_service_execute_missing';
  end if;

  foreach v_packet_signature in array array[
    'public.prepare_meeting_packet_draft(uuid,uuid,text,text,text,text[])',
    'public.update_meeting_packet_draft(uuid,text,uuid,text,jsonb)',
    'public.approve_meeting_packet(uuid,text,uuid)',
    'public.stage_meeting_packet_send(uuid,text,uuid,text,uuid)',
    'public.cancel_meeting_packet_send(uuid,uuid,uuid)',
    'public.authorize_meeting_packet_send(uuid,uuid,uuid,text,uuid)',
    'public.complete_meeting_packet_send(uuid,uuid,uuid,text,text,text)'
  ]
  loop
    v_function_oid := to_regprocedure(v_packet_signature);
    if v_function_oid is null
       or not has_function_privilege(
         'service_role',
         v_function_oid,
         'EXECUTE'
       )
    then
      raise exception 'catalog_packet_rpc_service_execute_missing:%',
        v_packet_signature;
    end if;

    if has_function_privilege('anon', v_function_oid, 'EXECUTE')
       or has_function_privilege(
         'authenticated',
         v_function_oid,
         'EXECUTE'
       )
       or exists (
         select 1
         from pg_proc function_row,
              lateral aclexplode(
                coalesce(
                  function_row.proacl,
                  acldefault('f', function_row.proowner)
                )
              ) acl
         where function_row.oid = v_function_oid
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       )
    then
      raise exception 'catalog_packet_rpc_browser_execute_present:%',
        v_packet_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.receipts'::regclass
      and trigger_row.tgname = 'receipts_are_immutable'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'catalog_receipt_immutability_trigger_missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.receipts'::regclass
      and trigger_row.tgname = 'receipts_broadcast_after_insert'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'catalog_receipt_broadcast_trigger_missing';
  end if;

  raise notice 'catalog_assertions_passed';
end;
$$;
