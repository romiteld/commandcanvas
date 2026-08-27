\set ON_ERROR_STOP on

-- Required inputs are two existing Supabase Auth user UUIDs:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -v participant_user_id='<uuid>' \
--   -f supabase/tests/packet_workflow_probes.sql
--
-- All fixtures and workflow transitions run inside one rolled-back transaction.

begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as first_send_request_id,
  gen_random_uuid() as duplicate_stage_request_id,
  gen_random_uuid() as cancelled_restage_request_id,
  gen_random_uuid() as preview_send_request_id,
  gen_random_uuid() as preview_restage_request_id,
  gen_random_uuid() as failed_retry_request_id,
  gen_random_uuid() as sent_restage_request_id,
  gen_random_uuid() as expired_send_request_id,
  gen_random_uuid() as resend_send_request_id,
  gen_random_uuid() as preview_share_id,
  gen_random_uuid() as failed_share_id,
  gen_random_uuid() as expired_share_id,
  gen_random_uuid() as resend_share_id,
  'packet-' || replace(gen_random_uuid()::text, '-', '') as packet_id,
  'note-' || replace(gen_random_uuid()::text, '-', '') as note_id,
  'diagram-' || replace(gen_random_uuid()::text, '-', '') as diagram_id,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as sketch_id,
  'note-' || replace(gen_random_uuid()::text, '-', '') as deleted_note_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug
\gset cc_

select
  set_config('commandcanvas.packet_room_id', :'cc_room_id', true),
  set_config(
    'commandcanvas.packet_first_send_request_id',
    :'cc_first_send_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_duplicate_stage_request_id',
    :'cc_duplicate_stage_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_cancelled_restage_request_id',
    :'cc_cancelled_restage_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_preview_send_request_id',
    :'cc_preview_send_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_preview_restage_request_id',
    :'cc_preview_restage_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_failed_retry_request_id',
    :'cc_failed_retry_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_sent_restage_request_id',
    :'cc_sent_restage_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_expired_send_request_id',
    :'cc_expired_send_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_resend_send_request_id',
    :'cc_resend_send_request_id',
    true
  ),
  set_config(
    'commandcanvas.packet_preview_share_id',
    :'cc_preview_share_id',
    true
  ),
  set_config(
    'commandcanvas.packet_failed_share_id',
    :'cc_failed_share_id',
    true
  ),
  set_config(
    'commandcanvas.packet_expired_share_id',
    :'cc_expired_share_id',
    true
  ),
  set_config(
    'commandcanvas.packet_resend_share_id',
    :'cc_resend_share_id',
    true
  ),
  set_config('commandcanvas.packet_id', :'cc_packet_id', true),
  set_config('commandcanvas.packet_note_id', :'cc_note_id', true),
  set_config('commandcanvas.packet_diagram_id', :'cc_diagram_id', true),
  set_config('commandcanvas.packet_sketch_id', :'cc_sketch_id', true),
  set_config('commandcanvas.packet_host_id', :'host_user_id', true),
  set_config(
    'commandcanvas.packet_participant_id',
    :'participant_user_id',
    true
  );

set local role service_role;

select public.create_room_with_host(
  p_room_id => :'cc_room_id'::uuid,
  p_slug => :'cc_room_slug',
  p_name => 'Architecture review',
  p_mode => 'demo',
  p_host_user_id => :'host_user_id'::uuid,
  p_display_name => 'Probe Host',
  p_color => '#2563EB',
  p_join_token => 'packet_probe_join_token_0123456789abcdef'
);

select public.join_room_as_participant(
  p_room_id => :'cc_room_id'::uuid,
  p_user_id => :'participant_user_id'::uuid,
  p_display_name => 'Probe Participant',
  p_color => '#F97316',
  p_join_token => 'packet_probe_join_token_0123456789abcdef',
  p_requested_role => 'participant'
);

