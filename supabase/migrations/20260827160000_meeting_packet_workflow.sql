begin;

-- Packet hashes are calculated from jsonb's canonical text representation.
-- Browser and agent callers never supply these hashes.
create or replace function private.canonical_jsonb_sha256(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_value::text, 'UTF8')),
    'hex'
  );
$$;

revoke execute on function private.canonical_jsonb_sha256(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.normalize_packet_recipients(
  p_recipients jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_name text;
  v_email text;
  v_normalized jsonb;
begin
  if p_recipients is null
     or pg_catalog.jsonb_typeof(p_recipients) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_recipients) > 10
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_recipient_list_invalid';
  end if;

  for v_entry in
    select recipient.value
    from pg_catalog.jsonb_array_elements(p_recipients) as recipient(value)
  loop
    if pg_catalog.jsonb_typeof(v_entry) is distinct from 'object'
       or (select pg_catalog.count(*)
           from pg_catalog.jsonb_object_keys(v_entry)) <> 2
       or not (v_entry ?& array['name', 'email'])
       or pg_catalog.jsonb_typeof(v_entry -> 'name') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_entry -> 'email') is distinct from 'string'
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_recipient_shape_invalid';
    end if;

    v_name := pg_catalog.btrim(v_entry ->> 'name');
    v_email := pg_catalog.lower(pg_catalog.btrim(v_entry ->> 'email'));

    if pg_catalog.char_length(v_name) not between 1 and 80 then
      raise exception using
        errcode = 'P0001',
        message = 'packet_recipient_name_invalid';
    end if;

    if pg_catalog.char_length(v_email) not between 3 and 254
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_recipient_email_invalid';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select pg_catalog.lower(pg_catalog.btrim(recipient.value ->> 'email'))
        as email
      from pg_catalog.jsonb_array_elements(p_recipients) as recipient(value)
    ) normalized
    group by normalized.email
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'packet_recipient_duplicate_email';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', normalized.name,
        'email', normalized.email
      )
      order by normalized.email, normalized.name
    ),
    '[]'::jsonb
  )
  into v_normalized
  from (
    select
      pg_catalog.btrim(recipient.value ->> 'name') as name,
      pg_catalog.lower(pg_catalog.btrim(recipient.value ->> 'email')) as email
    from pg_catalog.jsonb_array_elements(p_recipients) as recipient(value)
  ) normalized;

  return v_normalized;
end;
$$;

revoke execute on function private.normalize_packet_recipients(jsonb)
  from public, anon, authenticated, service_role;

-- Replace the original trigger only after the approved snapshot column exists.
drop trigger meeting_packets_invalidate_approval on public.meeting_packets;

alter table public.meeting_packets
  add column approved_content_snapshot jsonb;

alter table public.packet_send_requests
  add column content_snapshot jsonb;

-- The initial send graph used RESTRICT from outbound shares back to both
-- parents. That made a room-owned cascade impossible once any preview or send
-- existed. The composite covering index was added in the room-access
-- migration, so both relationships can safely follow the room-owned cascade.
alter table public.outbound_shares
  drop constraint outbound_shares_room_id_packet_id_fkey,
  drop constraint outbound_shares_room_id_packet_id_send_request_id_fkey;

alter table public.outbound_shares
  add constraint outbound_shares_room_id_packet_id_fkey
    foreign key (room_id, packet_id)
    references public.meeting_packets(room_id, id)
    on delete cascade,
  add constraint outbound_shares_room_id_packet_id_send_request_id_fkey
    foreign key (room_id, packet_id, send_request_id)
    references public.packet_send_requests(room_id, packet_id, id)
    on delete cascade;

update public.meeting_packets packet
set recipient_draft = private.normalize_packet_recipients(packet.recipient_draft);

update public.meeting_packets packet
set
  recipient_snapshot = private.normalize_packet_recipients(
    packet.recipient_snapshot
  ),
  recipient_snapshot_hash = private.canonical_jsonb_sha256(
    private.normalize_packet_recipients(packet.recipient_snapshot)
  ),
  approved_content_snapshot = pg_catalog.jsonb_build_object(
    'title', packet.title,
    'content', packet.content
  ),
  approved_content_hash = private.canonical_jsonb_sha256(
    pg_catalog.jsonb_build_object(
      'title', packet.title,
      'content', packet.content
    )
  )
