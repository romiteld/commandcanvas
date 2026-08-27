begin;

create or replace function public.create_room_with_host(
  p_room_id uuid,
  p_slug text,
  p_name text,
  p_mode text,
  p_host_user_id uuid,
  p_display_name text,
  p_color text,
  p_join_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_room_id is null or p_host_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'room_required_identifier_missing';
  end if;

  if p_slug is null
     or pg_catalog.char_length(p_slug) not between 12 and 96
     or p_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_slug';
  end if;

  if p_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 1 and 120
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_name';
  end if;

  if p_mode is null or p_mode not in ('standard', 'demo') then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_mode';
  end if;

  if p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 64
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_display_name';
  end if;

  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_color';
  end if;

  if p_join_token is null
     or pg_catalog.char_length(p_join_token) not between 32 and 256
     or p_join_token !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_join_token';
  end if;

  if not exists (
    select 1
    from auth.users user_row
    where user_row.id = p_host_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'room_user_not_found';
  end if;

  if p_mode = 'demo' then
    -- The transaction-scoped actor lock makes the count and insert one
    -- serialized admission decision, including concurrent requests.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_host_user_id::text, 1131372637)
    );

    if (
      select pg_catalog.count(*)
      from public.rooms room_row
      where room_row.created_by = p_host_user_id
        and room_row.mode = 'demo'
    ) >= 3 then
      raise exception using
        errcode = 'P0001',
        message = 'demo_room_limit_reached';
    end if;
  end if;

  begin
    insert into public.rooms (
      id,
      slug,
      name,
      mode,
      created_by
    ) values (
      p_room_id,
      p_slug,
      pg_catalog.btrim(p_name),
      p_mode,
      p_host_user_id
    );

    insert into public.room_members (
      room_id,
      user_id,
      role,
      display_name,
      color
    ) values (
      p_room_id,
      p_host_user_id,
      'host',
      pg_catalog.btrim(p_display_name),
      pg_catalog.upper(p_color)
    );

    insert into private.room_join_capabilities (
      room_id,
      join_token_sha256
    ) values (
      p_room_id,
      pg_catalog.sha256(pg_catalog.convert_to(p_join_token, 'UTF8'))
    );
  exception
    when unique_violation then
      if exists (
        select 1
        from public.rooms room_row
        where room_row.id = p_room_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'room_id_already_exists';
      end if;

      if exists (
        select 1
        from public.rooms room_row
        where room_row.slug = p_slug
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'room_slug_already_exists';
      end if;

      raise exception using
        errcode = 'P0001',
        message = 'room_create_conflict';
  end;

  return pg_catalog.jsonb_build_object(
    'roomId', p_room_id,
    'slug', p_slug,
    'role', 'host',
    'joined', true
  );
end;
$$;

revoke execute on function public.create_room_with_host(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.create_room_with_host(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text
) to service_role;

create or replace function public.delete_demo_room_as_host(
  p_room_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted_room_id uuid;
begin
  if p_room_id is null or p_actor_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'demo_room_delete_forbidden';
  end if;

  delete from public.rooms room_row
  using public.room_members member
  where room_row.id = p_room_id
    and room_row.mode = 'demo'
    and member.room_id = room_row.id
    and member.user_id = p_actor_user_id
    and member.role = 'host'
  returning room_row.id into v_deleted_room_id;

  if v_deleted_room_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'demo_room_delete_forbidden';
  end if;

  return pg_catalog.jsonb_build_object(
    'roomId', v_deleted_room_id,
    'deleted', true
  );
end;
$$;

revoke execute on function public.delete_demo_room_as_host(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.delete_demo_room_as_host(uuid, uuid)
  to service_role;

commit;