select public.commit_canvas_mutation_at_revision(
  p_room_id => :'cc_room_id'::uuid,
  p_expected_room_revision => 0,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'typed',
  p_action => 'create',
  p_description => 'Probe host created packet source objects.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_note_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Launch decision',
        'x', 10,
        'y', 20,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Launch on Friday."}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_diagram_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'diagram',
        'title', 'Approved architecture',
        'x', 420,
        'y', 30,
        'width', 620,
        'height', 360,
        'zIndex', 2,
        'minimized', false,
        'pinned', true,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"nodes":[{"id":"api","label":"API"}],"edges":[]}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_sketch_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'sketch',
        'title', 'Rough source sketch',
        'x', -300,
        'y', 0,
        'width', 480,
        'height', 320,
        'zIndex', 3,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"strokes":[{"points":[{"x":1,"y":2}]}]}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => gen_random_uuid()
);

-- This tombstone models late-join reconstruction data. Creation commands
-- correctly refuse to start deleted, so the fixture is inserted as persisted
-- state rather than bypassing that command guard.
insert into public.canvas_objects (
  id,
  room_id,
  object_type,
  title,
  x,
  y,
  width,
  height,
  z_index,
  minimized,
  pinned,
  created_by,
  deleted_at,
  version,
  revision,
  metadata,
  payload
) values (
  :'cc_deleted_note_id',
  :'cc_room_id'::uuid,
  'note',
  'Discarded note',
  30,
  40,
  300,
  180,
  4,
  false,
  false,
  :'host_user_id'::uuid,
  clock_timestamp(),
  1,
  1,
  '{}'::jsonb,
  '{"text":"Do not include."}'::jsonb
);

do $$
begin
  begin
    perform public.prepare_meeting_packet_draft(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_host_user_id => current_setting(
        'commandcanvas.packet_host_id'
      )::uuid,
      p_packet_id => 'packet-empty-selection',
      p_actor_type => 'agent',
      p_title => 'Must fail',
      p_selected_object_ids => '{}'::text[]
    );
    raise exception 'packet_empty_selection_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_content_required' then
        raise;
      end if;
  end;

  begin
    perform public.prepare_meeting_packet_draft(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_host_user_id => current_setting(
        'commandcanvas.packet_host_id'
      )::uuid,
      p_packet_id => 'packet-rough-selection',
      p_actor_type => 'agent',
      p_title => 'Must fail',
      p_selected_object_ids => array[
        current_setting('commandcanvas.packet_sketch_id')
      ]::text[]
    );
    raise exception 'packet_nonsemantic_selection_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_selected_object_invalid' then
        raise;
      end if;
  end;
end;
$$;

do $$
declare
  v_result jsonb;
  v_packet public.meeting_packets%rowtype;
begin
  v_result := public.prepare_meeting_packet_draft(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_host_user_id => current_setting(
      'commandcanvas.packet_host_id'
    )::uuid,
    p_packet_id => current_setting('commandcanvas.packet_id'),
    p_actor_type => 'agent',
    p_title => '  Selected architecture packet  ',
    p_selected_object_ids => array[
      current_setting('commandcanvas.packet_note_id'),
      current_setting('commandcanvas.packet_diagram_id')
    ]::text[]
  );

  select packet.*
  into strict v_packet
  from public.meeting_packets packet
  where packet.room_id = current_setting('commandcanvas.packet_room_id')::uuid
    and packet.id = current_setting('commandcanvas.packet_id');

  if v_result ->> 'packetId' <> v_packet.id
     or (v_result ->> 'packetVersion')::integer <> v_packet.packet_version
     or v_result -> 'contentSnapshot' <> pg_catalog.jsonb_build_object(
       'title', v_packet.title,
       'content', v_packet.content
     )
  then
    raise exception 'packet_prepare_response_snapshot_invalid';
  end if;
end;
$$;

do $$
declare
  v_packet public.meeting_packets%rowtype;
  v_item jsonb;
