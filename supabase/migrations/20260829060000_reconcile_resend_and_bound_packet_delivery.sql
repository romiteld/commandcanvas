begin;

-- Resend admission is intentionally private and stores no address, content, or
-- provider credential. A durable row makes retries of one approved send free,
-- while the time indexes make every admission cap an atomic database decision.
create table private.packet_resend_admissions (
  id bigint generated always as identity primary key,
  send_request_id uuid not null unique,
  room_id uuid not null,
  actor_user_id uuid not null,
  room_mode text not null check (room_mode in ('standard', 'demo')),
  admitted_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index packet_resend_admissions_actor_time_idx
  on private.packet_resend_admissions(actor_user_id, admitted_at desc);
create index packet_resend_admissions_room_time_idx
  on private.packet_resend_admissions(room_id, admitted_at desc);
create index packet_resend_admissions_global_time_idx
  on private.packet_resend_admissions(admitted_at desc);

alter table private.packet_resend_admissions enable row level security;

revoke all privileges on table private.packet_resend_admissions
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.packet_resend_admissions_id_seq
  from public, anon, authenticated, service_role;

-- Preserve idempotent retries for accepted standard-room sends that predate
-- this admission ledger. Demo-room history is deliberately never admitted.
insert into private.packet_resend_admissions (
  send_request_id,
  room_id,
  actor_user_id,
  room_mode,
  admitted_at
)
select
  request.id,
  request.room_id,
  request.requested_by_user_id,
  room_row.mode,
  coalesce(request.authorized_at, request.requested_at)
from public.packet_send_requests request
join public.rooms room_row on room_row.id = request.room_id
join public.outbound_shares share
  on share.room_id = request.room_id
 and share.send_request_id = request.id
 and share.provider = 'resend'
where room_row.mode = 'standard'
on conflict (send_request_id) do nothing;

create or replace function public.reserve_packet_resend_admission(
  p_room_id uuid,
  p_send_request_id uuid,
  p_host_user_id uuid
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
    pg_catalog.date_trunc('day', pg_catalog.clock_timestamp() at time zone 'UTC')
    at time zone 'UTC'
  );
  v_room_mode text;
  v_existing private.packet_resend_admissions%rowtype;
  v_request public.packet_send_requests%rowtype;
  v_packet public.meeting_packets%rowtype;
  v_count bigint;
  v_inserted integer;
begin
  perform private.assert_packet_host(p_room_id, p_host_user_id);

  if p_room_id is null
     or p_send_request_id is null
     or p_host_user_id is null
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_resend_admission_input_invalid';
  end if;

  select room_row.mode
  into strict v_room_mode
  from public.rooms room_row
  where room_row.id = p_room_id;

  if v_room_mode = 'demo' then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'demo_room_preview_only',
      'changed', false
    );
  end if;

  if v_room_mode <> 'standard' then
    raise exception using
      errcode = 'P0001',
      message = 'packet_resend_room_mode_invalid';
  end if;

  -- Global, actor, then room is the only advisory-lock order used here.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:packet-resend:global',
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:packet-resend:actor:' || p_host_user_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:packet-resend:room:' || p_room_id::text,
      0
    )
  );

  select admission.*
  into v_existing
  from private.packet_resend_admissions admission
  where admission.send_request_id = p_send_request_id;

  if found then
    if v_existing.room_id <> p_room_id
       or v_existing.actor_user_id <> p_host_user_id
       or v_existing.room_mode <> 'standard'
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_resend_admission_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'allowed', true,
      'reason', 'admitted',
      'changed', false
    );
  end if;

  select request.*
  into v_request
  from public.packet_send_requests request
  where request.room_id = p_room_id
    and request.id = p_send_request_id
    and request.requested_by_user_id = p_host_user_id
  for update;

  if not found
     or v_request.status <> 'awaiting_human_approval'
     or v_request.expires_at <= v_now
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_request_not_found';
  end if;

  select packet.*
  into v_packet
  from public.meeting_packets packet
  where packet.room_id = p_room_id
    and packet.id = v_request.packet_id
  for update;

  if not found
     or v_packet.status <> 'approved'
     or v_packet.packet_version <> v_request.packet_version
     or v_packet.approved_content_snapshot <> v_request.content_snapshot
     or v_packet.approved_content_hash <> v_request.packet_content_hash
     or v_packet.recipient_snapshot <> v_request.recipient_snapshot
     or v_packet.recipient_snapshot_hash <> v_request.recipient_snapshot_hash
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_stale';
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.packet_resend_admissions admission
  where admission.actor_user_id = p_host_user_id
    and admission.admitted_at >= v_now - interval '1 hour';
  if v_count >= 5 then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'packet_resend_rate_limited',
      'changed', false
    );
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.packet_resend_admissions admission
  where admission.room_id = p_room_id
    and admission.admitted_at >= v_day_start;
  if v_count >= 20 then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'packet_resend_rate_limited',
      'changed', false
    );
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.packet_resend_admissions admission
  where admission.admitted_at >= v_now - interval '1 hour';
  if v_count >= 50 then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'packet_resend_rate_limited',
      'changed', false
    );
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.packet_resend_admissions admission
  where admission.admitted_at >= v_day_start;
  if v_count >= 200 then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'packet_resend_rate_limited',
      'changed', false
    );
  end if;

  insert into private.packet_resend_admissions (
    send_request_id,
    room_id,
    actor_user_id,
    room_mode,
    admitted_at
  ) values (
    p_send_request_id,
    p_room_id,
    p_host_user_id,
    v_room_mode,
    v_now
  )
  on conflict (send_request_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select admission.*
    into strict v_existing
    from private.packet_resend_admissions admission
    where admission.send_request_id = p_send_request_id;
    if v_existing.room_id <> p_room_id
       or v_existing.actor_user_id <> p_host_user_id
       or v_existing.room_mode <> 'standard'
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_resend_admission_conflict';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'reason', 'admitted',
    'changed', v_inserted = 1
  );
