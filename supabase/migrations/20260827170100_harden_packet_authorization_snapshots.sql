begin;

-- Preserve the already-applied mutation bodies as private implementation
-- functions. Public wrappers extend only their compact response contracts.
alter function public.prepare_meeting_packet_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  text[]
) rename to prepare_meeting_packet_draft_base;

alter function public.prepare_meeting_packet_draft_base(
  uuid,
  uuid,
  text,
  text,
  text,
  text[]
) set schema private;

revoke execute on function private.prepare_meeting_packet_draft_base(
  uuid,
  uuid,
  text,
  text,
  text,
  text[]
) from public, anon, authenticated, service_role;

create function public.prepare_meeting_packet_draft(
  p_room_id uuid,
  p_host_user_id uuid,
  p_packet_id text,
  p_actor_type text default 'agent',
  p_title text default null,
  p_selected_object_ids text[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_content_snapshot jsonb;
begin
  v_result := private.prepare_meeting_packet_draft_base(
    p_room_id,
    p_host_user_id,
    p_packet_id,
    p_actor_type,
    p_title,
    p_selected_object_ids
  );

  select pg_catalog.jsonb_build_object(
    'title', packet.title,
    'content', packet.content
  )
  into strict v_content_snapshot
  from public.meeting_packets packet
  where packet.room_id = p_room_id
    and packet.id = p_packet_id;

  return v_result || pg_catalog.jsonb_build_object(
    'contentSnapshot', v_content_snapshot
  );
end;
$$;

alter function public.approve_meeting_packet(
  uuid,
  text,
  uuid
) rename to approve_meeting_packet_base;

alter function public.approve_meeting_packet_base(
  uuid,
  text,
  uuid
) set schema private;

revoke execute on function private.approve_meeting_packet_base(
  uuid,
  text,
  uuid
) from public, anon, authenticated, service_role;

create function public.approve_meeting_packet(
  p_room_id uuid,
  p_packet_id text,
  p_host_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_packet public.meeting_packets%rowtype;
begin
  v_result := private.approve_meeting_packet_base(
    p_room_id,
    p_packet_id,
    p_host_user_id
  );

  select packet.*
  into strict v_packet
  from public.meeting_packets packet
  where packet.room_id = p_room_id
    and packet.id = p_packet_id;

  return v_result || pg_catalog.jsonb_build_object(
    'packetVersion', v_packet.packet_version,
    'contentSnapshot', v_packet.approved_content_snapshot,
    'recipientSnapshot', v_packet.recipient_snapshot
  );
end;
$$;

alter function public.stage_meeting_packet_send(
  uuid,
  text,
  uuid,
  text,
  uuid
) rename to stage_meeting_packet_send_base;

alter function public.stage_meeting_packet_send_base(
  uuid,
  text,
  uuid,
  text,
  uuid
) set schema private;

revoke execute on function private.stage_meeting_packet_send_base(
  uuid,
  text,
  uuid,
  text,
  uuid
) from public, anon, authenticated, service_role;

create function public.stage_meeting_packet_send(
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
  v_result jsonb;
  v_request public.packet_send_requests%rowtype;
begin
  v_result := private.stage_meeting_packet_send_base(
    p_room_id,
    p_packet_id,
    p_host_user_id,
    p_requested_by_actor_type,
    p_send_request_id
  );

  select request.*
  into strict v_request
  from public.packet_send_requests request
  where request.room_id = p_room_id
    and request.id = (v_result ->> 'sendRequestId')::uuid;

  return v_result || pg_catalog.jsonb_build_object(
    'packetVersion', v_request.packet_version,
    'contentHash', v_request.packet_content_hash,
    'recipientHash', v_request.recipient_snapshot_hash,
    'recipientSnapshot', v_request.recipient_snapshot
  );
end;
$$;

create function public.cancel_meeting_packet_send(
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
  v_host_display_name text;
  v_request public.packet_send_requests%rowtype;
  v_receipt_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_host_display_name := private.assert_packet_host(
    p_room_id,
    p_host_user_id
  );

  select request.*
  into v_request
  from public.packet_send_requests request
  where request.room_id = p_room_id
    and request.id = p_send_request_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_request_not_found';
  end if;

  if v_request.status = 'cancelled' then
    select receipt.id
    into v_receipt_id
    from public.packet_activity_receipts receipt
    where receipt.room_id = p_room_id
      and receipt.packet_id = v_request.packet_id
      and receipt.send_request_id = p_send_request_id
      and receipt.action = 'packet_send_cancelled'
    order by receipt.activity_revision desc
    limit 1;

    if v_receipt_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'packet_send_cancellation_receipt_missing';
    end if;

    return pg_catalog.jsonb_build_object(
      'sendRequestId', p_send_request_id,
      'packetId', v_request.packet_id,
      'status', 'cancelled',
      'receiptId', v_receipt_id,
      'changed', false
    );
  end if;

  if v_request.status <> 'awaiting_human_approval' then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_cancellation_unavailable';
  end if;

  update public.packet_send_requests
  set
    status = 'cancelled',
    completed_at = v_now,
    last_error_code = null
  where room_id = p_room_id
    and id = p_send_request_id;

  select receipt.id
  into strict v_receipt_id
  from private.append_packet_activity(
    p_room_id,
    p_host_user_id,
    'human',
    v_host_display_name,
    'packet_send_cancelled',
    v_request.packet_id,
    p_send_request_id,
    pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'packetVersion', v_request.packet_version,
      'contentHash', v_request.packet_content_hash,
      'recipientHash', v_request.recipient_snapshot_hash
    ),
    v_host_display_name || ' cancelled the staged packet send.'
  ) receipt;

  return pg_catalog.jsonb_build_object(
    'sendRequestId', p_send_request_id,
    'packetId', v_request.packet_id,
    'status', 'cancelled',
    'receiptId', v_receipt_id,
    'changed', true
  );
end;
$$;

revoke execute on function public.prepare_meeting_packet_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  text[]
) from public, anon, authenticated;
grant execute on function public.prepare_meeting_packet_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  text[]
) to service_role;

revoke execute on function public.approve_meeting_packet(
  uuid,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.approve_meeting_packet(
  uuid,
  text,
  uuid
) to service_role;

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

revoke execute on function public.cancel_meeting_packet_send(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.cancel_meeting_packet_send(
  uuid,
  uuid,
  uuid
) to service_role;

commit;
