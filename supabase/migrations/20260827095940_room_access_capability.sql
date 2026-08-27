begin;

create table private.room_join_capabilities (
  room_id uuid primary key
    references public.rooms(id)
    on delete cascade,
  join_token_sha256 bytea not null
    check (octet_length(join_token_sha256) = 32),
  created_at timestamptz not null default clock_timestamp()
);

alter table private.room_join_capabilities enable row level security;

revoke all on table private.room_join_capabilities
  from public, anon, authenticated, service_role;

create index outbound_shares_room_packet_request_fk_idx
  on public.outbound_shares(room_id, packet_id, send_request_id);

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
     or char_length(p_slug) not between 12 and 96
     or p_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_slug';
  end if;

  if p_name is null
     or char_length(btrim(p_name)) not between 1 and 120
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
     or char_length(btrim(p_display_name)) not between 1 and 64
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
     or char_length(p_join_token) not between 32 and 256
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
      btrim(p_name),
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
      btrim(p_display_name),
      upper(p_color)
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

  return jsonb_build_object(
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

create or replace function public.join_room_as_participant(
  p_room_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_color text,
  p_join_token text,
  p_requested_role text default 'participant'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing_role text;
  v_joined boolean := false;
begin
  if p_room_id is null or p_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'room_required_identifier_missing';
  end if;

  if p_requested_role is distinct from 'participant' then
    raise exception using
      errcode = 'P0001',
      message = 'room_join_role_escalation_forbidden';
  end if;

  if p_display_name is null
     or char_length(btrim(p_display_name)) not between 1 and 64
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
     or char_length(p_join_token) not between 32 and 256
     or p_join_token !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_join_token';
  end if;

  if not exists (
    select 1
    from private.room_join_capabilities capability
    where capability.room_id = p_room_id
      and capability.join_token_sha256 = pg_catalog.sha256(
        pg_catalog.convert_to(p_join_token, 'UTF8')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'room_join_token_mismatch';
  end if;

  if not exists (
    select 1
    from auth.users user_row
    where user_row.id = p_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'room_user_not_found';
  end if;

  select member.role
  into v_existing_role
  from public.room_members member
  where member.room_id = p_room_id
    and member.user_id = p_user_id;

  if not found then
    insert into public.room_members (
      room_id,
      user_id,
      role,
      display_name,
      color
    ) values (
      p_room_id,
      p_user_id,
      'participant',
      btrim(p_display_name),
      upper(p_color)
    )
    on conflict (room_id, user_id) do nothing
    returning role into v_existing_role;

    if found then
      v_joined := true;
    else
      select member.role
      into strict v_existing_role
      from public.room_members member
      where member.room_id = p_room_id
        and member.user_id = p_user_id;
    end if;
  end if;

  return jsonb_build_object(
    'roomId', p_room_id,
    'role', v_existing_role,
    'joined', v_joined
  );
end;
$$;

revoke execute on function public.join_room_as_participant(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.join_room_as_participant(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) to service_role;

commit;