where packet.status = 'approved';

update public.packet_send_requests request
set content_snapshot = pg_catalog.jsonb_build_object(
  'title', packet.title,
  'content', packet.content
)
from public.meeting_packets packet
where packet.room_id = request.room_id
  and packet.id = request.packet_id;

alter table public.packet_send_requests
  alter column content_snapshot set not null;

alter table public.meeting_packets
  add constraint meeting_packets_approval_snapshot_exact
  check (
    (
      status = 'draft'
      and approved_content_snapshot is null
      and recipient_snapshot is null
      and recipient_snapshot_hash is null
      and approved_content_hash is null
      and approved_by is null
      and approved_at is null
    )
    or
    (
      status = 'approved'
      and approved_content_snapshot = pg_catalog.jsonb_build_object(
        'title', title,
        'content', content
      )
      and approved_content_hash = private.canonical_jsonb_sha256(
        approved_content_snapshot
      )
      and recipient_snapshot = private.normalize_packet_recipients(
        recipient_snapshot
      )
      and pg_catalog.jsonb_array_length(recipient_snapshot) between 1 and 10
      and recipient_snapshot_hash = private.canonical_jsonb_sha256(
        recipient_snapshot
      )
      and approved_by is not null
      and approved_at is not null
    )
  );

alter table public.packet_send_requests
  add constraint packet_send_requests_snapshot_exact
  check (
    packet_content_hash = private.canonical_jsonb_sha256(content_snapshot)
    and recipient_snapshot = private.normalize_packet_recipients(
      recipient_snapshot
    )
    and pg_catalog.jsonb_array_length(recipient_snapshot) between 1 and 10
    and recipient_snapshot_hash = private.canonical_jsonb_sha256(
      recipient_snapshot
    )
  );

alter table public.packet_send_requests
  add constraint packet_send_requests_lifecycle_valid
  check (
    (
      status = 'awaiting_human_approval'
      and authorized_by_user_id is null
      and authorized_at is null
      and completed_at is null
      and last_error_code is null
    )
    or
    (
      status = 'sending'
      and authorized_by_user_id is not null
      and authorized_at is not null
      and completed_at is null
      and last_error_code is null
    )
    or
    (
      status in ('sent', 'preview_only')
      and authorized_by_user_id is not null
      and authorized_at is not null
      and completed_at is not null
      and last_error_code is null
    )
    or
    (
      status = 'failed'
      and authorized_by_user_id is not null
      and authorized_at is not null
      and completed_at is not null
      and last_error_code is not null
    )
    or status in ('cancelled', 'expired')
  );

create or replace function private.invalidate_packet_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved'
     and new.status = 'approved'
     and (
       new.recipient_snapshot is distinct from old.recipient_snapshot
       or new.recipient_snapshot_hash is distinct from old.recipient_snapshot_hash
       or new.approved_content_snapshot
         is distinct from old.approved_content_snapshot
       or new.approved_content_hash is distinct from old.approved_content_hash
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_approved_snapshot_immutable';
  end if;

  if old.status = 'approved'
     and (
       new.content is distinct from old.content
       or new.recipient_draft is distinct from old.recipient_draft
       or new.title is distinct from old.title
     )
  then
    new.status := 'draft';
    new.recipient_snapshot := null;
    new.recipient_snapshot_hash := null;
    new.approved_content_snapshot := null;
    new.approved_content_hash := null;
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

revoke execute on function private.invalidate_packet_approval()
  from public, anon, authenticated, service_role;

create trigger meeting_packets_invalidate_approval
before update on public.meeting_packets
for each row execute function private.invalidate_packet_approval();

create table public.packet_activity_receipts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  activity_revision bigint not null check (activity_revision >= 1),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  actor_type text not null
    check (actor_type in ('human', 'agent', 'system')),
  actor_display_name text not null
    check (pg_catalog.char_length(actor_display_name) between 1 and 80),
  action text not null
    check (
      pg_catalog.char_length(action) between 1 and 80
      and action ~ '^[a-z][a-z0-9_]*$'
    ),
  packet_id text not null
    check (
      pg_catalog.char_length(packet_id) between 2 and 96
      and packet_id ~ '^[a-z][a-z0-9-]*$'
    ),
  send_request_id uuid,
  resulting_state jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(resulting_state) = 'object'),
  description text not null
    check (pg_catalog.char_length(description) between 1 and 280),
  unique (room_id, activity_revision)
);