end;
$$;

revoke all on function public.reserve_packet_resend_admission(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.reserve_packet_resend_admission(
  uuid, uuid, uuid
) to service_role;

-- A verified event can reach Vercel before the provider response is recorded.
-- Keep that exact event replayable, and only call a non-unmatched result final.
create or replace function public.apply_resend_delivery_event(
  p_provider_event_id text,
  p_event_type text,
  p_provider_message_id text,
  p_occurred_at timestamptz,
  p_payload_sha256 text,
  p_delivery_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_event private.resend_webhook_events%rowtype;
  v_invitation_count integer;
  v_packet_count integer;
  v_invitation private.room_email_invitations%rowtype;
  v_share public.outbound_shares%rowtype;
  v_request public.packet_send_requests%rowtype;
  v_processing_result text;
  v_changed boolean := false;
  v_error_code text;
  v_action text;
  v_description text;
begin
  if p_provider_event_id is null
     or pg_catalog.char_length(p_provider_event_id) not between 1 and 256
     or p_event_type is null
     or pg_catalog.char_length(p_event_type) not between 1 and 80
     or p_event_type !~ '^[a-z][a-z0-9_.-]*$'
     or p_provider_message_id is null
     or pg_catalog.char_length(p_provider_message_id) not between 1 and 256
     or p_occurred_at is null
     or p_payload_sha256 is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or (
       p_delivery_status is not null
       and p_delivery_status not in (
         'submitted',
         'delivered',
         'bounced',
         'complained',
         'failed',
         'suppressed'
       )
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'resend_delivery_event_invalid';
  end if;

  insert into private.resend_webhook_events (
    provider_event_id,
    provider_event_type,
    provider_message_id,
    provider_occurred_at,
    payload_sha256,
    processing_result
  ) values (
    p_provider_event_id,
    p_event_type,
    p_provider_message_id,
    p_occurred_at,
    pg_catalog.decode(p_payload_sha256, 'hex'),
    'processing'
  )
  on conflict (provider_event_id) do nothing;

  get diagnostics v_inserted = row_count;

  select event_row.*
  into strict v_event
  from private.resend_webhook_events event_row
  where event_row.provider_event_id = p_provider_event_id
  for update;

  if v_event.provider_event_type is distinct from p_event_type
     or v_event.provider_message_id is distinct from p_provider_message_id
     or v_event.provider_occurred_at is distinct from p_occurred_at
     or v_event.payload_sha256 is distinct from pg_catalog.decode(p_payload_sha256, 'hex')
  then
    raise exception using
      errcode = 'P0001',
      message = 'resend_delivery_event_conflict';
  end if;

  if v_inserted = 0 and v_event.processing_result <> 'unmatched' then
    return pg_catalog.jsonb_build_object(
      'processingResult', 'duplicate',
      'target', coalesce(v_event.target_type, 'none'),
      'deliveryStatus', p_delivery_status,
      'changed', false
    );
  end if;

  if p_delivery_status is null then
    update private.resend_webhook_events event_row
    set
      processing_result = 'ignored',
      target_type = null,
      target_id = null,
      error_code = null
    where event_row.provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object(
      'processingResult', 'ignored',
      'target', 'none',
      'deliveryStatus', null,
      'changed', false
    );
  end if;

  select pg_catalog.count(*)
  into v_invitation_count
  from private.room_email_invitations invitation
  where invitation.provider_message_id = p_provider_message_id;

  select pg_catalog.count(*)
  into v_packet_count
  from public.outbound_shares share
  where share.provider = 'resend'
    and share.provider_message_id = p_provider_message_id;

  if v_invitation_count + v_packet_count = 0 then
    if v_event.received_at <= pg_catalog.clock_timestamp() - interval '15 minutes' then
      update private.resend_webhook_events event_row
      set
        processing_result = 'ignored',
        target_type = null,
        target_id = null,
        error_code = 'resend_provider_match_timeout'
      where event_row.provider_event_id = p_provider_event_id;
      return pg_catalog.jsonb_build_object(
        'processingResult', 'ignored',
        'target', 'none',
        'deliveryStatus', p_delivery_status,
        'changed', false
      );
    end if;

    update private.resend_webhook_events event_row
    set
      processing_result = 'unmatched',
      target_type = null,
      target_id = null,
      error_code = null
    where event_row.provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object(
      'processingResult', 'unmatched',
      'target', 'none',
      'deliveryStatus', p_delivery_status,
      'changed', false
    );
  end if;

  if v_invitation_count + v_packet_count <> 1 then
    update private.resend_webhook_events event_row
    set
      processing_result = 'ambiguous',
      target_type = null,
      target_id = null,
      error_code = 'resend_provider_match_ambiguous'
    where event_row.provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object(
      'processingResult', 'ambiguous',
      'target', 'none',
      'deliveryStatus', p_delivery_status,
      'changed', false
    );
  end if;

  if v_invitation_count = 1 then
    select invitation.*
    into strict v_invitation
    from private.room_email_invitations invitation
    where invitation.provider_message_id = p_provider_message_id
    for update;

    if v_invitation.last_provider_event_at is not null
       and p_occurred_at <= v_invitation.last_provider_event_at
    then
      v_processing_result := 'stale';
    elsif v_invitation.delivery_status in ('bounced', 'complained', 'failed', 'suppressed')
          and p_delivery_status not in ('bounced', 'complained', 'failed', 'suppressed')
    then
      v_processing_result := 'stale';
    elsif p_delivery_status = 'submitted'
          and v_invitation.delivery_status not in ('created', 'sending', 'reconciling', 'submitted')
    then
      v_processing_result := 'stale';
    elsif p_delivery_status = 'delivered'
          and v_invitation.delivery_status in ('bounced', 'complained', 'failed', 'suppressed')
    then
      v_processing_result := 'stale';
    elsif v_invitation.delivery_status = p_delivery_status then
      update private.room_email_invitations invitation
      set
        last_provider_event_at = p_occurred_at,
        delivery_updated_at = pg_catalog.clock_timestamp()
      where invitation.id = v_invitation.id;
      v_processing_result := 'stale';
    else
      v_error_code := case p_delivery_status
        when 'bounced' then 'resend_bounced'
        when 'complained' then 'resend_complained'
        when 'failed' then 'resend_failed'
        when 'suppressed' then 'resend_suppressed'
        else null
      end;
      update private.room_email_invitations invitation
      set
        delivery_status = p_delivery_status,
        delivery_error_code = v_error_code,
        submitted_at = case
          when p_delivery_status in ('submitted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed')
            then coalesce(invitation.submitted_at, p_occurred_at)
          else invitation.submitted_at
        end,
        last_provider_event_at = p_occurred_at,
        delivery_updated_at = pg_catalog.clock_timestamp()
      where invitation.id = v_invitation.id;
      v_processing_result := 'applied';
      v_changed := true;
    end if;

    update private.resend_webhook_events event_row
    set
      processing_result = v_processing_result,
      target_type = 'invitation',
      target_id = v_invitation.id::text,
      error_code = null
    where event_row.provider_event_id = p_provider_event_id;

    return pg_catalog.jsonb_build_object(
      'processingResult', v_processing_result,
      'target', 'invitation',
      'deliveryStatus', p_delivery_status,
      'changed', v_changed
    );
  end if;

  -- Every packet delivery path locks the durable request before its share.
  select request.*
  into strict v_request
  from public.packet_send_requests request
  join public.outbound_shares share
    on share.room_id = request.room_id
   and share.send_request_id = request.id
  where share.provider = 'resend'
    and share.provider_message_id = p_provider_message_id
  for update of request;

  select share.*
  into strict v_share
  from public.outbound_shares share
  where share.room_id = v_request.room_id
    and share.send_request_id = v_request.id
    and share.provider = 'resend'
    and share.provider_message_id = p_provider_message_id
  for update;

  if v_share.last_provider_event_at is not null
     and p_occurred_at <= v_share.last_provider_event_at
  then
    v_processing_result := 'stale';
  elsif v_share.status in ('bounced', 'complained', 'failed', 'suppressed')
        and p_delivery_status not in ('bounced', 'complained', 'failed', 'suppressed')
  then
    v_processing_result := 'stale';
  elsif p_delivery_status = 'submitted'
        and v_share.status not in ('pending', 'reconciling', 'submitted')
  then
    v_processing_result := 'stale';
  elsif p_delivery_status = 'delivered'
        and v_share.status in ('bounced', 'complained', 'failed', 'suppressed')
  then
    v_processing_result := 'stale';
  elsif v_share.status = p_delivery_status then
    update public.outbound_shares share
    set last_provider_event_at = p_occurred_at
    where share.id = v_share.id;
    v_processing_result := 'stale';
  else
    v_error_code := case p_delivery_status
      when 'bounced' then 'resend_bounced'
      when 'complained' then 'resend_complained'
      when 'failed' then 'resend_failed'
      when 'suppressed' then 'resend_suppressed'
      else null
    end;
    update public.outbound_shares share
    set
      status = p_delivery_status,
      error_code = v_error_code,
      completed_at = case
        when p_delivery_status = 'submitted'
          then coalesce(share.completed_at, p_occurred_at)
        else p_occurred_at
      end,
      last_provider_event_at = p_occurred_at
    where share.id = v_share.id;

    if v_request.status in ('sending', 'reconciling') then
      update public.packet_send_requests request
      set
        status = 'submitted',
        completed_at = coalesce(request.completed_at, p_occurred_at),
        last_error_code = null
      where request.id = v_request.id;
    end if;

    v_processing_result := 'applied';
    v_changed := true;

    if p_delivery_status in ('delivered', 'bounced', 'complained', 'failed', 'suppressed') then
      v_action := case p_delivery_status
        when 'delivered' then 'packet_email_delivered'
        when 'bounced' then 'packet_email_bounced'
        when 'complained' then 'packet_email_complained'
        when 'failed' then 'packet_email_failed'
        when 'suppressed' then 'packet_email_suppressed'
      end;
      v_description := case p_delivery_status
        when 'delivered' then 'Resend confirmed packet delivery.'
        when 'bounced' then 'Resend reported that the packet email bounced.'
        when 'complained' then 'Resend reported a spam complaint for the packet email.'
        when 'failed' then 'Resend reported a terminal packet delivery failure.'
        when 'suppressed' then 'Resend reported that the packet email was suppressed.'
      end;
      perform private.append_packet_activity(
        v_share.room_id,
        null,
        'system',
        'Resend',
        v_action,
        v_share.packet_id,
        v_share.send_request_id,
        pg_catalog.jsonb_build_object(
          'status', p_delivery_status,
          'provider', 'resend',
          'providerMessageId', p_provider_message_id,
          'providerEventId', p_provider_event_id
        ),
        v_description
      );
    end if;
  end if;

  update private.resend_webhook_events event_row
  set
    processing_result = v_processing_result,
    target_type = 'packet',
    target_id = v_share.id::text,
    error_code = null
  where event_row.provider_event_id = p_provider_event_id;

  return pg_catalog.jsonb_build_object(
    'processingResult', v_processing_result,
    'target', 'packet',
    'deliveryStatus', p_delivery_status,
    'changed', v_changed
  );
end;
$$;

revoke all on function public.apply_resend_delivery_event(
  text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.apply_resend_delivery_event(
  text, text, text, timestamptz, text, text
) to service_role;

-- Retain the existing completion contract while documenting and enforcing the
-- same request-then-share row lock order as provider webhook reconciliation.
create or replace function public.complete_meeting_packet_send(
  p_room_id uuid,
  p_send_request_id uuid,
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
  v_host_display_name text;
  v_request public.packet_send_requests%rowtype;
  v_share public.outbound_shares%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_error_code text := nullif(pg_catalog.btrim(p_error_code), '');
  v_changed boolean := true;
begin
  v_host_display_name := private.assert_packet_host(p_room_id, p_host_user_id);

  if p_outcome not in ('submitted', 'reconciling', 'failed')
     or (p_outcome = 'submitted' and (v_provider_message_id is null or v_error_code is not null))
     or (p_outcome = 'reconciling' and v_error_code is null)
     or (p_outcome = 'failed' and (v_provider_message_id is not null or v_error_code is null))
     or (v_provider_message_id is not null and pg_catalog.char_length(v_provider_message_id) > 240)
     or (v_error_code is not null and (
       pg_catalog.char_length(v_error_code) > 120
       or v_error_code !~ '^[a-z][a-z0-9_]*$'
     ))
  then
    raise exception using errcode = 'P0001', message = 'packet_send_completion_invalid';
  end if;

  select request.*
  into v_request
  from public.packet_send_requests request
  where request.room_id = p_room_id
    and request.id = p_send_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'packet_send_request_not_found';
  end if;

  select share.*
  into v_share
  from public.outbound_shares share
  where share.room_id = p_room_id
    and share.send_request_id = p_send_request_id
  for update;

  if not found or v_share.provider <> 'resend' then
    raise exception using errcode = 'P0001', message = 'packet_send_reservation_not_found';
  end if;

  if v_request.status in ('submitted', 'failed') then
    if v_request.status <> p_outcome
       or v_share.status <> p_outcome
       or v_share.provider_message_id is distinct from v_provider_message_id
       or v_share.error_code is distinct from v_error_code
       or v_request.last_error_code is distinct from v_error_code
    then
      raise exception using errcode = 'P0001', message = 'packet_send_completion_conflict';
    end if;
    v_changed := false;
  elsif v_request.status = 'reconciling' and p_outcome = 'reconciling' then
    if v_share.status <> 'reconciling'
       or v_share.provider_message_id is distinct from v_provider_message_id
       or v_share.error_code is distinct from v_error_code
       or v_request.last_error_code is distinct from v_error_code
    then
      raise exception using errcode = 'P0001', message = 'packet_send_completion_conflict';
    end if;
    v_changed := false;
  elsif v_request.status not in ('sending', 'reconciling')
        or v_share.status not in ('pending', 'reconciling')
  then
    raise exception using errcode = 'P0001', message = 'packet_send_completion_conflict';
  end if;

  if v_changed then
    if v_share.provider_message_id is not null
       and v_provider_message_id is distinct from v_share.provider_message_id
    then
      raise exception using errcode = 'P0001', message = 'packet_send_completion_conflict';
    end if;

    update public.outbound_shares share
    set
      status = p_outcome,
      provider_message_id = coalesce(v_provider_message_id, share.provider_message_id),
      completed_at = case
        when p_outcome in ('submitted', 'failed') then v_now
        else null
      end,
      error_code = v_error_code
    where share.id = v_share.id;

    update public.packet_send_requests request
    set
      status = p_outcome,
      completed_at = case
        when p_outcome in ('submitted', 'failed') then v_now
        else null
      end,
      last_error_code = v_error_code
    where request.room_id = p_room_id
      and request.id = p_send_request_id;

    perform private.append_packet_activity(
      p_room_id,
      null,
      'system',
      v_host_display_name,
      case p_outcome
        when 'submitted' then 'packet_send_submitted'
        when 'reconciling' then 'packet_send_reconciling'
        else 'packet_send_failed'
      end,
      v_request.packet_id,
      p_send_request_id,
      pg_catalog.jsonb_build_object(
        'status', p_outcome,
        'provider', 'resend',
        'providerMessageId', v_provider_message_id,
        'errorCode', v_error_code
      ),
      case p_outcome
        when 'submitted' then 'Resend accepted the packet; delivery is pending.'
        when 'reconciling' then 'The packet submission result is being reconciled.'
        else 'Resend did not accept the packet.'
      end
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'sendRequestId', p_send_request_id,
    'outboundShareId', v_share.id,
    'status', p_outcome,
    'provider', 'resend',
    'providerMessageId', coalesce(v_provider_message_id, v_share.provider_message_id),
    'changed', v_changed
  );
end;
$$;

revoke all on function public.complete_meeting_packet_send(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_meeting_packet_send(
  uuid, uuid, uuid, text, text, text
) to service_role;

commit;