begin
  select packet.*
  into strict v_packet
  from public.meeting_packets packet
  where packet.room_id = current_setting('commandcanvas.packet_room_id')::uuid
    and packet.id = current_setting('commandcanvas.packet_id');

  if v_packet.title <> 'Selected architecture packet'
     or v_packet.source_revision <> 1
     or v_packet.content ->> 'roomName' <> 'Architecture review'
     or (v_packet.content ->> 'sourceRevision')::bigint <> 1
     or jsonb_array_length(v_packet.content -> 'objects') <> 2
  then
    raise exception 'packet_prepare_content_invalid';
  end if;

  for v_item in
    select item.value
    from jsonb_array_elements(v_packet.content -> 'objects') item(value)
  loop
    if (select count(*) from jsonb_object_keys(v_item)) <> 4
       or not (v_item ?& array['objectId', 'objectType', 'title', 'payload'])
       or v_item ?| array[
         'x', 'y', 'width', 'height', 'zIndex', 'minimized', 'pinned'
       ]
       or v_item ->> 'objectType' in ('sketch')
    then
      raise exception 'packet_prepare_leaked_layout_or_rough_sketch';
    end if;
  end loop;

  if (select revision from public.rooms
      where id = current_setting('commandcanvas.packet_room_id')::uuid) <> 1
     or (select count(*) from public.receipts
         where room_id = current_setting(
           'commandcanvas.packet_room_id'
         )::uuid) <> 1
  then
    raise exception 'packet_prepare_mutated_canvas_revision_stream';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.update_meeting_packet_draft(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_packet_id => current_setting('commandcanvas.packet_id'),
      p_host_user_id => current_setting(
        'commandcanvas.packet_host_id'
      )::uuid,
      p_title => 'Architecture review packet',
      p_recipient_draft => '[
        {"name":"A","email":"duplicate@example.com"},
        {"name":"B","email":"DUPLICATE@example.com"}
      ]'::jsonb
    );
    raise exception 'packet_duplicate_recipient_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_recipient_duplicate_email' then
        raise;
      end if;
  end;
end;
$$;

select public.update_meeting_packet_draft(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_title => '  Architecture review packet  ',
  p_recipient_draft => '[
    {"name":"  Zoe  ","email":"ZOE@EXAMPLE.COM"},
    {"name":"  Amy  ","email":"amy@example.com"}
  ]'::jsonb
);

do $$
declare
  v_result jsonb;
  v_packet public.meeting_packets%rowtype;
begin
  v_result := public.approve_meeting_packet(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_packet_id => current_setting('commandcanvas.packet_id'),
    p_host_user_id => current_setting(
      'commandcanvas.packet_host_id'
    )::uuid
  );

  select packet.*
  into strict v_packet
  from public.meeting_packets packet
  where packet.room_id = current_setting('commandcanvas.packet_room_id')::uuid
    and packet.id = current_setting('commandcanvas.packet_id');

  if (v_result ->> 'packetVersion')::integer <> v_packet.packet_version
     or v_result -> 'contentSnapshot' <> v_packet.approved_content_snapshot
     or v_result -> 'recipientSnapshot' <> v_packet.recipient_snapshot
     or v_result ->> 'contentHash' <> v_packet.approved_content_hash
     or v_result ->> 'recipientHash' <> v_packet.recipient_snapshot_hash
  then
    raise exception 'packet_approval_response_snapshot_invalid';
  end if;
end;
$$;

do $$
declare
  v_packet public.meeting_packets%rowtype;
begin
  select packet.*
  into strict v_packet
  from public.meeting_packets packet
  where packet.room_id = current_setting('commandcanvas.packet_room_id')::uuid
    and packet.id = current_setting('commandcanvas.packet_id');

  if v_packet.title <> 'Architecture review packet'
     or v_packet.recipient_snapshot <> '[
       {"name":"Amy","email":"amy@example.com"},
       {"name":"Zoe","email":"zoe@example.com"}
     ]'::jsonb
     or v_packet.approved_content_snapshot <> jsonb_build_object(
       'title', v_packet.title,
       'content', v_packet.content
     )
     or v_packet.approved_content_hash
       <> encode(
         sha256(convert_to(v_packet.approved_content_snapshot::text, 'UTF8')),
         'hex'
       )
     or v_packet.recipient_snapshot_hash
       <> encode(
         sha256(convert_to(v_packet.recipient_snapshot::text, 'UTF8')),
         'hex'
       )
  then
    raise exception 'packet_approval_snapshot_invalid';
  end if;
end;
$$;

do $$
declare
  v_result jsonb;
  v_request public.packet_send_requests%rowtype;
