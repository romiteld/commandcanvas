\set ON_ERROR_STOP on

-- Required privileged input: host_user_id for an existing auth.users row.
-- The transaction is always rolled back. This probe exercises the two races
-- where a signed event arrives before the provider response is durable.
begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as invitation_id,
  gen_random_uuid() as invitation_request_id,
  gen_random_uuid() as packet_send_request_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug,
  'packet-' || replace(gen_random_uuid()::text, '-', '') as packet_id,
  'invite-event-' || replace(gen_random_uuid()::text, '-', '') as invite_event_id,
  'packet-event-' || replace(gen_random_uuid()::text, '-', '') as packet_event_id,
  'invite-message-' || replace(gen_random_uuid()::text, '-', '') as invite_message_id,
  'packet-message-' || replace(gen_random_uuid()::text, '-', '') as packet_message_id,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') as invite_token
\gset cc_resend_

update auth.users
set
  email = 'resend-probe-' || replace(gen_random_uuid()::text, '-', '') || '@example.com',
  email_confirmed_at = pg_catalog.clock_timestamp(),
  is_anonymous = false
where id = :'host_user_id'::uuid;

select
  pg_catalog.set_config('commandcanvas.resend.room_id', :'cc_resend_room_id', true),
  pg_catalog.set_config('commandcanvas.resend.host_id', :'host_user_id', true),
  pg_catalog.set_config('commandcanvas.resend.invitation_id', :'cc_resend_invitation_id', true),
  pg_catalog.set_config('commandcanvas.resend.packet_id', :'cc_resend_packet_id', true),
  pg_catalog.set_config('commandcanvas.resend.packet_request_id', :'cc_resend_packet_send_request_id', true),
  pg_catalog.set_config('commandcanvas.resend.invite_event_id', :'cc_resend_invite_event_id', true),
  pg_catalog.set_config('commandcanvas.resend.packet_event_id', :'cc_resend_packet_event_id', true),
  pg_catalog.set_config('commandcanvas.resend.invite_message_id', :'cc_resend_invite_message_id', true),
  pg_catalog.set_config('commandcanvas.resend.packet_message_id', :'cc_resend_packet_message_id', true);

set local role service_role;

select public.create_standard_meeting_with_host(
  :'cc_resend_room_id'::uuid,
  :'cc_resend_room_slug',
  'Resend reconciliation probe',
  :'host_user_id'::uuid,
  'Probe Host',
  '#2563EB',
  'resend_probe_join_token_0123456789abcdef'
);

select public.create_room_email_invitation(
  :'cc_resend_invitation_id'::uuid,
  :'cc_resend_invitation_request_id'::uuid,
  :'cc_resend_room_id'::uuid,
  :'host_user_id'::uuid,
  'participant-' || replace(gen_random_uuid()::text, '-', '') || '@example.com',
  'Probe Participant',
  '#A855F7',
  :'cc_resend_invite_token',
  24,
  'participant'
);

select public.reserve_room_invitation_delivery(
  :'cc_resend_room_id'::uuid,
  :'cc_resend_invitation_id'::uuid,
  :'host_user_id'::uuid
);

do $$
declare
  v_result jsonb;
begin
  v_result := public.apply_resend_delivery_event(
    pg_catalog.current_setting('commandcanvas.resend.invite_event_id'),
    'email.delivered',
    pg_catalog.current_setting('commandcanvas.resend.invite_message_id'),
    pg_catalog.clock_timestamp(),
    repeat('a', 64),
    'delivered'
  );
  if v_result ->> 'processingResult' <> 'unmatched' then
    raise exception 'invitation_event_did_not_wait_for_provider_identity';
  end if;
end;
$$;

select public.complete_room_invitation_delivery(
  :'cc_resend_room_id'::uuid,
  :'cc_resend_invitation_id'::uuid,
  :'host_user_id'::uuid,
  'submitted',
  :'cc_resend_invite_message_id',
  null
);

do $$
declare
  v_result jsonb;
begin
  v_result := public.apply_resend_delivery_event(
    pg_catalog.current_setting('commandcanvas.resend.invite_event_id'),
    'email.delivered',
    pg_catalog.current_setting('commandcanvas.resend.invite_message_id'),
    (select event_row.provider_occurred_at
     from private.resend_webhook_events event_row
     where event_row.provider_event_id = pg_catalog.current_setting(
       'commandcanvas.resend.invite_event_id'
     )),
    repeat('a', 64),
    'delivered'
  );
  if v_result ->> 'processingResult' <> 'applied'
     or (select invitation.delivery_status
         from private.room_email_invitations invitation
         where invitation.id = pg_catalog.current_setting(
           'commandcanvas.resend.invitation_id'
         )::uuid) <> 'delivered'
  then
    raise exception 'invitation_unmatched_event_was_not_reconciled';
  end if;

  v_result := public.apply_resend_delivery_event(
    pg_catalog.current_setting('commandcanvas.resend.invite_event_id'),
    'email.delivered',
    pg_catalog.current_setting('commandcanvas.resend.invite_message_id'),
    (select event_row.provider_occurred_at
     from private.resend_webhook_events event_row
     where event_row.provider_event_id = pg_catalog.current_setting(
       'commandcanvas.resend.invite_event_id'
     )),
    repeat('a', 64),
    'delivered'
  );
  if v_result ->> 'processingResult' <> 'duplicate' then
    raise exception 'invitation_event_replay_was_not_idempotent';
  end if;
end;
$$;

reset role;

do $$
declare
  v_content jsonb := '{"schemaVersion":1,"roomName":"Probe","sourceRevision":0,"objects":[{"objectId":"note-probe","objectType":"note","title":"Probe","payload":{"text":"Probe"}}]}'::jsonb;
  v_snapshot jsonb;
  v_recipients jsonb := '[{"name":"Probe","email":"probe@example.com"}]'::jsonb;
  v_content_hash text;
  v_recipient_hash text;
