do $$
declare
  browser_role name;
  function_signature text;
begin
  if not exists (
    select 1 from pg_extension where extname = 'supabase_vault'
  ) then
    raise exception 'credential_vault_extension_missing';
  end if;

  if to_regclass('private.user_openai_credentials') is null then
    raise exception 'credential_mapping_table_missing';
  end if;

  if not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'user_openai_credentials'
      and relation.relrowsecurity
  ) then
    raise exception 'credential_mapping_rls_missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'user_openai_credentials'
      and column_name ~ '(api_key|secret|credential_value)'
      and column_name <> 'vault_secret_id'
  ) then
    raise exception 'raw_credential_column_present';
  end if;

  foreach browser_role in array array['anon'::name, 'authenticated'::name]
  loop
    if has_schema_privilege(browser_role, 'private', 'USAGE')
      or has_schema_privilege(browser_role, 'vault', 'USAGE')
      or has_table_privilege(
        browser_role,
        'private.user_openai_credentials',
        'SELECT,INSERT,UPDATE,DELETE'
      )
      or has_table_privilege(
        browser_role,
        'vault.decrypted_secrets',
        'SELECT'
      )
      or has_table_privilege(
        browser_role,
        'vault.secrets',
        'SELECT,INSERT,UPDATE,DELETE'
      )
    then
      raise exception 'browser_role_can_access_saved_credential:%', browser_role;
    end if;

    foreach function_signature in array array[
      'public.get_user_openai_credential_status(uuid)',
      'public.upsert_user_openai_credential(uuid,text,text)',
      'public.delete_user_openai_credential(uuid)',
      'public.resolve_user_openai_credential(uuid)',
      'private._get_user_openai_credential_status(uuid)',
      'private._upsert_user_openai_credential(uuid,text,text)',
      'private._delete_user_openai_credential(uuid)',
      'private._resolve_user_openai_credential(uuid)',
      'private._delete_user_openai_vault_secret()',
      'vault.create_secret(text,text,text,uuid)',
      'vault.update_secret(uuid,text,text,text,uuid)'
    ]
    loop
      if has_function_privilege(browser_role, function_signature, 'EXECUTE') then
        raise exception 'browser_role_can_execute_saved_credential_function:%:%',
          browser_role,
          function_signature;
      end if;
    end loop;
  end loop;

  if not has_function_privilege(
    'service_role',
    'public.get_user_openai_credential_status(uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.upsert_user_openai_credential(uuid,text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.delete_user_openai_credential(uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.resolve_user_openai_credential(uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role_credential_rpc_missing';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger
    join pg_class as relation on relation.oid = trigger.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'user_openai_credentials'
      and trigger.tgname = 'delete_user_openai_vault_secret'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
  ) then
    raise exception 'credential_vault_cleanup_trigger_missing';
  end if;
end;
$$;