begin
  v_result := public.stage_meeting_packet_send(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_packet_id => current_setting('commandcanvas.packet_id'),
    p_host_user_id => current_setting(
      'commandcanvas.packet_host_id'
    )::uuid,
    p_requested_by_actor_type => 'agent',
    p_send_request_id => current_setting(
      'commandcanvas.packet_first_send_request_id'
    )::uuid
  );

  select request.*
  into strict v_request
  from public.packet_send_requests request
  where request.id = current_setting(
    'commandcanvas.packet_first_send_request_id'
  )::uuid;

  if (v_result ->> 'packetVersion')::integer <> v_request.packet_version
     or v_result ->> 'contentHash' <> v_request.packet_content_hash
     or v_result ->> 'recipientHash' <> v_request.recipient_snapshot_hash
     or v_result -> 'recipientSnapshot' <> v_request.recipient_snapshot
  then
    raise exception 'packet_stage_response_snapshot_invalid';
  end if;
end;
$$;

-- A new proposed UUID while approval is pending must resolve to the original
-- durable request without appending another activity receipt.
do $$
declare
  v_result jsonb;
begin
  v_result := public.stage_meeting_packet_send(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_packet_id => current_setting('commandcanvas.packet_id'),
    p_host_user_id => current_setting('commandcanvas.packet_host_id')::uuid,
    p_requested_by_actor_type => 'agent',
    p_send_request_id => current_setting(
      'commandcanvas.packet_duplicate_stage_request_id'
    )::uuid
  );

  if v_result ->> 'sendRequestId' <> current_setting(
       'commandcanvas.packet_first_send_request_id'
     )
     or v_result ->> 'status' <> 'awaiting_human_approval'
     or (v_result ->> 'changed')::boolean is distinct from false
  then
    raise exception 'packet_active_stage_was_not_idempotent';
  end if;
end;
$$;

do $$
begin
  if (select status from public.packet_send_requests
      where id = current_setting(
        'commandcanvas.packet_first_send_request_id'
      )::uuid) <> 'awaiting_human_approval'
     or exists (
       select 1 from public.outbound_shares
       where send_request_id = current_setting(
         'commandcanvas.packet_first_send_request_id'
       )::uuid
     )
     or exists (
       select 1 from public.packet_send_requests
       where id = current_setting(
         'commandcanvas.packet_duplicate_stage_request_id'
       )::uuid
     )
     or (select count(*) from public.packet_send_requests
         where room_id = current_setting(
           'commandcanvas.packet_room_id'
         )::uuid
           and packet_id = current_setting('commandcanvas.packet_id')) <> 1
     or (select count(*) from public.packet_activity_receipts
         where room_id = current_setting(
           'commandcanvas.packet_room_id'
         )::uuid
           and action = 'packet_send_staged') <> 1
     or (select idempotency_key from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_first_send_request_id'
         )::uuid) <> (
           'commandcanvas:packet-send:' || current_setting(
             'commandcanvas.packet_first_send_request_id'
           )
         )
  then
    raise exception 'packet_stage_was_not_side_effect_free_or_idempotent';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.authorize_meeting_packet_send(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_send_request_id => current_setting(
        'commandcanvas.packet_first_send_request_id'
      )::uuid,
      p_host_user_id => current_setting(
        'commandcanvas.packet_participant_id'
      )::uuid,
      p_delivery_mode => 'preview',
      p_outbound_share_id => gen_random_uuid()
    );
    raise exception 'packet_participant_authorization_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_host_required' then
        raise;
      end if;
  end;

  begin
    perform public.cancel_meeting_packet_send(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_send_request_id => current_setting(
        'commandcanvas.packet_first_send_request_id'
      )::uuid,
      p_host_user_id => current_setting(
        'commandcanvas.packet_participant_id'
      )::uuid
    );
    raise exception 'packet_participant_cancellation_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_host_required' then
        raise;
      end if;
  end;
end;
$$;

do $$
declare
  v_first jsonb;
  v_second jsonb;
