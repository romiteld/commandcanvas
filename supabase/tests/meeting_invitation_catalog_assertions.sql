\set ON_ERROR_STOP on

do $$
declare
  v_create_meeting oid := pg_catalog.to_regprocedure(
    'public.create_standard_meeting_with_host(uuid,text,text,uuid,text,text,text)'
  );
  v_create_invite oid := pg_catalog.to_regprocedure(
    'public.create_room_email_invitation(uuid,uuid,uuid,text,text,text,text,timestamptz,text)'
  );
  v_accept_invite oid := pg_catalog.to_regprocedure(
    'public.accept_room_email_invitation(uuid,text)'
  );
  v_function oid;
  v_table text;
begin
  foreach v_table in array array[
    'private.room_email_invitations',
    'private.room_invitation_issuance_admissions',
    'private.room_invitation_acceptance_attempts'
  ] loop
    if pg_catalog.to_regclass(v_table) is null then
      raise exception 'meeting_invitation_table_missing:%', v_table;
    end if;
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = pg_catalog.to_regclass(v_table)
        and relation.relrowsecurity
    ) then
      raise exception 'meeting_invitation_rls_missing:%', v_table;
    end if;
    if pg_catalog.has_table_privilege(
         'service_role', v_table,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
       or pg_catalog.has_table_privilege(
         'authenticated', v_table, 'SELECT,INSERT,UPDATE,DELETE'
       )
       or pg_catalog.has_table_privilege(
         'anon', v_table, 'SELECT,INSERT,UPDATE,DELETE'
       )
    then
      raise exception 'meeting_invitation_table_acl_invalid:%', v_table;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'private'
      and column_row.table_name = 'room_email_invitations'
      and column_row.column_name in ('email', 'invited_email', 'token', 'raw_token')
  ) then
    raise exception 'meeting_invitation_plaintext_secret_column_present';
  end if;

  foreach v_function in array array[
    v_create_meeting, v_create_invite, v_accept_invite
  ] loop
    if v_function is null then
      raise exception 'meeting_invitation_rpc_missing';
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc function_row
      where function_row.oid = v_function
        and function_row.prosecdef
        and function_row.provolatile = 'v'
        and exists (
          select 1
          from pg_catalog.unnest(function_row.proconfig) config(setting)
          where config.setting in ('search_path=', 'search_path=""')
        )
    )
       or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
    then
      raise exception 'meeting_invitation_rpc_security_invalid:%', v_function;
    end if;
  end loop;

  if pg_catalog.pg_get_functiondef(v_create_invite) !~ 'meeting_invite_global_rate_limit'
     or pg_catalog.pg_get_functiondef(v_create_invite) !~ 'meeting_invite_actor_rate_limit'
     or pg_catalog.pg_get_functiondef(v_create_invite) !~ 'meeting_invite_room_rate_limit'
     or pg_catalog.pg_get_functiondef(v_create_invite) !~ 'pg_advisory_xact_lock'
     or pg_catalog.pg_get_functiondef(v_accept_invite) !~ 'meeting_invite_accept_rate_limit'
     -- pg_get_functiondef normalizes SQL keyword casing on hosted Postgres.
     -- Match case-insensitively so this assertion tests the row lock rather
     -- than the pretty-printer's representation.
     or pg_catalog.pg_get_functiondef(v_accept_invite) !~* 'for update'
  then
    raise exception 'meeting_invitation_guard_branch_missing';
  end if;
end;
$$;

\echo meeting_invitation_catalog_assertions_passed