begin
  v_snapshot := pg_catalog.jsonb_build_object(
    'title', 'Probe packet',
    'content', v_content
  );
  v_content_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_snapshot::text, 'UTF8')),
    'hex'
  );
  v_recipient_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_recipients::text, 'UTF8')),
    'hex'
  );

  insert into public.meeting_packets (
    id, room_id, packet_version, source_revision, status, title, content,
    recipient_draft, recipient_snapshot, recipient_snapshot_hash,
    approved_content_snapshot, approved_content_hash, created_by, approved_by,
    created_at, updated_at, approved_at
  ) values (
    pg_catalog.current_setting('commandcanvas.resend.packet_id'),
    pg_catalog.current_setting('commandcanvas.resend.room_id')::uuid,
    1, 0, 'approved', 'Probe packet', v_content, v_recipients,
    v_recipients, v_recipient_hash, v_snapshot, v_content_hash,
    pg_catalog.current_setting('commandcanvas.resend.host_id')::uuid,
    pg_catalog.current_setting('commandcanvas.resend.host_id')::uuid,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );

  insert into public.packet_send_requests (
    id, room_id, packet_id, packet_version, content_snapshot,
    packet_content_hash, recipient_snapshot, recipient_snapshot_hash, status,
    requested_by_user_id, requested_by_actor_type, requested_at, expires_at,
    authorized_by_user_id, authorized_at, idempotency_key
  ) values (
    pg_catalog.current_setting('commandcanvas.resend.packet_request_id')::uuid,
    pg_catalog.current_setting('commandcanvas.resend.room_id')::uuid,
    pg_catalog.current_setting('commandcanvas.resend.packet_id'),
    1, v_snapshot, v_content_hash, v_recipients, v_recipient_hash, 'sending',
    pg_catalog.current_setting('commandcanvas.resend.host_id')::uuid,
    'human', pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '15 minutes',
    pg_catalog.current_setting('commandcanvas.resend.host_id')::uuid,
    pg_catalog.clock_timestamp(),
    'commandcanvas:packet-send:' || pg_catalog.current_setting(
      'commandcanvas.resend.packet_request_id'
    )
  );

  insert into public.outbound_shares (
    id, room_id, packet_id, send_request_id, provider, status,
    recipient_snapshot, subject, content_hash
  ) values (
    pg_catalog.current_setting('commandcanvas.resend.packet_request_id')::uuid,
    pg_catalog.current_setting('commandcanvas.resend.room_id')::uuid,
    pg_catalog.current_setting('commandcanvas.resend.packet_id'),
    pg_catalog.current_setting('commandcanvas.resend.packet_request_id')::uuid,
    'resend', 'pending', v_recipients, 'Probe packet', v_content_hash
  );
end;
$$;

set local role service_role;

do $$
declare
  v_result jsonb;
begin
  v_result := public.apply_resend_delivery_event(
    pg_catalog.current_setting('commandcanvas.resend.packet_event_id'),
    'email.delivered',
    pg_catalog.current_setting('commandcanvas.resend.packet_message_id'),
    pg_catalog.clock_timestamp(),
    repeat('b', 64),
    'delivered'
  );
  if v_result ->> 'processingResult' <> 'unmatched' then
    raise exception 'packet_event_did_not_wait_for_provider_identity';
  end if;
end;
$$;

select public.complete_meeting_packet_send(
  :'cc_resend_room_id'::uuid,
  :'cc_resend_packet_send_request_id'::uuid,
  :'host_user_id'::uuid,
  'submitted',
  :'cc_resend_packet_message_id',
  null
);

do $$
declare
  v_result jsonb;
  v_occurred_at timestamptz;
begin
  select event_row.provider_occurred_at
  into strict v_occurred_at
  from private.resend_webhook_events event_row
  where event_row.provider_event_id = pg_catalog.current_setting(
    'commandcanvas.resend.packet_event_id'
  );

  v_result := public.apply_resend_delivery_event(
    pg_catalog.current_setting('commandcanvas.resend.packet_event_id'),
    'email.delivered',
    pg_catalog.current_setting('commandcanvas.resend.packet_message_id'),
    v_occurred_at,
    repeat('b', 64),
    'delivered'
  );
  if v_result ->> 'processingResult' <> 'applied'
     or (select share.status from public.outbound_shares share
         where share.send_request_id = pg_catalog.current_setting(
           'commandcanvas.resend.packet_request_id'
         )::uuid) <> 'delivered'
     or (select pg_catalog.count(*)
         from public.packet_activity_receipts receipt
         where receipt.send_request_id = pg_catalog.current_setting(
           'commandcanvas.resend.packet_request_id'
         )::uuid
           and receipt.action = 'packet_email_delivered') <> 1
  then
    raise exception 'packet_unmatched_event_was_not_reconciled_once';
  end if;

  v_result := public.apply_resend_delivery_event(
    pg_catalog.current_setting('commandcanvas.resend.packet_event_id'),
    'email.delivered',
    pg_catalog.current_setting('commandcanvas.resend.packet_message_id'),
    v_occurred_at,
    repeat('b', 64),
    'delivered'
  );
  if v_result ->> 'processingResult' <> 'duplicate'
     or (select pg_catalog.count(*)
         from public.packet_activity_receipts receipt
         where receipt.send_request_id = pg_catalog.current_setting(
           'commandcanvas.resend.packet_request_id'
         )::uuid
           and receipt.action = 'packet_email_delivered') <> 1
  then
    raise exception 'packet_event_replay_was_not_idempotent';
  end if;
end;
$$;

rollback;
\echo resend_reconciliation_probes_passed
