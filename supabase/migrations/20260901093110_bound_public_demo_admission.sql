begin;

-- Demo rooms are public judge resources, not permanent workspaces. This column
-- is deliberately separate from updated_at: opening or mutating a room may
-- refresh activity, but it must never extend the absolute lifetime assigned at
-- creation. Legacy rows use created_at + 24 hours in the RPC predicates.
alter table public.rooms
  add column if not exists demo_hard_expires_at timestamptz;

create index if not exists rooms_demo_hard_expiry_idx
  on public.rooms(demo_hard_expires_at, id)
  where mode = 'demo';

-- These ledgers intentionally have no room or Auth foreign keys. Resetting a
-- room, deleting a room, or rotating an anonymous identity must not restore the
-- shared public allowance it already consumed.
create table if not exists private.demo_room_creation_admissions (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  room_id uuid not null,
  admitted_at timestamptz not null default pg_catalog.clock_timestamp(),
  hard_expires_at timestamptz not null,
  check (hard_expires_at > admitted_at)
);

create index if not exists demo_room_creation_admissions_time_idx
  on private.demo_room_creation_admissions(admitted_at desc);

create index if not exists demo_room_creation_admissions_actor_time_idx
  on private.demo_room_creation_admissions(actor_user_id, admitted_at desc);

alter table private.demo_room_creation_admissions enable row level security;

revoke all privileges on table private.demo_room_creation_admissions
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.demo_room_creation_admissions_id_seq
  from public, anon, authenticated, service_role;