create index packet_activity_receipts_room_revision_idx
  on public.packet_activity_receipts(room_id, activity_revision desc);

create index packet_activity_receipts_room_packet_idx
  on public.packet_activity_receipts(room_id, packet_id, activity_revision desc);

create or replace function private.reject_packet_activity_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and tg_table_schema = 'public'
     and tg_table_name = 'packet_activity_receipts'
     and pg_catalog.pg_trigger_depth() > 1
     and not exists (
       select 1
       from public.rooms room_row
       where room_row.id = old.room_id
     )
  then
    return old;
  end if;

  raise exception using
    errcode = '55000',
    message = 'packet activity receipts are immutable';
end;
$$;

revoke execute on function private.reject_packet_activity_mutation()
  from public, anon, authenticated, service_role;

create trigger packet_activity_receipts_are_immutable
before update or delete on public.packet_activity_receipts
for each row execute function private.reject_packet_activity_mutation();

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

revoke execute on function private.assert_packet_host(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.append_packet_activity(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_actor_display_name text,
  p_action text,
  p_packet_id text,
  p_send_request_id uuid,
  p_resulting_state jsonb,
  p_description text
)
returns public.packet_activity_receipts
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_activity_revision bigint;
  v_receipt public.packet_activity_receipts%rowtype;
begin
  if p_actor_type not in ('human', 'agent', 'system')
     or p_action is null
     or p_action !~ '^[a-z][a-z0-9_]*$'
     or pg_catalog.char_length(p_action) not between 1 and 80
     or p_resulting_state is null
     or pg_catalog.jsonb_typeof(p_resulting_state) is distinct from 'object'
     or p_description is null
     or pg_catalog.char_length(pg_catalog.btrim(p_description))
       not between 1 and 280
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_activity_invalid';
  end if;

  select coalesce(
    pg_catalog.max(receipt.activity_revision),
    0
  ) + 1
  into v_activity_revision
  from public.packet_activity_receipts receipt
  where receipt.room_id = p_room_id;

  insert into public.packet_activity_receipts (
    room_id,
    activity_revision,
    actor_user_id,
    actor_type,
    actor_display_name,
    action,
    packet_id,
    send_request_id,
    resulting_state,
    description
  ) values (
    p_room_id,
    v_activity_revision,
    p_actor_user_id,
    p_actor_type,
    case p_actor_type
      when 'agent' then 'ChatGPT via WebMCP'
      when 'system' then 'CommandCanvas'
      else p_actor_display_name
    end,
    p_action,
    p_packet_id,
    p_send_request_id,
    p_resulting_state,
    pg_catalog.btrim(p_description)
  )
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke execute on function private.append_packet_activity(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) from public, anon, authenticated, service_role;

create or replace function public.prepare_meeting_packet_draft(
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
  v_host_display_name text;
  v_room_name text;
  v_source_revision bigint;
  v_packet_version integer;
  v_objects jsonb;
  v_content jsonb;
  v_title text;
  v_selected_count integer;
  v_matched_count integer;
begin
  v_host_display_name := private.assert_packet_host(
    p_room_id,
    p_host_user_id
  );

  if p_packet_id is null
     or pg_catalog.char_length(p_packet_id) not between 2 and 96
     or p_packet_id !~ '^[a-z][a-z0-9-]*$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_id_invalid';
  end if;

  if p_actor_type not in ('human', 'agent') then
    raise exception using
      errcode = 'P0001',
      message = 'packet_actor_type_invalid';
  end if;

  select room_row.name, room_row.revision
  into strict v_room_name, v_source_revision
  from public.rooms room_row
  where room_row.id = p_room_id;

  v_title := case
    when p_title is null then v_room_name || ' meeting packet'
    else pg_catalog.btrim(p_title)
  end;

  if pg_catalog.char_length(v_title) not between 1 and 160 then
    raise exception using
      errcode = 'P0001',
      message = 'packet_title_invalid';
  end if;

  if p_selected_object_ids is not null then
    v_selected_count := pg_catalog.cardinality(p_selected_object_ids);

    if v_selected_count = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'packet_content_required';
    end if;

    if v_selected_count > 50
       or exists (
         select 1
         from pg_catalog.unnest(p_selected_object_ids) selected(object_id)
         where selected.object_id is null
           or pg_catalog.char_length(selected.object_id) not between 2 and 96
           or selected.object_id !~ '^[a-z][a-z0-9-]*$'
       )
       or v_selected_count <> (
         select pg_catalog.count(distinct selected.object_id)
         from pg_catalog.unnest(p_selected_object_ids) selected(object_id)
       )
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_selected_object_invalid';
    end if;

    select pg_catalog.count(*)
    into v_matched_count
    from public.canvas_objects object_row
    where object_row.room_id = p_room_id
      and object_row.id = any(p_selected_object_ids)
      and object_row.deleted_at is null
      and object_row.object_type in (
        'note', 'task_board', 'schedule', 'diagram'
      );

    if v_matched_count <> v_selected_count then
      raise exception using
        errcode = 'P0001',
        message = 'packet_selected_object_invalid';
    end if;
  end if;

  select coalesce(
    pg_catalog.max(packet.packet_version),
    0
  ) + 1
  into v_packet_version
  from public.meeting_packets packet
  where packet.room_id = p_room_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'objectId', object_row.id,
        'objectType', object_row.object_type,
        'title', object_row.title,
        'payload', object_row.payload
      )
      order by object_row.object_type,
               pg_catalog.lower(object_row.title),
               object_row.id
    ),
    '[]'::jsonb
  )
  into v_objects
  from public.canvas_objects object_row
  where object_row.room_id = p_room_id
    and object_row.deleted_at is null
    and object_row.object_type in (
      'note', 'task_board', 'schedule', 'diagram'
    )
    and (
      p_selected_object_ids is null
      or object_row.id = any(p_selected_object_ids)
    );

  if pg_catalog.jsonb_array_length(v_objects) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'packet_content_required';
  end if;

  v_content := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'roomName', v_room_name,
    'sourceRevision', v_source_revision,
    'objects', v_objects
  );

  insert into public.meeting_packets (
    id,
    room_id,
    packet_version,
    source_revision,
    status,
    title,
    content,
    recipient_draft,
    created_by
  ) values (
    p_packet_id,
    p_room_id,
    v_packet_version,
    v_source_revision,
    'draft',
    v_title,
    v_content,
    '[]'::jsonb,
    p_host_user_id
  );

  perform private.append_packet_activity(
    p_room_id,
    p_host_user_id,
    p_actor_type,
    v_host_display_name,
    'packet_prepared',
    p_packet_id,
    null,
    pg_catalog.jsonb_build_object(
      'status', 'draft',
      'packetVersion', v_packet_version,
      'sourceRevision', v_source_revision,
      'objectCount', pg_catalog.jsonb_array_length(v_objects)
    ),
    case p_actor_type
      when 'agent' then 'ChatGPT prepared a meeting packet draft.'
      else v_host_display_name || ' prepared a meeting packet draft.'
    end
  );

  return pg_catalog.jsonb_build_object(
    'packetId', p_packet_id,
    'packetVersion', v_packet_version,
    'sourceRevision', v_source_revision,
    'status', 'draft',
    'title', v_title,
    'objectCount', pg_catalog.jsonb_array_length(v_objects)
  );
