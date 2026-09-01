begin;

create temporary table commandcanvas_credential_probe_user on commit drop as
select users.id
from auth.users as users
where users.is_anonymous is not true
  and users.email_confirmed_at is not null
  and not exists (
    select 1
    from private.user_openai_credentials as credentials
    where credentials.user_id = users.id
  )
order by users.created_at
limit 1;

do $$
begin
  if not exists (select 1 from commandcanvas_credential_probe_user) then
    raise exception 'credential_probe_user_unavailable';
  end if;
end;
$$;

grant select on commandcanvas_credential_probe_user to service_role;

set local role service_role;

do $$
declare
  probe_user_id uuid;
  probe_status jsonb;
  probe_key constant text :=
    'sk-commandcanvas-vault-probe-key-12345678901234567890';
begin
  select id into strict probe_user_id
  from commandcanvas_credential_probe_user;

  probe_status := public.upsert_user_openai_credential(
    probe_user_id,
    probe_key,
    'sha256:0123456789abcdef'
  );
  if probe_status->>'configured' <> 'true'
    or probe_status->>'key_fingerprint' <> 'sha256:0123456789abcdef'
  then
    raise exception 'credential_probe_status_invalid';
  end if;

  if public.resolve_user_openai_credential(probe_user_id) <> probe_key then
    raise exception 'credential_probe_resolve_invalid';
  end if;

  perform public.delete_user_openai_credential(probe_user_id);

  if (public.get_user_openai_credential_status(probe_user_id))->>'configured'
    <> 'false'
  then
    raise exception 'credential_probe_delete_status_invalid';
  end if;
end;
$$;

reset role;

do $$
declare
  probe_user_id uuid;
  probe_secret_id uuid;
begin
  select id into strict probe_user_id
  from commandcanvas_credential_probe_user;

  if exists (
    select 1
    from private.user_openai_credentials as credentials
    where credentials.user_id = probe_user_id
  ) then
    raise exception 'credential_probe_mapping_residue';
  end if;

  select vault.create_secret(
    'sk-commandcanvas-trigger-probe-key-123456789012345678',
    'commandcanvas-trigger-probe-' || probe_user_id::text,
    'Transactional CommandCanvas cleanup probe'
  ) into probe_secret_id;

  insert into private.user_openai_credentials (
    user_id,
    vault_secret_id,
    key_fingerprint
  ) values (
    probe_user_id,
    probe_secret_id,
    'sha256:fedcba9876543210'
  );

  delete from private.user_openai_credentials
  where user_id = probe_user_id;

  if exists (
    select 1 from vault.secrets where id = probe_secret_id
  ) then
    raise exception 'credential_probe_vault_secret_residue';
  end if;
end;
$$;

rollback;