begin
  v_first := public.cancel_meeting_packet_send(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_send_request_id => current_setting(
      'commandcanvas.packet_first_send_request_id'
    )::uuid,
    p_host_user_id => current_setting('commandcanvas.packet_host_id')::uuid
  );
  v_second := public.cancel_meeting_packet_send(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_send_request_id => current_setting(
      'commandcanvas.packet_first_send_request_id'
    )::uuid,
    p_host_user_id => current_setting('commandcanvas.packet_host_id')::uuid
  );

  if v_first ->> 'status' <> 'cancelled'
     or (v_first ->> 'changed')::boolean is distinct from true
     or (v_second ->> 'changed')::boolean is distinct from false
     or v_first ->> 'receiptId' <> v_second ->> 'receiptId'
     or (select status from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_first_send_request_id'
         )::uuid) <> 'cancelled'
     or (select count(*) from public.packet_activity_receipts
         where send_request_id = current_setting(
           'commandcanvas.packet_first_send_request_id'
         )::uuid
           and action = 'packet_send_cancelled') <> 1
  then
    raise exception 'packet_send_cancellation_not_durable_or_idempotent';
  end if;

  begin
    perform public.authorize_meeting_packet_send(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_send_request_id => current_setting(
        'commandcanvas.packet_first_send_request_id'
      )::uuid,
      p_host_user_id => current_setting('commandcanvas.packet_host_id')::uuid,
      p_delivery_mode => 'preview',
      p_outbound_share_id => gen_random_uuid()
    );
    raise exception 'packet_cancelled_send_was_authorized';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_send_request_expired' then
        raise;
      end if;
  end;
end;
$$;

-- Cancellation ends one approval attempt but does not consume the approved
-- packet snapshot. A fresh durable request can be staged immediately.
do $$
declare
  v_result jsonb;
begin
  v_result := public.stage_meeting_packet_send(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_packet_id => current_setting('commandcanvas.packet_id'),
    p_host_user_id => current_setting('commandcanvas.packet_host_id')::uuid,
    p_requested_by_actor_type => 'agent',
    p_send_request_id => current_setting(
      'commandcanvas.packet_cancelled_restage_request_id'
    )::uuid
  );

  if v_result ->> 'sendRequestId' <> current_setting(
       'commandcanvas.packet_cancelled_restage_request_id'
     )
     or v_result ->> 'status' <> 'awaiting_human_approval'
     or (v_result ->> 'changed')::boolean is distinct from true
     or (select status from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_cancelled_restage_request_id'
         )::uuid) <> 'awaiting_human_approval'
     or (select idempotency_key from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_cancelled_restage_request_id'
         )::uuid) <> (
           'commandcanvas:packet-send:' || current_setting(
             'commandcanvas.packet_cancelled_restage_request_id'
           )
         )
  then
    raise exception 'packet_cancelled_send_was_not_restageable';
  end if;
end;
$$;

-- Editing an approved packet invalidates its exact approval. A cancellation is
-- terminal and remains attributable rather than being rewritten as expired.
select public.update_meeting_packet_draft(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_title => 'Architecture review packet v2',
  p_recipient_draft => '[
    {"name":"Amy","email":"amy@example.com"},
    {"name":"Zoe","email":"zoe@example.com"}
  ]'::jsonb
);

do $$
begin
  if (select status from public.meeting_packets
      where room_id = current_setting('commandcanvas.packet_room_id')::uuid
        and id = current_setting('commandcanvas.packet_id')) <> 'draft'
     or exists (
       select 1 from public.meeting_packets
       where room_id = current_setting('commandcanvas.packet_room_id')::uuid
         and id = current_setting('commandcanvas.packet_id')
         and (
           approved_content_snapshot is not null
           or recipient_snapshot is not null
           or approved_at is not null
         )
     )
     or (select status from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_first_send_request_id'
         )::uuid) <> 'cancelled'
  then
    raise exception 'packet_stale_approval_was_not_invalidated';
  end if;
end;
$$;

select public.approve_meeting_packet(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid
);

select public.stage_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_requested_by_actor_type => 'agent',
  p_send_request_id => :'cc_expired_send_request_id'::uuid
);

reset role;

update public.packet_send_requests
set
  requested_at = clock_timestamp() - interval '16 minutes',
  expires_at = clock_timestamp() - interval '1 minute'
