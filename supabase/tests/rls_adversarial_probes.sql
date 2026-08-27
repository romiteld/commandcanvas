\set ON_ERROR_STOP on

-- Required inputs are three existing Supabase Anonymous Auth user UUIDs:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -v participant_user_id='<uuid>' \
--   -v outsider_user_id='<uuid>' \
--   -f supabase/tests/rls_adversarial_probes.sql
--
-- This script rolls all fixtures back. It proves actual row visibility and
-- browser-role write refusal; it does not substitute for the Browser A/B
-- private-channel Presence and Broadcast exercise.

begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as other_room_id,
  gen_random_uuid() as receipt_id,
  gen_random_uuid() as send_request_id,
  gen_random_uuid() as outbound_share_id,
  'note-' || gen_random_uuid()::text as object_id,
  'packet-' || gen_random_uuid()::text as packet_id
\gset cc_

select
  set_config('commandcanvas.test_room_id', :'cc_room_id', true),
  set_config('commandcanvas.test_object_id', :'cc_object_id', true),
  set_config('commandcanvas.test_packet_id', :'cc_packet_id', true),
  set_config('commandcanvas.test_host_user_id', :'host_user_id', true);

insert into public.rooms (
  id,
  slug,
  name,
  mode,
  revision,
  created_by
) values
  (
    :'cc_room_id'::uuid,
    'probe-room-' || replace(:'cc_room_id', '-', ''),
    'CommandCanvas RLS probe',
    'demo',
    1,
    :'host_user_id'::uuid
  ),
  (
    :'cc_other_room_id'::uuid,
    'probe-room-' || replace(:'cc_other_room_id', '-', ''),
    'CommandCanvas outsider room',
    'demo',
    0,
    :'outsider_user_id'::uuid
  );

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
) values
  (
    :'cc_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'Host probe',
    '#2563EB'
  ),
  (
    :'cc_room_id'::uuid,
    :'participant_user_id'::uuid,
    'participant',
    'Participant probe',
    '#F97316'
  ),
  (
    :'cc_other_room_id'::uuid,
    :'outsider_user_id'::uuid,
    'host',
    'Outsider probe',
    '#16A34A'
  );

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
  version,
  revision,
  metadata,
  payload
) values (
  :'cc_object_id',
  :'cc_room_id'::uuid,
  'note',
  'RLS probe note',
  40,
  60,
  300,
  180,
  1,
  false,
  false,
  :'host_user_id'::uuid,
  1,
  1,
  '{}'::jsonb,
  '{"text":"Visible to members only","tone":"sky"}'::jsonb
);

insert into public.receipts (
  id,
  room_id,
  revision,
  actor_user_id,
  actor_type,
  source,
  actor_display_name,
  action,
  affected_object_ids,
  previous_state,
  resulting_state,
  inverse_command,
  reversible,
  description
) values (
  :'cc_receipt_id'::uuid,
  :'cc_room_id'::uuid,
  1,
  :'host_user_id'::uuid,
  'human',
  'system',
  'Host probe',
  'create',
  array[:'cc_object_id']::text[],
  jsonb_build_array(
    jsonb_build_object('objectId', :'cc_object_id', 'state', null)
  ),
  '[]'::jsonb,
  null,
  false,
  'Host probe created a fixture note.'
);

with packet_fixture as (
  select
    'Private packet probe'::text as title,
    '{"summary":"Recipient data must remain host-only."}'::jsonb as content,
    '[{"name":"Controlled recipient","email":"controlled@example.com"}]'::jsonb
      as recipients
), approved_fixture as (
  select
    packet_fixture.*,
    pg_catalog.jsonb_build_object(
      'title', packet_fixture.title,
      'content', packet_fixture.content
    ) as approved_content
  from packet_fixture
)
insert into public.meeting_packets (
  id,
  room_id,
  packet_version,
  source_revision,
  status,
  title,
  content,
  recipient_draft,
  recipient_snapshot,
  recipient_snapshot_hash,
  approved_content_snapshot,
  approved_content_hash,
  created_by,
  approved_by,
  approved_at
) select
  :'cc_packet_id',
  :'cc_room_id'::uuid,
  1,
  1,
  'approved',
  approved_fixture.title,
  approved_fixture.content,
  approved_fixture.recipients,
  approved_fixture.recipients,
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(approved_fixture.recipients::text, 'UTF8')
    ),
    'hex'
  ),
  approved_fixture.approved_content,
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(approved_fixture.approved_content::text, 'UTF8')
    ),
    'hex'
  ),
  :'host_user_id'::uuid,
  :'host_user_id'::uuid,
  clock_timestamp()
from approved_fixture;

do $$
begin
  begin
    insert into public.meeting_packets (
      id,
      room_id,
      packet_version,
      source_revision,
      status,
      title,
      content,
      recipient_draft,
      recipient_snapshot,
      recipient_snapshot_hash,
      approved_content_hash,
      created_by,
      approved_by,
      approved_at
    ) values (
      'packet-invalid-approved-probe',
      current_setting('commandcanvas.test_room_id')::uuid,
      2,
      1,
      'approved',
      'Invalid approved packet',
      '{"summary":"Hashes are required."}'::jsonb,
      '[{"name":"Controlled recipient","email":"controlled@example.com"}]'::jsonb,
      '[{"name":"Controlled recipient","email":"controlled@example.com"}]'::jsonb,
      null,
      null,
      current_setting('commandcanvas.test_host_user_id')::uuid,
      current_setting('commandcanvas.test_host_user_id')::uuid,
      clock_timestamp()
    );
    raise exception 'packet_approved_null_hashes_were_accepted';
  exception
    when check_violation then null;
  end;

  begin
    update public.meeting_packets
    set recipient_snapshot =
      '[{"name":"Changed recipient","email":"changed@example.com"}]'::jsonb
    where id = current_setting('commandcanvas.test_packet_id');
    raise exception 'packet_approved_snapshot_mutation_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'packet_approved_snapshot_immutable' then
        raise;
      end if;
  end;