end;
$$;

create or replace function public.update_meeting_packet_draft(
  p_room_id uuid,
  p_packet_id text,
  p_host_user_id uuid,
  p_title text,
  p_recipient_draft jsonb
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
  v_title text;
  v_recipients jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_host_display_name := private.assert_packet_host(
    p_room_id,
    p_host_user_id
  );

  v_title := pg_catalog.btrim(p_title);
  if p_title is null
     or pg_catalog.char_length(v_title) not between 1 and 160
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_title_invalid';
  end if;

  v_recipients := private.normalize_packet_recipients(p_recipient_draft);

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

  if v_packet.title = v_title
     and v_packet.recipient_draft = v_recipients
  then
    return pg_catalog.jsonb_build_object(
      'packetId', p_packet_id,
      'status', v_packet.status,
      'recipientCount', pg_catalog.jsonb_array_length(v_recipients),
      'changed', false
    );
  end if;

  update public.meeting_packets
  set
    title = v_title,
    recipient_draft = v_recipients,
    status = 'draft',
    recipient_snapshot = null,
    recipient_snapshot_hash = null,
    approved_content_snapshot = null,
    approved_content_hash = null,
    approved_by = null,
    approved_at = null
  where room_id = p_room_id
    and id = p_packet_id;

  update public.packet_send_requests
  set
    status = 'expired',
    completed_at = v_now,
    last_error_code = 'packet_changed_after_staging'
  where room_id = p_room_id
    and packet_id = p_packet_id
    and status = 'awaiting_human_approval';

  perform private.append_packet_activity(
    p_room_id,
    p_host_user_id,
    'human',
    v_host_display_name,
    'packet_draft_updated',
    p_packet_id,
    null,
    pg_catalog.jsonb_build_object(
      'status', 'draft',
      'recipientCount', pg_catalog.jsonb_array_length(v_recipients)
    ),
    v_host_display_name || ' updated the packet draft.'
  );

  return pg_catalog.jsonb_build_object(
    'packetId', p_packet_id,
    'status', 'draft',
    'recipientCount', pg_catalog.jsonb_array_length(v_recipients),
    'changed', true
  );
end;
$$;

create or replace function public.approve_meeting_packet(
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
  v_host_display_name text;
  v_packet public.meeting_packets%rowtype;
  v_content_snapshot jsonb;
  v_content_hash text;
  v_recipients jsonb;
  v_recipient_hash text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_host_display_name := private.assert_packet_host(
    p_room_id,
    p_host_user_id
  );

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

  v_recipients := private.normalize_packet_recipients(
    v_packet.recipient_draft
  );

  if pg_catalog.jsonb_array_length(v_recipients) < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'packet_recipient_required';
  end if;

  v_content_snapshot := pg_catalog.jsonb_build_object(
    'title', v_packet.title,
    'content', v_packet.content
  );
  v_content_hash := private.canonical_jsonb_sha256(v_content_snapshot);
  v_recipient_hash := private.canonical_jsonb_sha256(v_recipients);

  if v_packet.status = 'approved' then
    if v_packet.approved_content_snapshot <> v_content_snapshot
       or v_packet.approved_content_hash <> v_content_hash
       or v_packet.recipient_snapshot <> v_recipients
       or v_packet.recipient_snapshot_hash <> v_recipient_hash
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_approved_snapshot_conflict';
    end if;

    return pg_catalog.jsonb_build_object(
      'packetId', p_packet_id,
      'status', 'approved',
      'contentHash', v_content_hash,
      'recipientHash', v_recipient_hash,
      'recipientCount', pg_catalog.jsonb_array_length(v_recipients),
      'changed', false
    );
  end if;

  update public.meeting_packets
  set
    status = 'approved',
    recipient_snapshot = v_recipients,
    recipient_snapshot_hash = v_recipient_hash,
    approved_content_snapshot = v_content_snapshot,
    approved_content_hash = v_content_hash,
    approved_by = p_host_user_id,
    approved_at = v_now
  where room_id = p_room_id
    and id = p_packet_id;

  perform private.append_packet_activity(
    p_room_id,
    p_host_user_id,
    'human',
    v_host_display_name,
    'packet_approved',
    p_packet_id,
    null,
    pg_catalog.jsonb_build_object(
      'status', 'approved',
      'contentHash', v_content_hash,
      'recipientHash', v_recipient_hash,
      'recipientCount', pg_catalog.jsonb_array_length(v_recipients)
    ),
    v_host_display_name || ' approved the exact meeting packet snapshot.'
  );

  return pg_catalog.jsonb_build_object(
    'packetId', p_packet_id,
    'status', 'approved',
    'contentHash', v_content_hash,
    'recipientHash', v_recipient_hash,
    'recipientCount', pg_catalog.jsonb_array_length(v_recipients),
    'changed', true
  );
end;
$$;

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
  v_inserted integer;
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

  v_idempotency_key := 'commandcanvas:' || pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        p_room_id::text || ':' || p_packet_id || ':'
          || v_packet.packet_version::text || ':'
          || v_packet.approved_content_hash || ':'
          || v_packet.recipient_snapshot_hash,
        'UTF8'
      )
    ),
    'hex'
  );

  if exists (
    select 1
    from public.packet_send_requests request
    where request.id = p_send_request_id
      and request.idempotency_key <> v_idempotency_key
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_stage_conflict';
  end if;

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
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;

  select request.*
  into strict v_existing
  from public.packet_send_requests request
  where request.idempotency_key = v_idempotency_key;

  if v_existing.room_id <> p_room_id
     or v_existing.packet_id <> p_packet_id
     or v_existing.packet_version <> v_packet.packet_version
     or v_existing.content_snapshot <> v_packet.approved_content_snapshot
     or v_existing.packet_content_hash <> v_packet.approved_content_hash
     or v_existing.recipient_snapshot <> v_packet.recipient_snapshot
     or v_existing.recipient_snapshot_hash <> v_packet.recipient_snapshot_hash
     or v_existing.requested_by_user_id <> p_host_user_id
     or v_existing.idempotency_key <> v_idempotency_key
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_stage_conflict';
  end if;

  if v_inserted = 1 then
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
        )
      ),
      case p_requested_by_actor_type
        when 'agent' then 'ChatGPT requested approval to send the packet.'
        else v_host_display_name || ' staged the packet for approval.'
      end
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'sendRequestId', v_existing.id,
    'packetId', p_packet_id,
    'status', v_existing.status,
    'idempotencyKey', v_idempotency_key,
    'recipientCount', pg_catalog.jsonb_array_length(
      v_existing.recipient_snapshot
    ),
    'staged', true,
    'changed', v_inserted = 1
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
  v_host_display_name := private.assert_packet_host(
    p_room_id,
    p_host_user_id
  );

  if p_delivery_mode not in ('preview', 'resend') then
    raise exception using
      errcode = 'P0001',
      message = 'packet_delivery_mode_invalid';
  end if;

  if p_outbound_share_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'packet_outbound_share_id_required';
  end if;

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

  if v_request.status = 'expired' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', coalesce(
        v_request.last_error_code,
        'packet_send_request_expired'
      ),
      'sendRequestId', v_request.id,
      'status', 'expired',
      'changed', false
    );
  end if;

  if v_request.status in ('sending', 'sent', 'failed', 'preview_only') then
    select share.*
    into strict v_share
    from public.outbound_shares share
    where share.room_id = p_room_id
      and share.send_request_id = p_send_request_id;

    if v_share.provider <> p_delivery_mode
       or v_share.id <> p_outbound_share_id
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_send_authorization_conflict';
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
      'changed', false
    );
  end if;

  if v_request.status <> 'awaiting_human_approval' then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_request_expired';
  end if;

  if v_request.expires_at <= v_now then
    update public.packet_send_requests
    set
      status = 'expired',
      completed_at = v_now,
      last_error_code = 'packet_send_request_expired'
    where room_id = p_room_id
      and id = v_request.id;

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
    update public.packet_send_requests
    set
      status = 'expired',
      completed_at = v_now,
      last_error_code = 'packet_send_stale'
    where room_id = p_room_id
      and id = v_request.id;

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

  update public.packet_send_requests
  set
    status = v_request_status,
    authorized_by_user_id = p_host_user_id,
    authorized_at = v_now,
    completed_at = case p_delivery_mode
      when 'preview' then v_now
      else null
    end,
    last_error_code = null
  where room_id = p_room_id
    and id = p_send_request_id;

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
      'recipientCount', pg_catalog.jsonb_array_length(
        v_request.recipient_snapshot
      )
    ),
    case p_delivery_mode
      when 'preview' then
        v_host_display_name || ' opened the honest email preview.'
      else
        v_host_display_name || ' authorized submission to Resend.'
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
  v_expected_status text;
  v_provider_message_id text;
  v_error_code text;
