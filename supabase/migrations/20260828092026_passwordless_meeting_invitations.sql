begin;

create table private.room_email_invitations (
  id uuid primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  invited_email_sha256 bytea not null
    check (pg_catalog.octet_length(invited_email_sha256) = 32),
  display_name text not null
    check (pg_catalog.char_length(display_name) between 1 and 64),
  participant_color text not null
    check (participant_color ~ '^#[0-9A-Fa-f]{6}$'),
  role text not null default 'participant'
    check (role = 'participant'),
  token_sha256 bytea not null unique
    check (pg_catalog.octet_length(token_sha256) = 32),
  expires_at timestamptz not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_at timestamptz,
  consumed_by_user_id uuid,
  check (
    (consumed_at is null and consumed_by_user_id is null)
    or (consumed_at is not null and consumed_by_user_id is not null)
  )
);

create index room_email_invitations_room_created_idx
  on private.room_email_invitations(room_id, created_at desc);
create index room_email_invitations_actor_created_idx
  on private.room_email_invitations(created_by_user_id, created_at desc);

-- This admission ledger deliberately has no room/user foreign keys. Deleting
-- a room or identity must not reset invitation-send capacity.
create table private.room_invitation_issuance_admissions (
  id bigint generated always as identity primary key,
  room_id uuid not null,
  actor_user_id uuid not null,
  admitted_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index room_invitation_issuance_actor_time_idx
  on private.room_invitation_issuance_admissions(actor_user_id, admitted_at desc);
create index room_invitation_issuance_room_time_idx
  on private.room_invitation_issuance_admissions(room_id, admitted_at desc);
create index room_invitation_issuance_global_time_idx
  on private.room_invitation_issuance_admissions(admitted_at desc);

-- Failed and successful token attempts remain durable even if a room or user is
-- later removed, so deleting fixtures cannot reset abuse controls.
create table private.room_invitation_acceptance_attempts (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  attempted_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index room_invitation_acceptance_actor_time_idx
  on private.room_invitation_acceptance_attempts(actor_user_id, attempted_at desc);
create index room_invitation_acceptance_global_time_idx
  on private.room_invitation_acceptance_attempts(attempted_at desc);

alter table private.room_email_invitations enable row level security;
alter table private.room_invitation_issuance_admissions enable row level security;
alter table private.room_invitation_acceptance_attempts enable row level security;

revoke all privileges on table private.room_email_invitations
  from public, anon, authenticated, service_role;
revoke all privileges on table private.room_invitation_issuance_admissions
  from public, anon, authenticated, service_role;
revoke all privileges on table private.room_invitation_acceptance_attempts
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.room_invitation_issuance_admissions_id_seq
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.room_invitation_acceptance_attempts_id_seq
  from public, anon, authenticated, service_role;

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
  if p_host_user_id is null then
    raise exception using errcode = 'P0001', message = 'permanent_email_auth_required';
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
    pg_catalog.hashtextextended('commandcanvas:meeting:create:' || p_host_user_id::text, 0)
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

  return public.create_room_with_host(
    p_room_id,
    p_slug,
    p_name,
    'standard',
    p_host_user_id,
    p_display_name,
    p_color,
    p_join_token
  );
end;
$$;

revoke all on function public.create_standard_meeting_with_host(
  uuid, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_standard_meeting_with_host(
  uuid, text, text, uuid, text, text, text
) to service_role;

create or replace function public.create_room_email_invitation(
  p_invitation_id uuid,
  p_room_id uuid,
  p_actor_user_id uuid,
  p_invited_email text,
  p_display_name text,
  p_color text,
  p_token text,
  p_expires_at timestamptz,
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
  v_actor_email text;
  v_is_anonymous boolean;
  v_confirmed_at timestamptz;
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_invited_email));
begin
  if p_invitation_id is null or p_room_id is null or p_actor_user_id is null
     or p_requested_role is distinct from 'participant'
     or p_token is null or pg_catalog.char_length(p_token) not between 43 and 86
     or p_token !~ '^[A-Za-z0-9_-]+$'
     or v_email is null or pg_catalog.char_length(v_email) not between 3 and 254
     or pg_catalog.strpos(v_email, '@') <= 1
     or p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 64
     or p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_expires_at is null
     or p_expires_at < v_now + interval '5 minutes'
     or p_expires_at > v_now + interval '7 days'
  then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_input_invalid';
  end if;

  select user_row.email, user_row.is_anonymous, user_row.email_confirmed_at
  into v_actor_email, v_is_anonymous, v_confirmed_at
  from auth.users user_row
  where user_row.id = p_actor_user_id;

  if not found or v_is_anonymous is true or v_actor_email is null or v_confirmed_at is null
  then
    raise exception using errcode = 'P0001', message = 'permanent_email_auth_required';
  end if;

  if not exists (
    select 1
    from public.rooms room_row
    join public.room_members member
      on member.room_id = room_row.id
     and member.user_id = p_actor_user_id
     and member.role = 'host'
    where room_row.id = p_room_id
      and room_row.mode = 'standard'
  ) then
    raise exception using errcode = 'P0001', message = 'meeting_host_required';
  end if;

  if pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')) =
     pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(v_actor_email)), 'UTF8'))
  then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_input_invalid';
  end if;

  -- Always acquire the fixed global lock before narrower keys so independent
  -- server instances serialize limits in one order and cannot deadlock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:invite:global', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:invite:actor:' || p_actor_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:invite:room:' || p_room_id::text, 0)
  );

  delete from private.room_invitation_issuance_admissions admission
  where admission.admitted_at < v_now - interval '7 days';

  if (
    select pg_catalog.count(*)
    from private.room_invitation_issuance_admissions admission
    where admission.actor_user_id = p_actor_user_id
      and admission.admitted_at > v_now - interval '1 hour'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'meeting_invite_actor_rate_limit';
  end if;

  if (
    select pg_catalog.count(*)
    from private.room_invitation_issuance_admissions admission
    where admission.room_id = p_room_id
      and admission.admitted_at > v_now - interval '1 day'
  ) >= 30 then
    raise exception using errcode = 'P0001', message = 'meeting_invite_room_rate_limit';
  end if;

  if (
    select pg_catalog.count(*)
    from private.room_invitation_issuance_admissions admission
    where admission.admitted_at > v_now - interval '1 hour'
  ) >= 100 or (
    select pg_catalog.count(*)
    from private.room_invitation_issuance_admissions admission
    where admission.admitted_at > v_now - interval '1 day'
  ) >= 500 then
    raise exception using errcode = 'P0001', message = 'meeting_invite_global_rate_limit';
  end if;

  insert into private.room_invitation_issuance_admissions(
    room_id, actor_user_id, admitted_at
  ) values (p_room_id, p_actor_user_id, v_now);

  insert into private.room_email_invitations (
    id, room_id, invited_email_sha256, display_name, participant_color,
    role, token_sha256, expires_at, created_by_user_id, created_at
  ) values (
    p_invitation_id,
    p_room_id,
    pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')),
    pg_catalog.btrim(p_display_name),
    pg_catalog.upper(p_color),
    'participant',
    pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')),
    p_expires_at,
    p_actor_user_id,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'created',
    'invitationId', p_invitation_id,
    'roomId', p_room_id,
    'expiresAt', p_expires_at
  );
end;
$$;

revoke all on function public.create_room_email_invitation(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.create_room_email_invitation(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) to service_role;

create or replace function public.accept_room_email_invitation(
  p_actor_user_id uuid,
  p_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_email text;
  v_is_anonymous boolean;
  v_confirmed_at timestamptz;
  v_invitation private.room_email_invitations%rowtype;
  v_role text;
begin
  if p_actor_user_id is null or p_token is null
     or pg_catalog.char_length(p_token) not between 43 and 86
     or p_token !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_unavailable';
  end if;

  select user_row.email, user_row.is_anonymous, user_row.email_confirmed_at
  into v_email, v_is_anonymous, v_confirmed_at
  from auth.users user_row
  where user_row.id = p_actor_user_id;

  if not found or v_is_anonymous is true or v_email is null or v_confirmed_at is null
  then
    raise exception using errcode = 'P0001', message = 'permanent_email_auth_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:invite:accept:' || p_actor_user_id::text, 0)
  );

  if (
    select pg_catalog.count(*)
    from private.room_invitation_acceptance_attempts attempt
    where attempt.actor_user_id = p_actor_user_id
      and attempt.attempted_at > v_now - interval '10 minutes'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'meeting_invite_accept_rate_limit';
  end if;

  insert into private.room_invitation_acceptance_attempts(actor_user_id, attempted_at)
  values (p_actor_user_id, v_now);

  select invitation.* into v_invitation
  from private.room_email_invitations invitation
  where invitation.token_sha256 = pg_catalog.sha256(
    pg_catalog.convert_to(p_token, 'UTF8')
  )
  for update;

  if not found
     or v_invitation.expires_at <= v_now
     or v_invitation.invited_email_sha256 <> pg_catalog.sha256(
       pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(v_email)), 'UTF8')
     )
  then
    return pg_catalog.jsonb_build_object('outcome', 'unavailable');
  end if;

  if v_invitation.consumed_at is not null then
    if v_invitation.consumed_by_user_id = p_actor_user_id then
      return pg_catalog.jsonb_build_object(
        'outcome', 'already_joined',
        'roomId', v_invitation.room_id,
        'role', 'participant',
        'joined', false
      );
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'unavailable');
  end if;

  insert into public.room_members(room_id, user_id, role, display_name, color)
  values (
    v_invitation.room_id,
    p_actor_user_id,
    'participant',
    v_invitation.display_name,
    v_invitation.participant_color
  )
  on conflict (room_id, user_id) do nothing;

  select member.role into v_role
  from public.room_members member
  where member.room_id = v_invitation.room_id
    and member.user_id = p_actor_user_id;

  if v_role is distinct from 'participant' then
    return pg_catalog.jsonb_build_object('outcome', 'unavailable');
  end if;

  update private.room_email_invitations invitation
  set consumed_at = clock_timestamp(),
      consumed_by_user_id = p_actor_user_id
  where invitation.id = v_invitation.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'joined',
    'roomId', v_invitation.room_id,
    'role', 'participant',
    'joined', true
  );
end;
$$;

revoke all on function public.accept_room_email_invitation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_room_email_invitation(uuid, text)
  to service_role;

commit;
