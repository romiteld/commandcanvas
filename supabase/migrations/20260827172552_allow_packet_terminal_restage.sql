begin;

-- A send request is one durable approval attempt. Cancellation, preview-only,
-- failure, and expiry finish that attempt without consuming the approved packet
-- snapshot forever. An awaiting request remains idempotent, while an actually
-- submitted snapshot requires a changed and reapproved packet before another
-- send can be staged.
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
  v_idempotency_key text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_restartable_terminal_count bigint;
begin
  v_host_display_name := private.assert_packet_host(
    p_room_id,
    p_host_user_id
  );

  if p_requested_by_actor_type not in ('human', 'agent') then
    raise exception using
      errcode = 'P0001',
      message = 'packet_actor_type_invalid';
  end if;

  if p_send_request_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_request_id_required';
  end if;

  select packet.*
  into v_packet
  from public.meeting_packets packet
  where packet.room_id = p_room_id
    and packet.id = p_packet_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'packet_not_found';
  end if;

  if v_packet.status <> 'approved'
     or v_packet.approved_content_snapshot is null
     or v_packet.approved_content_hash is null
     or v_packet.recipient_snapshot is null
     or v_packet.recipient_snapshot_hash is null
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_approval_required';
  end if;

  -- Reusing one durable request UUID for any other attempt is never allowed.
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
        'status', 'awaiting_human_approval',
        'idempotencyKey', v_existing.idempotency_key,
        'packetVersion', v_existing.packet_version,
        'contentHash', v_existing.packet_content_hash,
        'recipientHash', v_existing.recipient_snapshot_hash,
        'recipientSnapshot', v_existing.recipient_snapshot,
        'recipientCount', pg_catalog.jsonb_array_length(
          v_existing.recipient_snapshot
        ),
        'staged', true,
        'changed', false
      );
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'packet_send_stage_conflict';
  end if;

  -- Any completed real submission of this exact approved snapshot is terminal.
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
      and request.status = 'sent'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_new_approval_required';
  end if;

  -- A provider attempt already in flight cannot be replaced by another stage.
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
      and request.status = 'sending'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_already_authorized';
  end if;

  -- Repeated staging while approval is still pending returns the one existing
  -- durable request even when the caller proposed a fresh UUID.
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
      'status', 'awaiting_human_approval',
      'idempotencyKey', v_existing.idempotency_key,
      'packetVersion', v_existing.packet_version,
      'contentHash', v_existing.packet_content_hash,
      'recipientHash', v_existing.recipient_snapshot_hash,
      'recipientSnapshot', v_existing.recipient_snapshot,
      'recipientCount', pg_catalog.jsonb_array_length(
        v_existing.recipient_snapshot
      ),
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

  -- This key follows the durable provider attempt, not the reusable packet
  -- snapshot. Exact retries of one attempt remain safe, and a genuinely new
  -- stage receives a new provider idempotency boundary.
  v_idempotency_key :=
    'commandcanvas:packet-send:' || p_send_request_id::text;

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
    v_idempotency_key
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
      'recipientCount', pg_catalog.jsonb_array_length(
        v_packet.recipient_snapshot
      ),
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
    'status', 'awaiting_human_approval',
    'idempotencyKey', v_idempotency_key,
    'packetVersion', v_existing.packet_version,
    'contentHash', v_existing.packet_content_hash,
    'recipientHash', v_existing.recipient_snapshot_hash,
    'recipientSnapshot', v_existing.recipient_snapshot,
    'recipientCount', pg_catalog.jsonb_array_length(
      v_existing.recipient_snapshot
    ),
    'staged', true,
    'changed', true
  );
end;
$$;

revoke execute on function public.stage_meeting_packet_send(
  uuid,
  text,
  uuid,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.stage_meeting_packet_send(
  uuid,
  text,
  uuid,
  text,
  uuid
) to service_role;

commit;
