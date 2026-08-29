begin;

alter table private.room_email_invitations
  add column request_id uuid not null default gen_random_uuid(),
  add column expires_in_hours integer,
  add column idempotency_key text,
  add column delivery_status text not null default 'created',
  add column provider_message_id text,
  add column delivery_error_code text,
  add column submitted_at timestamptz,
  add column last_provider_event_at timestamptz,
  add column delivery_updated_at timestamptz not null
    default pg_catalog.clock_timestamp();

update private.room_email_invitations invitation
set
  request_id = invitation.id,
  expires_in_hours = pg_catalog.greatest(
    1,
    pg_catalog.least(
      168,
      pg_catalog.ceil(
        extract(epoch from invitation.expires_at - invitation.created_at)
        / 3600.0
      )::integer
    )
  ),
  idempotency_key = 'commandcanvas:invite:' || invitation.id::text;

alter table private.room_email_invitations
  alter column request_id drop default,
  alter column expires_in_hours set not null,
  alter column idempotency_key set not null,
  add constraint room_email_invitations_request_unique
    unique (room_id, created_by_user_id, request_id),
  add constraint room_email_invitations_expiry_hours_valid
    check (expires_in_hours between 1 and 168),
  add constraint room_email_invitations_idempotency_key_valid
    check (
      pg_catalog.char_length(idempotency_key) between 16 and 256
      and idempotency_key ~ '^[!-~]+$'
    ),
  add constraint room_email_invitations_delivery_status_valid
    check (
      delivery_status in (
        'created',
        'sending',
        'reconciling',
        'preview_only',
        'submitted',
        'delivered',
        'bounced',
        'complained',
        'failed',
        'suppressed'
      )
    ),
  add constraint room_email_invitations_provider_message_valid
    check (
      provider_message_id is null
      or pg_catalog.char_length(provider_message_id) between 1 and 256
    ),
  add constraint room_email_invitations_delivery_error_valid
    check (
      delivery_error_code is null
      or (
        pg_catalog.char_length(delivery_error_code) between 1 and 120
        and delivery_error_code ~ '^[a-z][a-z0-9_]*$'
      )
    );

create unique index room_email_invitations_provider_message_idx
  on private.room_email_invitations(provider_message_id)
  where provider_message_id is not null;

create index room_email_invitations_delivery_updated_idx
  on private.room_email_invitations(room_id, delivery_updated_at desc);

alter table private.room_invitation_issuance_admissions
  add column recipient_email_sha256 bytea;

alter table private.room_invitation_issuance_admissions
  add constraint room_invitation_issuance_recipient_digest_valid
  check (
    recipient_email_sha256 is null
    or pg_catalog.octet_length(recipient_email_sha256) = 32
  );

create index room_invitation_issuance_recipient_time_idx
  on private.room_invitation_issuance_admissions(
    room_id,
    recipient_email_sha256,
    admitted_at desc
  )
  where recipient_email_sha256 is not null;