where id = :'cc_expired_send_request_id'::uuid;

set local role service_role;

select public.authorize_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_send_request_id => :'cc_expired_send_request_id'::uuid,
  p_host_user_id => :'host_user_id'::uuid,
  p_delivery_mode => 'preview',
  p_outbound_share_id => :'cc_expired_share_id'::uuid
);

do $$
begin
  if (select status from public.packet_send_requests
      where id = current_setting(
        'commandcanvas.packet_expired_send_request_id'
      )::uuid) <> 'expired'
     or exists (
       select 1 from public.outbound_shares
       where id = current_setting(
         'commandcanvas.packet_expired_share_id'
       )::uuid
     )
     or (select count(*) from public.packet_activity_receipts
         where send_request_id = current_setting(
           'commandcanvas.packet_expired_send_request_id'
         )::uuid
           and action = 'packet_send_expired') <> 1
  then
    raise exception 'packet_expired_authorization_not_persisted';
  end if;
end;
$$;

select public.update_meeting_packet_draft(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_title => 'Architecture review packet v3',
  p_recipient_draft => '[
    {"name":"Amy","email":"amy@example.com"},
    {"name":"Zoe","email":"zoe@example.com"}
  ]'::jsonb
);

select public.approve_meeting_packet(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid
);

select public.stage_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_requested_by_actor_type => 'agent',
  p_send_request_id => :'cc_preview_send_request_id'::uuid
);

select public.authorize_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_send_request_id => :'cc_preview_send_request_id'::uuid,
  p_host_user_id => :'host_user_id'::uuid,
  p_delivery_mode => 'preview',
  p_outbound_share_id => :'cc_preview_share_id'::uuid
);

-- Preview-only is an honest terminal outcome, not a real send. Restage the
-- exact approved snapshot, record a failed provider attempt, then prove that a
-- third durable attempt can be staged without rewriting either terminal row.
select public.stage_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_requested_by_actor_type => 'agent',
  p_send_request_id => :'cc_preview_restage_request_id'::uuid
);

select public.authorize_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_send_request_id => :'cc_preview_restage_request_id'::uuid,
  p_host_user_id => :'host_user_id'::uuid,
  p_delivery_mode => 'resend',
  p_outbound_share_id => :'cc_failed_share_id'::uuid
);

select public.complete_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_send_request_id => :'cc_preview_restage_request_id'::uuid,
  p_host_user_id => :'host_user_id'::uuid,
  p_outcome => 'failed',
  p_provider_message_id => null,
  p_error_code => 'provider_rejected_probe'
);

do $$
declare
  v_result jsonb;
begin
  v_result := public.stage_meeting_packet_send(
    p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
    p_packet_id => current_setting('commandcanvas.packet_id'),
    p_host_user_id => current_setting('commandcanvas.packet_host_id')::uuid,
    p_requested_by_actor_type => 'agent',
    p_send_request_id => current_setting(
      'commandcanvas.packet_failed_retry_request_id'
    )::uuid
  );

  if v_result ->> 'status' <> 'awaiting_human_approval'
     or (v_result ->> 'changed')::boolean is distinct from true
     or (select status from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_preview_send_request_id'
         )::uuid) <> 'preview_only'
     or (select status from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_preview_restage_request_id'
         )::uuid) <> 'failed'
     or (select status from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_failed_retry_request_id'
         )::uuid) <> 'awaiting_human_approval'
     or (select idempotency_key from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_failed_retry_request_id'
         )::uuid) <> (
           'commandcanvas:packet-send:' || current_setting(
             'commandcanvas.packet_failed_retry_request_id'
           )
         )
  then
    raise exception 'packet_preview_or_failure_was_not_restageable';
  end if;
end;
$$;

-- Changing and reapproving the packet expires the still-awaiting retry and
-- creates a distinct approved snapshot for the real submission probe.
select public.update_meeting_packet_draft(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_title => 'Architecture review packet v4',
  p_recipient_draft => '[
    {"name":"Amy","email":"amy@example.com"},
    {"name":"Zoe","email":"zoe@example.com"}
  ]'::jsonb
);

select public.approve_meeting_packet(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid
);

