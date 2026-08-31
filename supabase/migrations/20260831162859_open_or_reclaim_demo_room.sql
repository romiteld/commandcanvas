begin;

alter table private.room_join_capabilities
  add column previous_join_token_sha256 bytea,
  add column previous_join_token_valid_until timestamptz,
  add constraint room_join_capabilities_previous_token_pair_check
    check (
      (
        previous_join_token_sha256 is null
        and previous_join_token_valid_until is null
      )
      or
      (
        pg_catalog.octet_length(previous_join_token_sha256) = 32
        and previous_join_token_valid_until is not null
      )
    );

-- Room-owned receipt history must cascade as one graph. The original
-- non-deferrable RESTRICT self-reference could reject a parent-room cascade
-- when an undo receipt and its target are deleted in the same statement.
alter table public.receipts
  drop constraint receipts_undoes_receipt_id_fkey,
  add constraint receipts_undoes_receipt_id_fkey
    foreign key (undoes_receipt_id)
    references public.receipts(id)
    on delete no action
    deferrable initially deferred;

create index rooms_demo_host_activity_idx
  on public.rooms (
    created_by,
    updated_at desc,
    created_at desc,
    id desc
  )
  where mode = 'demo';

-- A Supabase anonymous identity outlives a single browser tab, while the raw
-- demo join capability intentionally does not. Open one actor-owned demo room
-- atomically so a fresh tab can recover without persisting that capability in
-- localStorage. Preserve the actor's latest room even if high-frequency
-- Presence activity has not touched its durable timestamp; reclaim only older
-- actor-owned rooms after 24 hours without a durable room mutation.
create or replace function public.open_demo_room_with_host(
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
  v_room_id uuid;
  v_slug text;
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

  select room_row.id, room_row.slug
  into v_room_id, v_slug
  from public.rooms room_row
  where room_row.created_by = p_host_user_id
    and room_row.mode = 'demo'
  order by room_row.updated_at desc, room_row.created_at desc, room_row.id desc
  limit 1
  for update;

  delete from public.rooms as room_row
  where room_row.created_by = p_host_user_id
    and room_row.mode = 'demo'
    and room_row.id <> v_room_id
    and room_row.updated_at < pg_catalog.clock_timestamp() - interval '24 hours';

  if v_room_id is not null then
    update public.rooms
    set updated_at = pg_catalog.clock_timestamp()
    where id = v_room_id;

    update public.room_members
    set
      display_name = pg_catalog.btrim(p_display_name),
      color = pg_catalog.upper(p_color)
    where room_id = v_room_id
      and user_id = p_host_user_id
      and role = 'host';

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'room_host_membership_missing';
    end if;

    update private.room_join_capabilities
    set
      previous_join_token_sha256 = join_token_sha256,
      previous_join_token_valid_until =
        pg_catalog.clock_timestamp() + interval '1 hour',
      join_token_sha256 = pg_catalog.sha256(
        pg_catalog.convert_to(p_join_token, 'UTF8')
      )
    where room_id = v_room_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'room_capability_missing';
    end if;

    return pg_catalog.jsonb_build_object(
      'roomId', v_room_id,
      'slug', v_slug,
      'role', 'host',
      'joined', true,
      'resumed', true
    );
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
    'joined', true,
    'resumed', false
  );
end;
$$;

revoke all on function public.open_demo_room_with_host(
  uuid, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.open_demo_room_with_host(
  uuid, text, text, uuid, text, text, text
) to service_role;

-- Reopening a host tab rotates the raw capability returned to that tab. Keep
-- only the immediately previous hash for one hour so a participant using an
-- invite that was just copied from another host tab is not rejected. No raw
-- token is stored, and the grace window cannot grow without bound.
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

  if not exists (
    select 1
    from public.rooms room_row
    join private.room_join_capabilities capability
      on capability.room_id = room_row.id
    where room_row.id = p_room_id
      and room_row.mode = 'demo'
      and (
        capability.join_token_sha256 = pg_catalog.sha256(
          pg_catalog.convert_to(p_join_token, 'UTF8')
        )
        or (
          capability.previous_join_token_sha256 = pg_catalog.sha256(
            pg_catalog.convert_to(p_join_token, 'UTF8')
          )
          and capability.previous_join_token_valid_until >
            pg_catalog.clock_timestamp()
        )
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

-- Reset and reopen share one actor lock so an exact host reset cannot delete a
-- room between open's ownership selection and capability refresh.
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_user_id::text, 1131372637)
  );

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

revoke all on function public.delete_demo_room_as_host(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.delete_demo_room_as_host(
  uuid, uuid
) to service_role;

commit;
