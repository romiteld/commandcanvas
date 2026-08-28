\set ON_ERROR_STOP on

-- Run after 20260827222710_add_spatial_grouping_and_redo.sql with a
-- privileged connection. These assertions inspect the deployed catalog;
-- migration history alone is not proof of the contract.

do $$
declare
  v_core_oid oid;
  v_parent_graph_oid oid;
  v_core_definition text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'canvas_objects'
      and column_name = 'rotation'
      and data_type = 'double precision'
      and is_nullable = 'NO'
      and column_default = '0'::text
  ) then
    raise exception 'spatial_catalog_rotation_column_invalid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'canvas_objects'
      and column_name = 'parent_id'
      and data_type = 'text'
      and is_nullable = 'YES'
  ) then
    raise exception 'spatial_catalog_parent_id_column_invalid';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.canvas_objects'::regclass
      and constraint_row.conname = 'canvas_objects_object_type_check'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and pg_get_constraintdef(constraint_row.oid) like '%frame%'
  ) then
    raise exception 'spatial_catalog_frame_type_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.canvas_objects'::regclass
      and constraint_row.conname = 'canvas_objects_parent_same_room_fk'
      and constraint_row.contype = 'f'
      and constraint_row.condeferrable
      and constraint_row.condeferred
      and constraint_row.convalidated
  ) then
    raise exception 'spatial_catalog_parent_same_room_fk_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.canvas_objects'::regclass
      and constraint_row.conname = 'canvas_objects_parent_not_self'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  ) then
    raise exception 'spatial_catalog_parent_self_guard_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.canvas_objects'::regclass
      and constraint_row.conname = 'canvas_objects_rotation_range'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and pg_get_constraintdef(constraint_row.oid) like '%-180%'
      and pg_get_constraintdef(constraint_row.oid) like '%180%'
  ) then
    raise exception 'spatial_catalog_rotation_range_invalid';
  end if;

  v_parent_graph_oid := to_regprocedure(
    'private.validate_canvas_parent_graph(uuid)'
  );

  if v_parent_graph_oid is null then
    raise exception 'spatial_catalog_parent_graph_validator_missing';
  end if;

  if has_function_privilege('authenticated', v_parent_graph_oid, 'EXECUTE')
     or has_function_privilege('anon', v_parent_graph_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_parent_graph_oid, 'EXECUTE')
  then
    raise exception 'spatial_catalog_parent_graph_execute_present';
  end if;

  v_core_oid := to_regprocedure(
    'private.commit_canvas_mutation_core(uuid,uuid,text,text,text,jsonb,jsonb,boolean,uuid,uuid)'
  );

  if v_core_oid is null then
    raise exception 'spatial_catalog_mutation_core_missing';
  end if;

  select pg_get_functiondef(v_core_oid)
  into v_core_definition;

  if v_core_definition not like '%' || quote_literal('rotation') || '%'
     or v_core_definition not like '%' || quote_literal('parentId') || '%'
     or v_core_definition not like '%' || quote_literal('redo') || '%'
  then
    raise exception 'spatial_catalog_mutation_core_contract_missing';
  end if;

  if has_function_privilege('authenticated', v_core_oid, 'EXECUTE')
     or has_function_privilege('anon', v_core_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_core_oid, 'EXECUTE')
  then
    raise exception 'spatial_catalog_private_core_execute_present';
  end if;

  raise notice 'spatial_history_catalog_assertions_passed';
end;
$$;