create table if not exists private.demo_room_join_admissions (
  id bigint generated always as identity primary key,
  room_id uuid not null,
  actor_user_id uuid not null,
  admitted_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index if not exists demo_room_join_admissions_time_idx
  on private.demo_room_join_admissions(admitted_at desc);

create index if not exists demo_room_join_admissions_room_time_idx
  on private.demo_room_join_admissions(room_id, admitted_at desc);

create index if not exists demo_room_join_admissions_actor_time_idx
  on private.demo_room_join_admissions(actor_user_id, admitted_at desc);

alter table private.demo_room_join_admissions enable row level security;

revoke all privileges on table private.demo_room_join_admissions
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.demo_room_join_admissions_id_seq
  from public, anon, authenticated, service_role;

-- PostgreSQL sequence changes survive transaction rollback. That property is
-- intentional here: token mismatches still raise the established RPC error,
-- while the rejected attempt remains counted in the current ten-minute bucket.
create sequence if not exists private.demo_room_join_attempt_counter
  as bigint
  minvalue 0
  start with 0;

revoke all privileges on sequence private.demo_room_join_attempt_counter
  from public, anon, authenticated, service_role;

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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day_start timestamptz := (
    pg_catalog.date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC'
  );
  v_hard_expires_at timestamptz := v_now + interval '24 hours';
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

  -- Every creator observes the same active and UTC-day ceiling. The fixed lock
  -- is acquired before the actor lock everywhere in this function.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:demo-room:global', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:demo-room:actor:' || p_host_user_id::text,
      0
    )
  );

  select room_row.id, room_row.slug
  into v_room_id, v_slug
  from public.rooms room_row
  where room_row.created_by = p_host_user_id
    and room_row.mode = 'demo'
    and (
      room_row.demo_hard_expires_at > v_now
      or (
        room_row.demo_hard_expires_at is null
        and room_row.created_at + interval '24 hours' > v_now
      )
    )
  order by room_row.updated_at desc, room_row.created_at desc, room_row.id desc
  limit 1
  for update;

  if v_room_id is not null then
    -- This activity touch intentionally does not change demo_hard_expires_at.
    update public.rooms
    set updated_at = v_now
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
      previous_join_token_valid_until = v_now + interval '1 hour',
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

  if (
    select pg_catalog.count(*)
    from public.rooms room_row
    where room_row.mode = 'demo'
      and coalesce(
        room_row.demo_hard_expires_at,
        room_row.created_at + interval '24 hours'
      ) > v_now
  ) >= 64 then
    raise exception using
      errcode = 'P0001',
      message = 'demo_room_global_capacity_reached';
  end if;

  if (
    select pg_catalog.count(*)
    from private.demo_room_creation_admissions admission
    where admission.admitted_at >= v_day_start
  ) >= 100 then
    raise exception using
      errcode = 'P0001',
      message = 'demo_room_daily_limit_reached';
  end if;

  begin
    insert into public.rooms (
      id,
      slug,
      name,
      mode,
      created_by,
      demo_hard_expires_at
    ) values (
      p_room_id,
      p_slug,
      pg_catalog.btrim(p_name),
      'demo',
      p_host_user_id,
      v_hard_expires_at
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

    insert into private.demo_room_creation_admissions (
      actor_user_id,
      room_id,
      admitted_at,
      hard_expires_at
    ) values (
      p_host_user_id,
      p_room_id,
      v_now,
      v_hard_expires_at
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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day_start timestamptz := (
    pg_catalog.date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC'
  );
  v_attempt_bucket bigint;
  v_attempt_count bigint;
  v_attempt_state bigint;
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
    select 1 from auth.users user_row where user_row.id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'room_user_not_found';
  end if;

  -- Count every well-formed attempt by an existing Auth actor before token
  -- lookup. setval is non-transactional, so a later token-mismatch exception
  -- cannot restore the allowance. The global lock makes the packed
  -- ten-minute-bucket counter atomic across all Vercel instances.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:demo-join:global', 0)
  );

  v_attempt_bucket := pg_catalog.floor(
    extract(epoch from v_now) / 600
  )::bigint;

  select counter.last_value
  into strict v_attempt_state
  from private.demo_room_join_attempt_counter counter;

  if v_attempt_state / 100000 = v_attempt_bucket then
    v_attempt_count := v_attempt_state % 100000;
  else
    v_attempt_count := 0;
  end if;

  if v_attempt_count >= 160 then
    raise exception using errcode = 'P0001', message = 'demo_join_rate_limited';
  end if;

  perform pg_catalog.setval(
    'private.demo_room_join_attempt_counter'::regclass,
    v_attempt_bucket * 100000 + v_attempt_count + 1,
    true
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:demo-join:room:' || p_room_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.rooms room_row
    join private.room_join_capabilities capability
      on capability.room_id = room_row.id
    where room_row.id = p_room_id
      and room_row.mode = 'demo'
      and coalesce(
        room_row.demo_hard_expires_at,
        room_row.created_at + interval '24 hours'
      ) > v_now
      and (
        capability.join_token_sha256 = pg_catalog.sha256(
          pg_catalog.convert_to(p_join_token, 'UTF8')
        )
        or (
          capability.previous_join_token_sha256 = pg_catalog.sha256(
            pg_catalog.convert_to(p_join_token, 'UTF8')
          )
          and capability.previous_join_token_valid_until > v_now
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'room_join_token_mismatch';
  end if;

  select member.role
  into v_existing_role
  from public.room_members member
  where member.room_id = p_room_id
    and member.user_id = p_user_id;

  if found then
    return pg_catalog.jsonb_build_object(
      'roomId', p_room_id,
      'role', v_existing_role,
      'joined', false
    );
  end if;

  if (
    select pg_catalog.count(*)
    from public.room_members member
    where member.room_id = p_room_id
  ) >= 8 then
    raise exception using errcode = 'P0001', message = 'demo_room_full';
  end if;

  if (
    select pg_catalog.count(*)
    from private.demo_room_join_admissions admission
    where admission.admitted_at > v_now - interval '10 minutes'
  ) >= 80 then
    raise exception using errcode = 'P0001', message = 'demo_join_rate_limited';
  end if;

  if (
    select pg_catalog.count(*)
    from private.demo_room_join_admissions admission
    where admission.admitted_at >= v_day_start
  ) >= 400 then
    raise exception using errcode = 'P0001', message = 'demo_join_rate_limited';
  end if;

  if (
    select pg_catalog.count(*)
    from private.demo_room_join_admissions admission
    where admission.room_id = p_room_id
      and admission.admitted_at > v_now - interval '10 minutes'
  ) >= 16 then
    raise exception using errcode = 'P0001', message = 'demo_join_rate_limited';
  end if;

  if (
    select pg_catalog.count(*)
    from private.demo_room_join_admissions admission
    where admission.actor_user_id = p_user_id
      and admission.admitted_at > v_now - interval '10 minutes'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'demo_join_rate_limited';
  end if;

  insert into private.demo_room_join_admissions (
    room_id,
    actor_user_id,
    admitted_at
  ) values (
    p_room_id,
    p_user_id,
    v_now
  );

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

-- Browser policies and service-only RPCs must apply the same hard lifetime to
-- actors who joined before expiry. This helper binds the authorization lookup
-- to auth.uid(), lives outside the exposed API schema, and fails closed for
-- legacy demo rows after created_at + 24 hours.
create or replace function private.room_access_allowed(
  p_room_id uuid,
  p_required_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.rooms room_row
      join public.room_members member
        on member.room_id = room_row.id
       and member.user_id = auth.uid()
      where room_row.id = p_room_id
        and (
          p_required_role is null
          or member.role = p_required_role
        )
        and (
          room_row.mode <> 'demo'
          or coalesce(
            room_row.demo_hard_expires_at,
            room_row.created_at + interval '24 hours'
          ) > pg_catalog.statement_timestamp()
        )
    );
$$;

revoke all on function private.room_access_allowed(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.room_access_allowed(uuid, text)
  to authenticated;

-- Service-role RPCs bypass RLS, so they need an explicit execute-time guard.
-- A missing room is intentionally left to each existing RPC's established
-- not-found error; only an existing, expired demo room changes behavior.
create or replace function private.assert_room_active(
  p_room_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_hard_expires_at timestamptz;
begin
  select
    room_row.mode,
    coalesce(
      room_row.demo_hard_expires_at,
      room_row.created_at + interval '24 hours'
    )
  into v_mode, v_hard_expires_at
  from public.rooms room_row
  where room_row.id = p_room_id;

  if found
     and v_mode = 'demo'
     and v_hard_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using
      errcode = 'P0001',
      message = 'demo_room_expired';
  end if;
end;
$$;

revoke all on function private.assert_room_active(uuid)
  from public, anon, authenticated, service_role;

-- Replace every browser-readable room policy with the shared active-room
-- predicate. The self predicate on room_members is retained so one member
-- cannot enumerate another member's row.
drop policy if exists room_members_select_self on public.room_members;
create policy room_members_select_self
on public.room_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.room_access_allowed(room_id, null))
);

drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member
on public.rooms
for select
to authenticated
using ((select private.room_access_allowed(id, null)));

drop policy if exists canvas_objects_select_member on public.canvas_objects;
create policy canvas_objects_select_member
on public.canvas_objects
for select
to authenticated
using ((select private.room_access_allowed(room_id, null)));

drop policy if exists receipts_select_member on public.receipts;
create policy receipts_select_member
on public.receipts
for select
to authenticated
using ((select private.room_access_allowed(room_id, null)));

drop policy if exists meeting_packets_select_host on public.meeting_packets;
create policy meeting_packets_select_host
on public.meeting_packets
for select
to authenticated
using ((select private.room_access_allowed(room_id, 'host')));

drop policy if exists packet_send_requests_select_host
on public.packet_send_requests;
create policy packet_send_requests_select_host
on public.packet_send_requests
for select
to authenticated
using ((select private.room_access_allowed(room_id, 'host')));

drop policy if exists outbound_shares_select_host on public.outbound_shares;
create policy outbound_shares_select_host
on public.outbound_shares
for select
to authenticated
using ((select private.room_access_allowed(room_id, 'host')));

drop policy if exists packet_activity_receipts_select_host
on public.packet_activity_receipts;
create policy packet_activity_receipts_select_host
on public.packet_activity_receipts
for select
to authenticated
using ((select private.room_access_allowed(room_id, 'host')));

-- Realtime evaluates these policies when a private channel is joined (and
-- when a new JWT refreshes its cached authorization). Both collaboration and
-- meeting-media topics lose read/write admission after hard expiry.
drop policy if exists commandcanvas_room_realtime_read
on realtime.messages;
create policy commandcanvas_room_realtime_read
on realtime.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.user_id = (select auth.uid())
      and (select private.room_access_allowed(member.room_id, null))
      and (
        (
          (select realtime.topic()) = 'room:' || member.room_id::text
          and realtime.messages.extension in ('broadcast', 'presence')
        )
        or (
          (select realtime.topic()) = 'room-media:' || member.room_id::text
          and realtime.messages.extension = 'broadcast'
        )
      )
  )
);

drop policy if exists commandcanvas_room_realtime_write
on realtime.messages;
create policy commandcanvas_room_realtime_write
on realtime.messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.room_members member
    where member.user_id = (select auth.uid())
      and (select private.room_access_allowed(member.room_id, null))
      and (
        (
          (select realtime.topic()) = 'room:' || member.room_id::text
          and realtime.messages.extension in ('broadcast', 'presence')
        )
        or (
          (select realtime.topic()) = 'room-media:' || member.room_id::text
          and realtime.messages.extension = 'broadcast'
        )
      )
  )
);

-- All canvas input paths converge here. Adding the guard to this canonical
-- wrapper covers direct mutations and commit_canvas_mutation_at_revision.
create or replace function public.commit_canvas_mutation(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_source text,
  p_action text,
  p_description text,
  p_changes jsonb,
  p_inverse_command jsonb default null,
  p_reversible boolean default true,
  p_undoes_receipt_id uuid default null,
  p_receipt_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_room_active(p_room_id);
  perform private.validate_canvas_actor_source(p_actor_type, p_source);
  perform pg_catalog.set_config(
    'commandcanvas.receipt_source',
    p_source,
    true
  );

  return private.commit_canvas_mutation_core(
    p_room_id => p_room_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_type => p_actor_type,
    p_action => p_action,
    p_description => p_description,
    p_changes => p_changes,
    p_inverse_command => p_inverse_command,
    p_reversible => p_reversible,
    p_undoes_receipt_id => p_undoes_receipt_id,
    p_receipt_id => p_receipt_id
  );
end;
$$;

revoke all on function public.commit_canvas_mutation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, boolean, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.commit_canvas_mutation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, boolean, uuid, uuid
) to service_role;

-- Preserve the audited provider admission implementations byte-for-byte by
-- moving them behind same-signature public wrappers with the common guard.
alter function public.admit_realtime_voice_session(uuid, uuid)
  rename to admit_realtime_voice_session_without_expiry_guard;
alter function public.admit_realtime_voice_session_without_expiry_guard(uuid, uuid)
  set schema private;
revoke all on function private.admit_realtime_voice_session_without_expiry_guard(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.admit_realtime_voice_session(
  p_room_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_room_active(p_room_id);
  return private.admit_realtime_voice_session_without_expiry_guard(
    p_room_id,
    p_actor_user_id
  );
end;
$$;

revoke all on function public.admit_realtime_voice_session(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admit_realtime_voice_session(uuid, uuid)
  to service_role;

alter function public.admit_private_hand_relay_session(uuid, uuid)
  rename to admit_private_hand_relay_session_without_expiry_guard;
alter function public.admit_private_hand_relay_session_without_expiry_guard(
  uuid, uuid
) set schema private;
revoke all on function private.admit_private_hand_relay_session_without_expiry_guard(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.admit_private_hand_relay_session(
  p_room_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_room_active(p_room_id);
  return private.admit_private_hand_relay_session_without_expiry_guard(
    p_room_id,
    p_actor_user_id
  );
end;
$$;

revoke all on function public.admit_private_hand_relay_session(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admit_private_hand_relay_session(uuid, uuid)
  to service_role;

alter function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid, text
) rename to admit_sketch_transform_without_expiry_guard;
alter function public.admit_sketch_transform_without_expiry_guard(
  uuid, uuid, text, bigint, text, text, text, text, uuid, text
) set schema private;
revoke all on function private.admit_sketch_transform_without_expiry_guard(
  uuid, uuid, text, bigint, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.admit_sketch_transform(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_sketch_object_id text,
  p_source_version bigint,
  p_output_kind text,
  p_normalized_instruction_sha256 text,
  p_png_sha256 text,
  p_request_key text,
  p_lease_token uuid,
  p_normalized_narration_sha256 text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_room_active(p_room_id);
  return private.admit_sketch_transform_without_expiry_guard(
    p_room_id => p_room_id,
    p_actor_user_id => p_actor_user_id,
    p_sketch_object_id => p_sketch_object_id,
    p_source_version => p_source_version,
    p_output_kind => p_output_kind,
    p_normalized_instruction_sha256 => p_normalized_instruction_sha256,
    p_png_sha256 => p_png_sha256,
    p_request_key => p_request_key,
    p_lease_token => p_lease_token,
    p_normalized_narration_sha256 => p_normalized_narration_sha256
  );
end;
$$;

revoke all on function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid, text
) to service_role;

alter function public.complete_sketch_transform(text, uuid, text, text, jsonb)
  rename to complete_sketch_transform_without_expiry_guard;
alter function public.complete_sketch_transform_without_expiry_guard(
  text, uuid, text, text, jsonb
) set schema private;
revoke all on function private.complete_sketch_transform_without_expiry_guard(
  text, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.complete_sketch_transform(
  p_request_key text,
  p_lease_token uuid,
  p_model text,
  p_provider_response_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  select admission.room_id
  into v_room_id
  from private.sketch_transform_admissions admission
  where admission.request_key = p_request_key;

  perform private.assert_room_active(v_room_id);
  return private.complete_sketch_transform_without_expiry_guard(
    p_request_key,
    p_lease_token,
    p_model,
    p_provider_response_id,
    p_payload
  );
end;
$$;

revoke all on function public.complete_sketch_transform(
  text, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_sketch_transform(
  text, uuid, text, text, jsonb
) to service_role;

-- Packet and Resend RPCs already converge on this private helper. Replacing it
-- once blocks prepare, update, approve, stage, authorize, complete, and resend
-- admission after demo expiry while preserving standard-room behavior.
create or replace function private.assert_packet_host(
  p_room_id uuid,
  p_host_user_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  if p_room_id is null or p_host_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'packet_host_required';
  end if;

  perform private.assert_room_active(p_room_id);

  select member.display_name
  into v_display_name
  from public.rooms room_row
  join public.room_members member
    on member.room_id = room_row.id
   and member.user_id = p_host_user_id
   and member.role = 'host'
  where room_row.id = p_room_id
  for update of room_row;

  if not found then
    if not exists (
      select 1 from public.rooms room_row where room_row.id = p_room_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'packet_room_not_found';
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'packet_host_required';
  end if;

  return v_display_name;
end;
$$;

revoke all on function private.assert_packet_host(uuid, uuid)
  from public, anon, authenticated, service_role;

commit;