-- Shared host assertion for the service-only invitation mutation RPCs. The
-- route independently resolves the JWT; this database guard prevents a
-- service caller from substituting an anonymous user, participant, or outsider.
create or replace function private.assert_meeting_invitation_host(
  p_room_id uuid,
  p_host_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_anonymous boolean;
  v_email text;
  v_confirmed_at timestamptz;
  v_room_name text;
begin
  if p_room_id is null or p_host_user_id is null then
    raise exception using errcode = 'P0001', message = 'meeting_host_required';
  end if;

  select user_row.is_anonymous, user_row.email, user_row.email_confirmed_at
  into v_is_anonymous, v_email, v_confirmed_at
  from auth.users user_row
  where user_row.id = p_host_user_id;

  if not found
     or v_is_anonymous is true
     or v_email is null
     or v_confirmed_at is null
  then
    raise exception using errcode = 'P0001', message = 'permanent_email_auth_required';
  end if;

  select room_row.name
  into v_room_name
  from public.rooms room_row
  join public.room_members member
    on member.room_id = room_row.id
   and member.user_id = p_host_user_id
   and member.role = 'host'
  where room_row.id = p_room_id
    and room_row.mode = 'standard';

  if not found then
    raise exception using errcode = 'P0001', message = 'meeting_host_required';
  end if;

  return v_room_name;
end;
$$;

revoke execute on function private.assert_meeting_invitation_host(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_room_email_invitation(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
drop function public.create_room_email_invitation(
  uuid, uuid, uuid, text, text, text, text, timestamptz, text
);

create or replace function public.create_room_email_invitation(
  p_invitation_id uuid,
  p_request_id uuid,
  p_room_id uuid,
  p_actor_user_id uuid,
  p_recipient_email text,
  p_display_name text,
  p_color text,
  p_token text,
  p_expires_in_hours integer,
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
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_recipient_email));
  v_email_digest bytea;
  v_token_digest bytea;
  v_room_name text;
  v_existing private.room_email_invitations%rowtype;
  v_expires_at timestamptz;
begin
  if p_invitation_id is null
     or p_request_id is null
     or p_room_id is null
     or p_actor_user_id is null
     or p_requested_role is distinct from 'participant'
     or p_token is null
     or pg_catalog.char_length(p_token) not between 43 and 86
     or p_token !~ '^[A-Za-z0-9_-]+$'
     or v_email is null
     or pg_catalog.char_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 64
     or p_color is null
     or p_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_expires_in_hours is null
     or p_expires_in_hours not between 1 and 168
  then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_input_invalid';
  end if;

  v_room_name := private.assert_meeting_invitation_host(
    p_room_id,
    p_actor_user_id
  );

  select pg_catalog.lower(pg_catalog.btrim(user_row.email))
  into v_actor_email
  from auth.users user_row
  where user_row.id = p_actor_user_id;

  v_email_digest := pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8'));
  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));

  if v_email_digest = pg_catalog.sha256(
    pg_catalog.convert_to(v_actor_email, 'UTF8')
  ) then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_input_invalid';
  end if;

  -- All issue paths retain the original global/actor/room lock order. The
  -- recipient lock is last and makes the normalized recipient cooldown atomic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:invite:global', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:invite:actor:' || p_actor_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:invite:room:' || p_room_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:invite:recipient:' || pg_catalog.encode(v_email_digest, 'hex'),
      0
    )
  );

  select invitation.*
  into v_existing
  from private.room_email_invitations invitation
  where invitation.room_id = p_room_id
    and invitation.created_by_user_id = p_actor_user_id
    and invitation.request_id = p_request_id
  for update;

  if found then
    if v_existing.invited_email_sha256 <> v_email_digest
       or v_existing.display_name <> pg_catalog.btrim(p_display_name)
       or v_existing.participant_color <> pg_catalog.upper(p_color)
       or v_existing.role <> p_requested_role
       or v_existing.token_sha256 <> v_token_digest
       or v_existing.expires_in_hours <> p_expires_in_hours
    then
      raise exception using errcode = 'P0001', message = 'meeting_invitation_request_conflict';
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'existing',
      'invitationId', v_existing.id,
      'roomId', v_existing.room_id,
      'expiresAt', v_existing.expires_at,
      'roomName', v_room_name,
      'idempotencyKey', v_existing.idempotency_key,
      'deliveryStatus', v_existing.delivery_status,
      'providerMessageId', v_existing.provider_message_id
    );
  end if;

  delete from private.room_invitation_issuance_admissions admission
  where admission.admitted_at < v_now - interval '7 days';

  if exists (
    select 1
    from private.room_invitation_issuance_admissions admission
    where admission.room_id = p_room_id
      and admission.recipient_email_sha256 = v_email_digest
      and admission.admitted_at > v_now - interval '60 seconds'
  ) then
    raise exception using errcode = 'P0001', message = 'meeting_invite_recipient_cooldown';
  end if;

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

  v_expires_at := v_now + pg_catalog.make_interval(hours => p_expires_in_hours);

  insert into private.room_invitation_issuance_admissions(
    room_id,
    actor_user_id,
    recipient_email_sha256,
    admitted_at
  ) values (
    p_room_id,
    p_actor_user_id,
    v_email_digest,
    v_now
  );

  insert into private.room_email_invitations (
    id,
    room_id,
    request_id,
    invited_email_sha256,
    display_name,
    participant_color,
    role,
    token_sha256,
    expires_at,
    expires_in_hours,
    created_by_user_id,
    created_at,
    idempotency_key,
    delivery_status,
    delivery_updated_at
  ) values (
    p_invitation_id,
    p_room_id,
    p_request_id,
    v_email_digest,
    pg_catalog.btrim(p_display_name),
    pg_catalog.upper(p_color),
    'participant',
    v_token_digest,
    v_expires_at,
    p_expires_in_hours,
    p_actor_user_id,
    v_now,
    'commandcanvas:invite:' || p_invitation_id::text,
    'created',
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'created',
    'invitationId', p_invitation_id,
    'roomId', p_room_id,
    'expiresAt', v_expires_at,
    'roomName', v_room_name,
    'idempotencyKey', 'commandcanvas:invite:' || p_invitation_id::text,
    'deliveryStatus', 'created',
    'providerMessageId', null
  );
end;
$$;

