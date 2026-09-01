begin;

create extension if not exists supabase_vault with schema vault;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.user_openai_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vault_secret_id uuid not null unique,
  key_fingerprint text not null
    check (key_fingerprint ~ '^sha256:[0-9a-f]{16}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.user_openai_credentials enable row level security;

revoke all on table private.user_openai_credentials
  from public, anon, authenticated;
revoke all on table vault.decrypted_secrets
  from public, anon, authenticated;
revoke all on table vault.secrets
  from public, anon, authenticated;

create or replace function private._get_user_openai_credential_status(
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select pg_catalog.jsonb_build_object(
        'configured', true,
        'key_fingerprint', credentials.key_fingerprint,
        'updated_at', credentials.updated_at
      )
      from private.user_openai_credentials as credentials
      where credentials.user_id = p_user_id
    ),
    pg_catalog.jsonb_build_object('configured', false)
  );
$$;

create or replace function private._upsert_user_openai_credential(
  p_user_id uuid,
  p_api_key text,
  p_key_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential_secret_id uuid;
begin
  if p_api_key is null
    or pg_catalog.char_length(p_api_key) < 20
    or pg_catalog.char_length(p_api_key) > 512
    or p_api_key !~ '^sk-[A-Za-z0-9_-]+$'
    or p_key_fingerprint is null
    or p_key_fingerprint !~ '^sha256:[0-9a-f]{16}$'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid credential input';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select credentials.vault_secret_id
  into credential_secret_id
  from private.user_openai_credentials as credentials
  where credentials.user_id = p_user_id
  for update;

  if credential_secret_id is null then
    credential_secret_id := vault.create_secret(
      p_api_key,
      'commandcanvas-openai-' || p_user_id::text,
      'CommandCanvas user-owned OpenAI API key'
    );
  else
    perform vault.update_secret(credential_secret_id, p_api_key);
  end if;

  insert into private.user_openai_credentials (
    user_id,
    vault_secret_id,
    key_fingerprint,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    credential_secret_id,
    p_key_fingerprint,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (user_id) do update
  set key_fingerprint = excluded.key_fingerprint,
      updated_at = excluded.updated_at;

  return private._get_user_openai_credential_status(p_user_id);
end;
$$;

create or replace function private._delete_user_openai_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets as secrets
  where secrets.id = old.vault_secret_id;

  return old;
end;
$$;

revoke all on function private._delete_user_openai_vault_secret()
  from public, anon, authenticated, service_role;

create trigger delete_user_openai_vault_secret
after delete on private.user_openai_credentials
for each row execute function private._delete_user_openai_vault_secret();

create or replace function private._delete_user_openai_credential(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  delete from private.user_openai_credentials as credentials
  where credentials.user_id = p_user_id;

  return pg_catalog.jsonb_build_object('configured', false);
end;
$$;

create or replace function private._resolve_user_openai_credential(
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secrets.decrypted_secret
  from private.user_openai_credentials as credentials
  join vault.decrypted_secrets as secrets
    on secrets.id = credentials.vault_secret_id
  where credentials.user_id = p_user_id;
$$;

revoke all on function private._get_user_openai_credential_status(uuid)
  from public, anon, authenticated;
revoke all on function private._upsert_user_openai_credential(uuid, text, text)
  from public, anon, authenticated;
revoke all on function private._delete_user_openai_credential(uuid)
  from public, anon, authenticated;
revoke all on function private._resolve_user_openai_credential(uuid)
  from public, anon, authenticated;

grant execute on function private._get_user_openai_credential_status(uuid)
  to service_role;
grant execute on function private._upsert_user_openai_credential(uuid, text, text)
  to service_role;
grant execute on function private._delete_user_openai_credential(uuid)
  to service_role;
grant execute on function private._resolve_user_openai_credential(uuid)
  to service_role;

create or replace function public.get_user_openai_credential_status(
  p_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private._get_user_openai_credential_status(p_user_id);
$$;

create or replace function public.upsert_user_openai_credential(
  p_user_id uuid,
  p_api_key text,
  p_key_fingerprint text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private._upsert_user_openai_credential(
    p_user_id,
    p_api_key,
    p_key_fingerprint
  );
$$;

create or replace function public.delete_user_openai_credential(
  p_user_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private._delete_user_openai_credential(p_user_id);
$$;

create or replace function public.resolve_user_openai_credential(
  p_user_id uuid
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private._resolve_user_openai_credential(p_user_id);
$$;

revoke all on function public.get_user_openai_credential_status(uuid)
  from public, anon, authenticated;
revoke all on function public.upsert_user_openai_credential(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.delete_user_openai_credential(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_user_openai_credential(uuid)
  from public, anon, authenticated;

grant execute on function public.get_user_openai_credential_status(uuid)
  to service_role;
grant execute on function public.upsert_user_openai_credential(uuid, text, text)
  to service_role;
grant execute on function public.delete_user_openai_credential(uuid)
  to service_role;
grant execute on function public.resolve_user_openai_credential(uuid)
  to service_role;

commit;
