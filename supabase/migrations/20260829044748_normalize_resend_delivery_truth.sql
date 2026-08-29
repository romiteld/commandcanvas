begin;

alter table public.packet_send_requests
  drop constraint if exists packet_send_requests_status_check,
  drop constraint if exists packet_send_requests_lifecycle_valid;

alter table public.outbound_shares
  drop constraint if exists outbound_shares_status_check;

update public.packet_send_requests
set status = 'submitted'
where status = 'sent';

update public.outbound_shares
set status = 'submitted'
where status = 'sent';

-- The historical lifecycle constraint allowed cancelled/expired rows without a
-- completion timestamp. Normalize those rows before tightening the forward
-- invariant so the migration remains safe for already-used rooms.
update public.packet_send_requests
set completed_at = coalesce(
  completed_at,
  authorized_at,
  requested_at,
  pg_catalog.clock_timestamp()
)
where status in ('cancelled', 'expired')
  and completed_at is null;

alter table public.packet_send_requests
  add constraint packet_send_requests_status_check
  check (
    status in (
      'awaiting_human_approval',
      'sending',
      'reconciling',
      'submitted',
      'cancelled',
      'failed',
      'preview_only',
      'expired'
    )
  ),
  add constraint packet_send_requests_lifecycle_valid
  check (
    (
      status = 'awaiting_human_approval'
      and authorized_by_user_id is null
      and authorized_at is null
      and completed_at is null
      and last_error_code is null
    )
    or (
      status = 'sending'
      and authorized_by_user_id is not null
      and authorized_at is not null
      and completed_at is null
      and last_error_code is null
    )
    or (
      status = 'reconciling'
      and authorized_by_user_id is not null
      and authorized_at is not null
      and completed_at is null
      and last_error_code is not null
    )
    or (
      status in ('submitted', 'preview_only')
      and authorized_by_user_id is not null
      and authorized_at is not null
      and completed_at is not null
      and last_error_code is null
    )
    or (
      status = 'failed'
      and authorized_by_user_id is not null
      and authorized_at is not null
      and completed_at is not null
      and last_error_code is not null
    )
    or (
      status in ('cancelled', 'expired')
      and completed_at is not null
    )
  );

alter table public.outbound_shares
  add column last_provider_event_at timestamptz,
  add constraint outbound_shares_status_check
  check (
    status in (
      'pending',
      'reconciling',
      'submitted',
      'delivered',
      'bounced',
      'complained',
      'failed',
      'suppressed',
      'preview_only'
    )
  );

create table private.resend_webhook_events (
  provider_event_id text primary key
    check (pg_catalog.char_length(provider_event_id) between 1 and 256),
  provider_event_type text not null
    check (
      pg_catalog.char_length(provider_event_type) between 1 and 80
      and provider_event_type ~ '^[a-z][a-z0-9_.-]*$'
    ),
  provider_message_id text not null
    check (pg_catalog.char_length(provider_message_id) between 1 and 256),
  provider_occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  payload_sha256 bytea not null
    check (pg_catalog.octet_length(payload_sha256) = 32),
  processing_result text not null
    check (
      processing_result in (
        'processing',
        'applied',
        'duplicate',
        'stale',
        'unmatched',
        'ambiguous',
        'ignored'
      )
    ),
  target_type text
    check (target_type is null or target_type in ('invitation', 'packet')),
  target_id text,
  error_code text
    check (
      error_code is null
      or (
        pg_catalog.char_length(error_code) between 1 and 120
        and error_code ~ '^[a-z][a-z0-9_]*$'
      )
    )
);

create index resend_webhook_events_message_time_idx
  on private.resend_webhook_events(
    provider_message_id,
    provider_occurred_at desc
  );

alter table private.resend_webhook_events enable row level security;

revoke all privileges on table private.resend_webhook_events
  from public, anon, authenticated, service_role;

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
    raise exception using errcode = 'P0001', message = 'resend_delivery_event_invalid';
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
  if v_inserted = 0 then
    return pg_catalog.jsonb_build_object(
      'processingResult', 'duplicate',
      'target', 'none',
      'deliveryStatus', p_delivery_status,
      'changed', false
    );
  end if;

  if p_delivery_status is null then
    update private.resend_webhook_events event_row
    set processing_result = 'ignored'
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
    update private.resend_webhook_events event_row
    set processing_result = 'unmatched'
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
      set last_provider_event_at = p_occurred_at,
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
      target_id = v_invitation.id::text
    where event_row.provider_event_id = p_provider_event_id;

    return pg_catalog.jsonb_build_object(
      'processingResult', v_processing_result,
      'target', 'invitation',
      'deliveryStatus', p_delivery_status,
      'changed', v_changed
    );
  end if;

  select share.*
  into strict v_share
  from public.outbound_shares share
  where share.provider = 'resend'
    and share.provider_message_id = p_provider_message_id
  for update;

  select request.*
  into strict v_request
  from public.packet_send_requests request
  where request.room_id = v_share.room_id
    and request.id = v_share.send_request_id
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
    target_id = v_share.id::text
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