select public.stage_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_packet_id => :'cc_packet_id',
  p_host_user_id => :'host_user_id'::uuid,
  p_requested_by_actor_type => 'agent',
  p_send_request_id => :'cc_resend_send_request_id'::uuid
);

select public.authorize_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_send_request_id => :'cc_resend_send_request_id'::uuid,
  p_host_user_id => :'host_user_id'::uuid,
  p_delivery_mode => 'resend',
  p_outbound_share_id => :'cc_resend_share_id'::uuid
);

select public.complete_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_send_request_id => :'cc_resend_send_request_id'::uuid,
  p_host_user_id => :'host_user_id'::uuid,
  p_outcome => 'sent',
  p_provider_message_id => 'resend-accepted-probe-id',
  p_error_code => null
);

-- Provider completion is idempotent for an exact retry.
select public.complete_meeting_packet_send(
  p_room_id => :'cc_room_id'::uuid,
  p_send_request_id => :'cc_resend_send_request_id'::uuid,
  p_host_user_id => :'host_user_id'::uuid,
  p_outcome => 'sent',
  p_provider_message_id => 'resend-accepted-probe-id',
  p_error_code => null
);

-- A real submission consumes the exact approved snapshot. Another attempt now
-- requires changed packet content or recipients followed by explicit approval.
do $$
begin
  begin
    perform public.stage_meeting_packet_send(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_packet_id => current_setting('commandcanvas.packet_id'),
      p_host_user_id => current_setting('commandcanvas.packet_host_id')::uuid,
      p_requested_by_actor_type => 'agent',
      p_send_request_id => current_setting(
        'commandcanvas.packet_sent_restage_request_id'
      )::uuid
    );
    raise exception 'packet_sent_snapshot_was_restageable';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_send_new_approval_required' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.packet_send_requests
    where id = current_setting(
      'commandcanvas.packet_sent_restage_request_id'
    )::uuid
  ) then
    raise exception 'packet_sent_restage_row_was_created';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.complete_meeting_packet_send(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_send_request_id => current_setting(
        'commandcanvas.packet_resend_send_request_id'
      )::uuid,
      p_host_user_id => current_setting(
        'commandcanvas.packet_host_id'
      )::uuid,
      p_outcome => 'failed',
      p_provider_message_id => null,
      p_error_code => 'provider_conflict'
    );
    raise exception 'packet_conflicting_completion_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_send_completion_conflict' then
        raise;
      end if;
  end;

  if (select status from public.packet_send_requests
      where id = current_setting(
        'commandcanvas.packet_preview_send_request_id'
      )::uuid) <> 'preview_only'
     or (select provider from public.outbound_shares
         where id = current_setting(
           'commandcanvas.packet_preview_share_id'
         )::uuid) <> 'preview'
     or (select status from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_resend_send_request_id'
         )::uuid) <> 'sent'
     or (select provider_message_id from public.outbound_shares
         where id = current_setting(
           'commandcanvas.packet_resend_share_id'
         )::uuid) <> 'resend-accepted-probe-id'
     or (select idempotency_key from public.packet_send_requests
         where id = current_setting(
           'commandcanvas.packet_resend_send_request_id'
         )::uuid) <> (
           'commandcanvas:packet-send:' || current_setting(
             'commandcanvas.packet_resend_send_request_id'
           )
         )
     or (select count(*) from public.packet_activity_receipts
         where room_id = current_setting(
           'commandcanvas.packet_room_id'
         )::uuid
           and action = 'packet_send_submitted') <> 1
  then
    raise exception 'packet_send_workflow_state_invalid';
  end if;

  if (select revision from public.rooms
      where id = current_setting('commandcanvas.packet_room_id')::uuid) <> 1
     or (select count(*) from public.receipts
         where room_id = current_setting(
           'commandcanvas.packet_room_id'
         )::uuid) <> 1
  then
    raise exception 'packet_workflow_mutated_canvas_revision_stream';
  end if;
end;
$$;

reset role;
set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  current_setting('commandcanvas.packet_host_id'),
  true
);

