begin;

-- The original room capability predates passwordless standard meetings. Keep
-- it as the deterministic no-signup demo path only. Standard rooms are
-- created by create_standard_meeting_with_host and joined exclusively through
-- accept_room_email_invitation.
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
    raise exception using errcode = 'P0001', message = 'room_invalid_slug';
  end if;

  if p_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 1 and 120
  then
    raise exception using errcode = 'P0001', message = 'room_invalid_name';
  end if;

  if p_mode is distinct from 'demo' then
    raise exception using errcode = 'P0001', message = 'room_invalid_mode';
  end if;

  if p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 64
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_display_name';
  end if;

  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using errcode = 'P0001', message = 'room_invalid_color';
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
    raise exception using errcode = 'P0001', message = 'room_user_not_found';
  end if;

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

  begin
    insert into public.rooms (id, slug, name, mode, created_by)
    values (
      p_room_id,
      p_slug,
      pg_catalog.btrim(p_name),
      'demo',
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
        select 1 from public.rooms room_row where room_row.id = p_room_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'room_id_already_exists';
      end if;

      if exists (
        select 1 from public.rooms room_row where room_row.slug = p_slug
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'room_slug_already_exists';
      end if;

      raise exception using errcode = 'P0001', message = 'room_create_conflict';
  end;

  return pg_catalog.jsonb_build_object(
    'roomId', p_room_id,
    'slug', p_slug,
    'role', 'host',
    'joined', true
  );
end;
$$;

revoke all on function public.create_room_with_host(
  uuid, text, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_room_with_host(
  uuid, text, text, text, uuid, text, text, text
) to service_role;

create or replace function public.create_standard_meeting_with_host(
  p_room_id uuid,
  p_slug text,
  p_name text,
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
declare
  v_is_anonymous boolean;
  v_email text;
  v_email_confirmed_at timestamptz;
begin
  if p_room_id is null or p_host_user_id is null then
    raise exception using errcode = 'P0001', message = 'permanent_email_auth_required';
  end if;

  if p_slug is null
     or pg_catalog.char_length(p_slug) not between 12 and 96
     or p_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
     or p_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 1 and 120
     or p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 64
     or p_color is null
     or p_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_join_token is null
     or pg_catalog.char_length(p_join_token) not between 32 and 256
     or p_join_token !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception using errcode = 'P0001', message = 'meeting_create_input_invalid';
  end if;

  select user_row.is_anonymous, user_row.email, user_row.email_confirmed_at
  into v_is_anonymous, v_email, v_email_confirmed_at
  from auth.users user_row
  where user_row.id = p_host_user_id;

  if not found
     or v_is_anonymous is true
     or v_email is null
     or v_email_confirmed_at is null
  then
    raise exception using errcode = 'P0001', message = 'permanent_email_auth_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:meeting:create:' || p_host_user_id::text,
      0
    )
  );

  if (
    select pg_catalog.count(*)
    from public.rooms room_row
    where room_row.created_by = p_host_user_id
      and room_row.mode = 'standard'
      and room_row.created_at > pg_catalog.clock_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'meeting_create_rate_limit';
  end if;

  begin
    insert into public.rooms (id, slug, name, mode, created_by)
    values (
      p_room_id,
      p_slug,
      pg_catalog.btrim(p_name),
      'standard',
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
  exception
    when unique_violation then
      if exists (
        select 1 from public.rooms room_row where room_row.id = p_room_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'room_id_already_exists';
      end if;

      if exists (
        select 1 from public.rooms room_row where room_row.slug = p_slug
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'room_slug_already_exists';
      end if;

      raise exception using errcode = 'P0001', message = 'room_create_conflict';
  end;

  return pg_catalog.jsonb_build_object(
    'roomId', p_room_id,
    'slug', p_slug,
    'role', 'host',
    'joined', true
  );
end;
$$;

revoke all on function public.create_standard_meeting_with_host(
  uuid, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_standard_meeting_with_host(
  uuid, text, text, uuid, text, text, text
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
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 64
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_display_name';
  end if;

  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using errcode = 'P0001', message = 'room_invalid_color';
  end if;

  if p_join_token is null
     or pg_catalog.char_length(p_join_token) not between 32 and 256
     or p_join_token !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'room_invalid_join_token';
  end if;

  -- Standard rooms deliberately look exactly like a missing room or bad
  -- token through this legacy capability. Their only participant path is the
  -- email-bound, single-use invitation RPC.
  if not exists (
    select 1
    from public.rooms room_row
    join private.room_join_capabilities capability
      on capability.room_id = room_row.id
    where room_row.id = p_room_id
      and room_row.mode = 'demo'
      and capability.join_token_sha256 = pg_catalog.sha256(
        pg_catalog.convert_to(p_join_token, 'UTF8')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'room_join_token_mismatch';
  end if;

  if not exists (
    select 1 from auth.users user_row where user_row.id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'room_user_not_found';
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
      pg_catalog.btrim(p_display_name),
      pg_catalog.upper(p_color)
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

  return pg_catalog.jsonb_build_object(
    'roomId', p_room_id,
    'role', v_existing_role,
    'joined', v_joined
  );
end;
$$;

revoke all on function public.join_room_as_participant(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.join_room_as_participant(
  uuid, uuid, text, text, text, text
) to service_role;

commit;