create or replace function public.stage_meeting_packet_send(
  p_room_id uuid,
  p_packet_id text,
  p_host_user_id uuid,
  p_requested_by_actor_type text,
  p_send_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_host_display_name text;
  v_packet public.meeting_packets%rowtype;
  v_existing public.packet_send_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_restartable_terminal_count bigint;
begin
  v_host_display_name := private.assert_packet_host(p_room_id, p_host_user_id);

  if p_requested_by_actor_type not in ('human', 'agent')
     or p_send_request_id is null
  then
    raise exception using errcode = 'P0001', message = 'packet_actor_type_invalid';
  end if;

  select packet.*
  into v_packet
  from public.meeting_packets packet
  where packet.room_id = p_room_id
    and packet.id = p_packet_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'packet_not_found';
  end if;

  if v_packet.status <> 'approved'
     or v_packet.approved_content_snapshot is null
     or v_packet.approved_content_hash is null
     or v_packet.recipient_snapshot is null
     or v_packet.recipient_snapshot_hash is null
  then
    raise exception using errcode = 'P0001', message = 'packet_approval_required';
  end if;

  select request.*
  into v_existing
  from public.packet_send_requests request
  where request.id = p_send_request_id;

  if found then
    if v_existing.room_id = p_room_id
       and v_existing.packet_id = p_packet_id
       and v_existing.packet_version = v_packet.packet_version
       and v_existing.content_snapshot = v_packet.approved_content_snapshot
       and v_existing.packet_content_hash = v_packet.approved_content_hash
       and v_existing.recipient_snapshot = v_packet.recipient_snapshot
       and v_existing.recipient_snapshot_hash = v_packet.recipient_snapshot_hash
       and v_existing.requested_by_user_id = p_host_user_id
       and v_existing.status = 'awaiting_human_approval'
    then
      return pg_catalog.jsonb_build_object(
        'sendRequestId', v_existing.id,
        'packetId', p_packet_id,
        'status', v_existing.status,
        'idempotencyKey', v_existing.idempotency_key,
        'packetVersion', v_existing.packet_version,
        'contentHash', v_existing.packet_content_hash,
        'recipientHash', v_existing.recipient_snapshot_hash,
        'recipientSnapshot', v_existing.recipient_snapshot,
        'recipientCount', pg_catalog.jsonb_array_length(v_existing.recipient_snapshot),
        'staged', true,
        'changed', false
      );
    end if;
    raise exception using errcode = 'P0001', message = 'packet_send_stage_conflict';
  end if;

  if exists (
    select 1
    from public.packet_send_requests request
    where request.room_id = p_room_id
      and request.packet_id = p_packet_id
      and request.packet_version = v_packet.packet_version
      and request.content_snapshot = v_packet.approved_content_snapshot
      and request.packet_content_hash = v_packet.approved_content_hash
      and request.recipient_snapshot = v_packet.recipient_snapshot
      and request.recipient_snapshot_hash = v_packet.recipient_snapshot_hash
      and request.status = 'submitted'
  ) then
    raise exception using errcode = 'P0001', message = 'packet_send_new_approval_required';
  end if;

  if exists (
    select 1
    from public.packet_send_requests request
    where request.room_id = p_room_id
      and request.packet_id = p_packet_id
      and request.packet_version = v_packet.packet_version
      and request.content_snapshot = v_packet.approved_content_snapshot
      and request.packet_content_hash = v_packet.approved_content_hash
      and request.recipient_snapshot = v_packet.recipient_snapshot
      and request.recipient_snapshot_hash = v_packet.recipient_snapshot_hash
      and request.status in ('sending', 'reconciling')
  ) then
    raise exception using errcode = 'P0001', message = 'packet_send_already_authorized';
  end if;

  select request.*
  into v_existing
  from public.packet_send_requests request
  where request.room_id = p_room_id
    and request.packet_id = p_packet_id
    and request.packet_version = v_packet.packet_version
    and request.content_snapshot = v_packet.approved_content_snapshot
    and request.packet_content_hash = v_packet.approved_content_hash
    and request.recipient_snapshot = v_packet.recipient_snapshot
    and request.recipient_snapshot_hash = v_packet.recipient_snapshot_hash
    and request.requested_by_user_id = p_host_user_id
    and request.status = 'awaiting_human_approval'
  order by request.requested_at desc, request.id desc
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'sendRequestId', v_existing.id,
      'packetId', p_packet_id,
      'status', v_existing.status,
      'idempotencyKey', v_existing.idempotency_key,
      'packetVersion', v_existing.packet_version,
      'contentHash', v_existing.packet_content_hash,
      'recipientHash', v_existing.recipient_snapshot_hash,
      'recipientSnapshot', v_existing.recipient_snapshot,
      'recipientCount', pg_catalog.jsonb_array_length(v_existing.recipient_snapshot),
      'staged', true,
      'changed', false
    );
  end if;

  select pg_catalog.count(*)
  into v_restartable_terminal_count
  from public.packet_send_requests request
  where request.room_id = p_room_id
    and request.packet_id = p_packet_id
    and request.packet_version = v_packet.packet_version
    and request.content_snapshot = v_packet.approved_content_snapshot
    and request.packet_content_hash = v_packet.approved_content_hash
    and request.recipient_snapshot = v_packet.recipient_snapshot
    and request.recipient_snapshot_hash = v_packet.recipient_snapshot_hash
    and request.status in ('cancelled', 'failed', 'preview_only', 'expired');

  insert into public.packet_send_requests (
    id,
    room_id,
    packet_id,
    packet_version,
    content_snapshot,
    packet_content_hash,
    recipient_snapshot,
    recipient_snapshot_hash,
    status,
    requested_by_user_id,
    requested_by_actor_type,
    requested_at,
    expires_at,
    idempotency_key
  ) values (
    p_send_request_id,
    p_room_id,
    p_packet_id,
    v_packet.packet_version,
    v_packet.approved_content_snapshot,
    v_packet.approved_content_hash,
    v_packet.recipient_snapshot,
    v_packet.recipient_snapshot_hash,
    'awaiting_human_approval',
    p_host_user_id,
    p_requested_by_actor_type,
    v_now,
    v_now + interval '15 minutes',
    'commandcanvas:packet-send:' || p_send_request_id::text
  );

  select request.*
  into strict v_existing
  from public.packet_send_requests request
  where request.id = p_send_request_id;

  perform private.append_packet_activity(
    p_room_id,
    p_host_user_id,
    p_requested_by_actor_type,
    v_host_display_name,
    'packet_send_staged',
    p_packet_id,
    v_existing.id,
    pg_catalog.jsonb_build_object(
      'status', 'awaiting_human_approval',
      'packetVersion', v_packet.packet_version,
      'recipientCount', pg_catalog.jsonb_array_length(v_packet.recipient_snapshot),
      'priorTerminalAttemptCount', v_restartable_terminal_count
    ),
    case p_requested_by_actor_type
      when 'agent' then 'ChatGPT requested approval to send the packet.'
      else v_host_display_name || ' staged the packet for approval.'
    end
  );

  return pg_catalog.jsonb_build_object(
    'sendRequestId', v_existing.id,
    'packetId', p_packet_id,
    'status', v_existing.status,
    'idempotencyKey', v_existing.idempotency_key,
    'packetVersion', v_existing.packet_version,
    'contentHash', v_existing.packet_content_hash,
    'recipientHash', v_existing.recipient_snapshot_hash,
    'recipientSnapshot', v_existing.recipient_snapshot,
    'recipientCount', pg_catalog.jsonb_array_length(v_existing.recipient_snapshot),
    'staged', true,
    'changed', true
  );
