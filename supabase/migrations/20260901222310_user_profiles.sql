begin;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (pg_catalog.char_length(display_name) between 1 and 64),
  color text not null
    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

alter table private.user_profiles enable row level security;

revoke all on table private.user_profiles
  from public, anon, authenticated;

create or replace function private._get_user_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.coalesce(
    (
      select pg_catalog.jsonb_build_object(
        'configured', true,
        'display_name', profile.display_name,
        'color', profile.color,
        'updated_at', profile.updated_at
      )
      from private.user_profiles profile
      where profile.user_id = p_user_id
    ),
    pg_catalog.jsonb_build_object('configured', false)
  );
$$;

create or replace function private._upsert_user_profile(
  p_user_id uuid,
  p_display_name text,
  p_color text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
     or p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 64
     or p_color is null
     or p_color !~ '^#[0-9A-Fa-f]{6}$'
  then
    raise exception using errcode = '22023', message = 'invalid profile input';
  end if;

  if not exists (
    select 1
    from auth.users user_row
    where user_row.id = p_user_id
      and user_row.is_anonymous is not true
      and user_row.email is not null
      and user_row.email_confirmed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'permanent_email_auth_required';
  end if;

  insert into private.user_profiles (
    user_id,
    display_name,
    color,
    created_at,
    updated_at
  ) values (
    p_user_id,
    pg_catalog.btrim(p_display_name),
    pg_catalog.upper(p_color),
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      color = excluded.color,
      updated_at = excluded.updated_at;

  return private._get_user_profile(p_user_id);
end;
$$;

revoke all on function private._get_user_profile(uuid)
  from public, anon, authenticated;
revoke all on function private._upsert_user_profile(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private._get_user_profile(uuid) to service_role;
grant execute on function private._upsert_user_profile(uuid, text, text) to service_role;

create or replace function public.get_user_profile(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private._get_user_profile(p_user_id);
$$;

create or replace function public.upsert_user_profile(
  p_user_id uuid,
  p_display_name text,
  p_color text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private._upsert_user_profile(p_user_id, p_display_name, p_color);
$$;

revoke all on function public.get_user_profile(uuid)
  from public, anon, authenticated;
revoke all on function public.upsert_user_profile(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.get_user_profile(uuid) to service_role;
grant execute on function public.upsert_user_profile(uuid, text, text) to service_role;

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
  v_existing_slug text;
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

  select room_row.slug
  into v_existing_slug
  from public.rooms room_row
  join public.room_members member
    on member.room_id = room_row.id
   and member.user_id = p_host_user_id
   and member.role = 'host'
  where room_row.id = p_room_id
    and room_row.created_by = p_host_user_id
    and room_row.mode = 'standard'
    and room_row.name = pg_catalog.btrim(p_name);

  if found then
    insert into private.user_profiles (
      user_id, display_name, color, created_at, updated_at
    ) values (
      p_host_user_id,
      pg_catalog.btrim(p_display_name),
      pg_catalog.upper(p_color),
      pg_catalog.now(),
      pg_catalog.now()
    )
    on conflict (user_id) do update
    set display_name = excluded.display_name,
        color = excluded.color,
        updated_at = excluded.updated_at;

    return pg_catalog.jsonb_build_object(
      'roomId', p_room_id,
      'slug', v_existing_slug,
      'role', 'host',
      'joined', true,
      'resumed', true
    );
  end if;

  if exists (select 1 from public.rooms room_row where room_row.id = p_room_id) then
    raise exception using errcode = 'P0001', message = 'room_id_already_exists';
  end if;

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
      room_id, user_id, role, display_name, color
    ) values (
      p_room_id,
      p_host_user_id,
      'host',
      pg_catalog.btrim(p_display_name),
      pg_catalog.upper(p_color)
    );

    insert into private.user_profiles (
      user_id, display_name, color, created_at, updated_at
    ) values (
      p_host_user_id,
      pg_catalog.btrim(p_display_name),
      pg_catalog.upper(p_color),
      pg_catalog.now(),
      pg_catalog.now()
    )
    on conflict (user_id) do update
    set display_name = excluded.display_name,
        color = excluded.color,
        updated_at = excluded.updated_at;
  exception
    when unique_violation then
      if exists (select 1 from public.rooms room_row where room_row.id = p_room_id) then
        raise exception using errcode = 'P0001', message = 'room_id_already_exists';
      end if;
      if exists (select 1 from public.rooms room_row where room_row.slug = p_slug) then
        raise exception using errcode = 'P0001', message = 'room_slug_already_exists';
      end if;
      raise exception using errcode = 'P0001', message = 'room_create_conflict';
  end;

  return pg_catalog.jsonb_build_object(
    'roomId', p_room_id,
    'slug', p_slug,
    'role', 'host',
    'joined', true,
    'resumed', false
  );
end;
$$;

revoke all on function public.create_standard_meeting_with_host(
  uuid, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_standard_meeting_with_host(
  uuid, text, text, uuid, text, text, text
) to service_role;

commit;