create or replace function public.reserve_room_invitation_delivery(
  p_room_id uuid,
  p_invitation_id uuid,
  p_host_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invitation private.room_email_invitations%rowtype;
  v_changed boolean := false;
begin
  perform private.assert_meeting_invitation_host(p_room_id, p_host_user_id);

  select invitation.*
  into v_invitation
  from private.room_email_invitations invitation
  where invitation.id = p_invitation_id
    and invitation.room_id = p_room_id
    and invitation.created_by_user_id = p_host_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_unavailable';
  end if;

  if v_invitation.delivery_status in ('created', 'reconciling') then
    update private.room_email_invitations invitation
    set
      delivery_status = 'sending',
      delivery_error_code = null,
      delivery_updated_at = pg_catalog.clock_timestamp()
    where invitation.id = p_invitation_id;
    v_invitation.delivery_status := 'sending';
    v_invitation.delivery_error_code := null;
    v_changed := true;
  end if;

  return pg_catalog.jsonb_build_object(
    'invitationId', v_invitation.id,
    'deliveryStatus', v_invitation.delivery_status,
    'providerMessageId', v_invitation.provider_message_id,
    'changed', v_changed
  );
end;
$$;

create or replace function public.complete_room_invitation_delivery(
  p_room_id uuid,
  p_invitation_id uuid,
  p_host_user_id uuid,
  p_outcome text,
  p_provider_message_id text,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invitation private.room_email_invitations%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_error_code text := nullif(pg_catalog.btrim(p_error_code), '');
begin
  perform private.assert_meeting_invitation_host(p_room_id, p_host_user_id);

  if p_outcome not in ('preview_only', 'submitted', 'reconciling', 'failed')
     or (p_outcome = 'submitted' and (v_provider_message_id is null or v_error_code is not null))
     or (p_outcome = 'preview_only' and (v_provider_message_id is not null or v_error_code is not null))
     or (p_outcome = 'failed' and (v_provider_message_id is not null or v_error_code is null))
     or (p_outcome = 'reconciling' and v_error_code is null)
     or (v_provider_message_id is not null and pg_catalog.char_length(v_provider_message_id) > 256)
     or (v_error_code is not null and (
       pg_catalog.char_length(v_error_code) > 120
       or v_error_code !~ '^[a-z][a-z0-9_]*$'
     ))
  then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_delivery_invalid';
  end if;

  select invitation.*
  into v_invitation
  from private.room_email_invitations invitation
  where invitation.id = p_invitation_id
    and invitation.room_id = p_room_id
    and invitation.created_by_user_id = p_host_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_unavailable';
  end if;

  if v_invitation.delivery_status in (
    'preview_only', 'submitted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed'
  ) then
    if v_invitation.delivery_status = p_outcome
       and v_invitation.provider_message_id is not distinct from v_provider_message_id
       and v_invitation.delivery_error_code is not distinct from v_error_code
    then
      return pg_catalog.jsonb_build_object(
        'invitationId', v_invitation.id,
        'deliveryStatus', v_invitation.delivery_status,
        'providerMessageId', v_invitation.provider_message_id,
        'changed', false
      );
    end if;
    raise exception using errcode = 'P0001', message = 'meeting_invitation_delivery_conflict';
  end if;

  if v_invitation.delivery_status not in ('created', 'sending', 'reconciling') then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_delivery_conflict';
  end if;

  update private.room_email_invitations invitation
  set
    delivery_status = p_outcome,
    provider_message_id = v_provider_message_id,
    delivery_error_code = v_error_code,
    submitted_at = case
      when p_outcome = 'submitted' or v_provider_message_id is not null
        then coalesce(invitation.submitted_at, v_now)
      else invitation.submitted_at
    end,
    delivery_updated_at = v_now
  where invitation.id = p_invitation_id;

  return pg_catalog.jsonb_build_object(
    'invitationId', p_invitation_id,
    'deliveryStatus', p_outcome,
    'providerMessageId', v_provider_message_id,
    'changed', true
  );
end;
$$;

create or replace function public.load_room_invitation_delivery(
  p_room_id uuid,
  p_invitation_id uuid,
  p_host_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invitation private.room_email_invitations%rowtype;
begin
  perform private.assert_meeting_invitation_host(p_room_id, p_host_user_id);

  select invitation.*
  into v_invitation
  from private.room_email_invitations invitation
  where invitation.id = p_invitation_id
    and invitation.room_id = p_room_id
    and invitation.created_by_user_id = p_host_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'meeting_invitation_unavailable';
  end if;

  return pg_catalog.jsonb_build_object(
    'invitationId', v_invitation.id,
    'deliveryStatus', v_invitation.delivery_status,
    'providerMessageId', v_invitation.provider_message_id,
    'changed', false
  );
end;
$$;

revoke all on function public.create_room_email_invitation(
  uuid, uuid, uuid, uuid, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.create_room_email_invitation(
  uuid, uuid, uuid, uuid, text, text, text, text, integer, text
) to service_role;

revoke all on function public.reserve_room_invitation_delivery(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_room_invitation_delivery(uuid, uuid, uuid)
  to service_role;

revoke all on function public.complete_room_invitation_delivery(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_room_invitation_delivery(
  uuid, uuid, uuid, text, text, text
) to service_role;

revoke all on function public.load_room_invitation_delivery(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.load_room_invitation_delivery(uuid, uuid, uuid)
  to service_role;

commit;