begin
  v_host_display_name := private.assert_packet_host(
    p_room_id,
    p_host_user_id
  );

  if p_outcome not in ('sent', 'failed') then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_outcome_invalid';
  end if;

  v_provider_message_id := nullif(
    pg_catalog.btrim(p_provider_message_id),
    ''
  );
  v_error_code := nullif(pg_catalog.btrim(p_error_code), '');

  if (p_outcome = 'sent' and (
        v_provider_message_id is null or v_error_code is not null
      ))
     or (p_outcome = 'failed' and (
       v_provider_message_id is not null or v_error_code is null
     ))
  then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_completion_invalid';
  end if;

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

  select share.*
  into v_share
  from public.outbound_shares share
  where share.room_id = p_room_id
    and share.send_request_id = p_send_request_id
  for update;

  if not found or v_share.provider <> 'resend' then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_reservation_not_found';
  end if;

  v_expected_status := p_outcome;

  if v_request.status in ('sent', 'failed') then
    if v_request.status <> v_expected_status
       or v_share.status <> v_expected_status
       or v_share.provider_message_id
         is distinct from v_provider_message_id
       or v_share.error_code is distinct from v_error_code
       or v_request.last_error_code is distinct from v_error_code
    then
      raise exception using
        errcode = 'P0001',
        message = 'packet_send_completion_conflict';
    end if;

    return pg_catalog.jsonb_build_object(
      'sendRequestId', p_send_request_id,
      'outboundShareId', v_share.id,
      'status', v_request.status,
      'provider', 'resend',
      'providerMessageId', v_provider_message_id,
      'changed', false
    );
  end if;

  if v_request.status <> 'sending' or v_share.status <> 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'packet_send_completion_conflict';
  end if;

  update public.outbound_shares
  set
    status = v_expected_status,
    provider_message_id = v_provider_message_id,
    completed_at = v_now,
    error_code = v_error_code
  where id = v_share.id;

  update public.packet_send_requests
  set
    status = v_expected_status,
    completed_at = v_now,
    last_error_code = v_error_code
  where room_id = p_room_id
    and id = p_send_request_id;

  perform private.append_packet_activity(
    p_room_id,
    null,
    'system',
    v_host_display_name,
    case p_outcome
      when 'sent' then 'packet_send_submitted'
      else 'packet_send_failed'
    end,
    v_request.packet_id,
    p_send_request_id,
    pg_catalog.jsonb_build_object(
      'status', v_expected_status,
      'provider', 'resend',
      'providerMessageId', v_provider_message_id,
      'errorCode', v_error_code
    ),
    case p_outcome
      when 'sent' then 'Resend accepted the packet; delivery is pending.'
      else 'Resend did not accept the packet.'
    end
  );

  return pg_catalog.jsonb_build_object(
    'sendRequestId', p_send_request_id,
    'outboundShareId', v_share.id,
    'status', v_expected_status,
    'provider', 'resend',
    'providerMessageId', v_provider_message_id,
    'changed', true
  );
end;
$$;

-- Stable packet state is readable only by the room host. Mutations remain
-- server-only through the SECURITY DEFINER RPCs above.
alter table public.packet_activity_receipts enable row level security;

revoke all on table public.packet_activity_receipts
  from public, anon, authenticated;

grant select on table public.packet_activity_receipts to authenticated;
grant select, insert on table public.packet_activity_receipts to service_role;

create policy packet_activity_receipts_select_host
on public.packet_activity_receipts
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.room_id = packet_activity_receipts.room_id
      and member.user_id = (select auth.uid())
      and member.role = 'host'
  )
);

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

revoke execute on function public.update_meeting_packet_draft(
  uuid,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.update_meeting_packet_draft(
  uuid,
  text,
  uuid,
  text,
  jsonb
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

revoke execute on function public.authorize_meeting_packet_send(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.authorize_meeting_packet_send(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) to service_role;

revoke execute on function public.complete_meeting_packet_send(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.complete_meeting_packet_send(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
) to service_role;

commit;