end;
$$;

with request_fixture as (
  select
    pg_catalog.jsonb_build_object(
      'title', packet.title,
      'content', packet.content
    ) as content_snapshot,
    packet.recipient_snapshot
  from public.meeting_packets packet
  where packet.room_id = :'cc_room_id'::uuid
    and packet.id = :'cc_packet_id'
)
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
  expires_at,
  idempotency_key
) select
  :'cc_send_request_id'::uuid,
  :'cc_room_id'::uuid,
  :'cc_packet_id',
  1,
  request_fixture.content_snapshot,
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(request_fixture.content_snapshot::text, 'UTF8')
    ),
    'hex'
  ),
  request_fixture.recipient_snapshot,
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(request_fixture.recipient_snapshot::text, 'UTF8')
    ),
    'hex'
  ),
  'awaiting_human_approval',
  :'host_user_id'::uuid,
  'agent',
  clock_timestamp() + interval '10 minutes',
  'probe-' || :'cc_send_request_id'
from request_fixture;

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
  :'cc_outbound_share_id'::uuid,
  :'cc_room_id'::uuid,
  :'cc_packet_id',
  :'cc_send_request_id'::uuid,
  'preview',
  'preview_only',
  '[{"name":"Controlled recipient","email":"controlled@example.com"}]'::jsonb,
  'CommandCanvas packet preview',
  (
    select packet.approved_content_hash
    from public.meeting_packets packet
    where packet.room_id = :'cc_room_id'::uuid
      and packet.id = :'cc_packet_id'
  ),
  clock_timestamp()
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', :'host_user_id',
    'role', 'authenticated',
    'is_anonymous', true
  )::text,
  true
);
set local role authenticated;

do $$
begin
  if (
       select count(*)
       from public.rooms
       where id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
     or (
       select count(*)
       from public.canvas_objects
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
     or (
       select count(*)
       from public.receipts
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
  then
    raise exception 'rls_host_member_state_read_failed';
  end if;

  if (
    select count(*)
    from public.room_members
    where room_id = current_setting('commandcanvas.test_room_id')::uuid
  ) <> 1 then
    raise exception 'rls_member_self_only_failed';
  end if;

  if (
       select count(*)
       from public.meeting_packets
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
     or (
       select count(*)
       from public.packet_send_requests
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
     or (
       select count(*)
       from public.outbound_shares
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
  then
    raise exception 'rls_host_packet_read_failed';
  end if;

  begin
    update public.canvas_objects
    set title = 'forbidden direct write'
    where id = current_setting('commandcanvas.test_object_id');
    raise exception 'rls_authenticated_canvas_write_succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.receipts (
      room_id,
      revision,
      actor_user_id,
      actor_type,
      source,
      actor_display_name,
      action,
      description
    ) values (
      current_setting('commandcanvas.test_room_id')::uuid,
      2,
      current_setting('commandcanvas.test_host_user_id')::uuid,
      'human',
      'system',
      'Host probe',
      'tamper',
      'This insert must be rejected.'
    );
    raise exception 'rls_authenticated_receipt_write_succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', :'participant_user_id',
    'role', 'authenticated',
    'is_anonymous', true
  )::text,
  true
);
set local role authenticated;

do $$
begin
  if (
       select count(*)
       from public.rooms
       where id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
     or (
       select count(*)
       from public.canvas_objects
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
     or (
       select count(*)
       from public.receipts
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
  then
    raise exception 'rls_participant_member_state_read_failed';
  end if;

  if (
       select count(*)
       from public.meeting_packets
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 0
     or (
       select count(*)
       from public.packet_send_requests
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 0
     or (
       select count(*)
       from public.outbound_shares
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 0
  then
    raise exception 'rls_participant_packet_data_leaked';
  end if;
end;
$$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', :'outsider_user_id',
    'role', 'authenticated',
    'is_anonymous', true
  )::text,
  true
);
set local role authenticated;

do $$
begin
  if (
       select count(*)
       from public.rooms
       where id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 0
     or (
       select count(*)
       from public.canvas_objects
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 0
     or (
       select count(*)
       from public.receipts
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 0
     or (
       select count(*)
       from public.meeting_packets
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 0
  then
    raise exception 'rls_cross_room_data_leaked';
  end if;
end;
$$;

reset role;
do $$
begin
  update public.meeting_packets
  set title = 'Edited packet returns to draft'
  where id = current_setting('commandcanvas.test_packet_id');

  if not exists (
    select 1
    from public.meeting_packets packet
    where packet.id = current_setting('commandcanvas.test_packet_id')
      and packet.status = 'draft'
      and packet.recipient_snapshot is null
      and packet.recipient_snapshot_hash is null
      and packet.approved_content_hash is null
      and packet.approved_by is null
      and packet.approved_at is null
  ) then
    raise exception 'packet_approval_invalidation_failed';
  end if;

  raise notice 'rls_adversarial_probes_passed';
end;
$$;
rollback;