end;
$$;

create or replace function public.authorize_meeting_packet_send(
  p_room_id uuid,
  p_send_request_id uuid,
  p_host_user_id uuid,
  p_delivery_mode text,
  p_outbound_share_id uuid
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
  v_packet public.meeting_packets%rowtype;
  v_share public.outbound_shares%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_status text;
  v_share_status text;
begin
  v_host_display_name := private.assert_packet_host(p_room_id, p_host_user_id);

  if p_delivery_mode not in ('preview', 'resend') then
    raise exception using errcode = 'P0001', message = 'packet_delivery_mode_invalid';
  end if;
  if p_outbound_share_id is null then
    raise exception using errcode = 'P0001', message = 'packet_outbound_share_id_required';
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

  if v_request.status = 'expired' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', coalesce(v_request.last_error_code, 'packet_send_request_expired'),
      'sendRequestId', v_request.id,
      'status', 'expired',
      'changed', false
    );
  end if;

  if v_request.status in (
    'sending', 'reconciling', 'submitted', 'failed', 'preview_only'
  ) then
    select share.*
    into strict v_share
    from public.outbound_shares share
    where share.room_id = p_room_id
      and share.send_request_id = p_send_request_id;

    if v_share.provider <> p_delivery_mode
       or v_share.id <> p_outbound_share_id
    then
      raise exception using errcode = 'P0001', message = 'packet_send_authorization_conflict';
    end if;

    return pg_catalog.jsonb_build_object(
      'sendRequestId', p_send_request_id,
      'outboundShareId', v_share.id,
      'provider', v_share.provider,
      'status', v_request.status,
      'subject', v_share.subject,
      'contentSnapshot', v_request.content_snapshot,
      'recipientSnapshot', v_request.recipient_snapshot,
      'idempotencyKey', v_request.idempotency_key,
      'providerMessageId', v_share.provider_message_id,
      'changed', false
    );
  end if;

  if v_request.status <> 'awaiting_human_approval' then
    raise exception using errcode = 'P0001', message = 'packet_send_request_expired';
  end if;

  if v_request.expires_at <= v_now then
    update public.packet_send_requests request
    set
      status = 'expired',
      completed_at = v_now,
      last_error_code = 'packet_send_request_expired'
    where request.room_id = p_room_id
      and request.id = v_request.id;

    perform private.append_packet_activity(
      p_room_id,
      p_host_user_id,
      'human',
      v_host_display_name,
      'packet_send_expired',
      v_request.packet_id,
      v_request.id,
      pg_catalog.jsonb_build_object(
        'status', 'expired',
        'code', 'packet_send_request_expired'
      ),
      'The staged packet send expired before host authorization.'
    );

    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'packet_send_request_expired',
      'sendRequestId', v_request.id,
      'status', 'expired',
      'changed', true
    );
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
    update public.packet_send_requests request
    set
      status = 'expired',
      completed_at = v_now,
      last_error_code = 'packet_send_stale'
    where request.room_id = p_room_id
      and request.id = v_request.id;

    perform private.append_packet_activity(
      p_room_id,
      p_host_user_id,
      'human',
      v_host_display_name,
      'packet_send_expired',
      v_request.packet_id,
      v_request.id,
      pg_catalog.jsonb_build_object(
        'status', 'expired',
        'code', 'packet_send_stale'
      ),
      'The staged packet no longer matches the approved snapshot.'
    );

    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'packet_send_stale',
      'sendRequestId', v_request.id,
      'status', 'expired',
      'changed', true
    );
  end if;

  v_request_status := case p_delivery_mode
    when 'preview' then 'preview_only'
    else 'sending'
  end;
  v_share_status := case p_delivery_mode
    when 'preview' then 'preview_only'
    else 'pending'
  end;

  insert into public.outbound_shares (
    id,
    room_id,
    packet_id,
    send_request_id,
    provider,
    status,
    recipient_snapshot,
    subject,
    content_hash,
    completed_at
  ) values (
    p_outbound_share_id,
    p_room_id,
    v_request.packet_id,
    p_send_request_id,
    p_delivery_mode,
    v_share_status,
    v_request.recipient_snapshot,
    v_request.content_snapshot ->> 'title',
    v_request.packet_content_hash,
    case p_delivery_mode when 'preview' then v_now else null end
  );

  update public.packet_send_requests request
  set
    status = v_request_status,
    authorized_by_user_id = p_host_user_id,
    authorized_at = v_now,
    completed_at = case p_delivery_mode when 'preview' then v_now else null end,
    last_error_code = null
  where request.room_id = p_room_id
    and request.id = p_send_request_id;

  perform private.append_packet_activity(
    p_room_id,
    p_host_user_id,
    'human',
    v_host_display_name,
    case p_delivery_mode
      when 'preview' then 'packet_send_previewed'
      else 'packet_send_authorized'
    end,
    v_request.packet_id,
    p_send_request_id,
    pg_catalog.jsonb_build_object(
      'status', v_request_status,
      'provider', p_delivery_mode,
      'recipientCount', pg_catalog.jsonb_array_length(v_request.recipient_snapshot)
    ),
    case p_delivery_mode
      when 'preview' then v_host_display_name || ' opened the honest email preview.'
      else v_host_display_name || ' authorized submission to Resend.'
    end
  );

  return pg_catalog.jsonb_build_object(
    'sendRequestId', p_send_request_id,
    'outboundShareId', p_outbound_share_id,
    'provider', p_delivery_mode,
    'status', v_request_status,
    'subject', v_request.content_snapshot ->> 'title',
    'contentSnapshot', v_request.content_snapshot,
    'recipientSnapshot', v_request.recipient_snapshot,
    'idempotencyKey', v_request.idempotency_key,
    'providerMessageId', null,
    'changed', true
  );
end;
$$;

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

revoke all on function public.stage_meeting_packet_send(
  uuid, text, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.stage_meeting_packet_send(
  uuid, text, uuid, text, uuid
) to service_role;

revoke all on function public.authorize_meeting_packet_send(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.authorize_meeting_packet_send(
  uuid, uuid, uuid, text, uuid
) to service_role;

revoke all on function public.complete_meeting_packet_send(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_meeting_packet_send(
  uuid, uuid, uuid, text, text, text
) to service_role;

commit;