do $$
begin
  if (select count(*) from public.packet_activity_receipts
      where room_id = current_setting(
        'commandcanvas.packet_room_id'
      )::uuid) < 1
  then
    raise exception 'packet_host_cannot_read_activity';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  current_setting('commandcanvas.packet_participant_id'),
  true
);

do $$
begin
  if exists (
    select 1 from public.packet_activity_receipts
    where room_id = current_setting('commandcanvas.packet_room_id')::uuid
  ) then
    raise exception 'packet_participant_read_activity';
  end if;

  begin
    perform public.prepare_meeting_packet_draft(
      p_room_id => current_setting('commandcanvas.packet_room_id')::uuid,
      p_host_user_id => current_setting(
        'commandcanvas.packet_participant_id'
      )::uuid,
      p_packet_id => 'packet-browser-must-fail',
      p_actor_type => 'human'
    );
    raise exception 'packet_authenticated_rpc_execute_present';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;

do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'meeting_packets',
    'packet_send_requests',
    'outbound_shares'
  ]
  loop
    begin
      execute pg_catalog.format(
        'insert into public.%I select source.* from public.%I source where false',
        v_table_name,
        v_table_name
      );
      raise exception 'packet_service_direct_insert_was_accepted:%',
        v_table_name;
    exception
      when insufficient_privilege then null;
    end;

    begin
      execute pg_catalog.format(
        'update public.%I set room_id = room_id where false',
        v_table_name
      );
      raise exception 'packet_service_direct_update_was_accepted:%',
        v_table_name;
    exception
      when insufficient_privilege then null;
    end;

    begin
      execute pg_catalog.format(
        'delete from public.%I where false',
        v_table_name
      );
      raise exception 'packet_service_direct_delete_was_accepted:%',
        v_table_name;
    exception
      when insufficient_privilege then null;
    end;

    if has_table_privilege(
         'service_role',
         'public.' || v_table_name,
         'INSERT'
       )
       or has_table_privilege(
         'service_role',
         'public.' || v_table_name,
         'UPDATE'
       )
       or has_table_privilege(
         'service_role',
         'public.' || v_table_name,
         'DELETE'
       )
       or has_table_privilege(
         'service_role',
         'public.' || v_table_name,
         'TRUNCATE'
       )
       or has_table_privilege(
         'service_role',
         'public.' || v_table_name,
         'REFERENCES'
       )
       or has_table_privilege(
         'service_role',
         'public.' || v_table_name,
         'TRIGGER'
       )
    then
      raise exception 'packet_service_direct_mutation_grant_present:%',
        v_table_name;
    end if;

    if not has_table_privilege(
      'service_role',
      'public.' || v_table_name,
      'SELECT'
    ) then
      raise exception 'packet_service_read_grant_missing:%', v_table_name;
    end if;
  end loop;
end;
$$;

do $$
begin
  if has_table_privilege(
       'service_role',
       'public.packet_activity_receipts',
       'UPDATE'
     )
     or has_table_privilege(
       'service_role',
       'public.packet_activity_receipts',
       'DELETE'
     )
  then
    raise exception 'packet_activity_service_mutation_grant_present';
  end if;
end;
$$;

reset role;

do $$
declare
  v_activity_id uuid;
begin
  select receipt.id
  into strict v_activity_id
  from public.packet_activity_receipts receipt
  where receipt.room_id = current_setting('commandcanvas.packet_room_id')::uuid
  order by receipt.activity_revision
  limit 1;

  begin
    update public.packet_activity_receipts
    set description = 'tamper'
    where id = v_activity_id;
    raise exception 'packet_activity_update_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'packet activity receipts are immutable' then
        raise;
      end if;
  end;

  begin
    delete from public.packet_activity_receipts where id = v_activity_id;
    raise exception 'packet_activity_delete_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'packet activity receipts are immutable' then
        raise;
      end if;
  end;
end;
$$;

set local role service_role;

delete from public.rooms
where id = :'cc_room_id'::uuid;

do $$
begin
  if exists (
    select 1 from public.packet_activity_receipts
    where room_id = current_setting('commandcanvas.packet_room_id')::uuid
  ) then
    raise exception 'packet_activity_room_cascade_failed';
  end if;
end;
$$;

reset role;

rollback;

\echo packet_workflow_probes_passed
