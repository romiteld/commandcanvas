begin;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (
      char_length(slug) between 12 and 96
      and slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
    ),
  name text not null check (char_length(name) between 1 and 120),
  mode text not null default 'standard'
    check (mode in ('standard', 'demo')),
  revision bigint not null default 0 check (revision >= 0),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host', 'participant')),
  display_name text not null check (char_length(display_name) between 1 and 64),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  joined_at timestamptz not null default clock_timestamp(),
  primary key (room_id, user_id)
);

create unique index room_members_one_host_per_room_idx
  on public.room_members(room_id)
  where role = 'host';

create index room_members_user_room_idx
  on public.room_members(user_id, room_id, role);

create table public.canvas_objects (
  id text primary key
    check (
      char_length(id) between 2 and 96
      and id ~ '^[a-z][a-z0-9-]*$'
    ),
  room_id uuid not null references public.rooms(id) on delete cascade,
  object_type text not null
    check (object_type in ('note', 'task_board', 'schedule', 'sketch', 'diagram')),
  title text not null check (char_length(title) between 1 and 120),
  x double precision not null check (x between -1000000 and 1000000),
  y double precision not null check (y between -1000000 and 1000000),
  width double precision not null check (width between 160 and 2000),
  height double precision not null check (height between 80 and 1400),
  z_index integer not null default 0 check (z_index between 0 and 100000),
  minimized boolean not null default false,
  pinned boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  version bigint not null check (version >= 1),
  revision bigint not null check (revision >= 1),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object')
);

create index canvas_objects_room_revision_idx
  on public.canvas_objects(room_id, revision desc);

create index canvas_objects_active_z_idx
  on public.canvas_objects(room_id, z_index, id)
  where deleted_at is null;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  revision bigint not null check (revision >= 1),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid not null,
  actor_type text not null check (actor_type in ('human', 'participant', 'agent')),
  actor_display_name text not null
    check (char_length(actor_display_name) between 1 and 80),
  action text not null
    check (
      char_length(action) between 1 and 80
      and action ~ '^[a-z][a-z0-9_]*$'
    ),
  affected_object_ids text[] not null default '{}'::text[],
  previous_state jsonb not null default '[]'::jsonb
    check (jsonb_typeof(previous_state) = 'array'),
  resulting_state jsonb not null default '[]'::jsonb
    check (jsonb_typeof(resulting_state) = 'array'),
  inverse_command jsonb,
  reversible boolean not null default true,
  undoes_receipt_id uuid references public.receipts(id) on delete restrict,
  description text not null check (char_length(description) between 1 and 280),
  unique (room_id, revision)
);

create index receipts_room_revision_idx
  on public.receipts(room_id, revision desc);

create unique index receipts_one_undo_per_target_idx
  on public.receipts(undoes_receipt_id)
  where undoes_receipt_id is not null;

create table public.meeting_packets (
  id text primary key
    check (
      char_length(id) between 2 and 96
      and id ~ '^[a-z][a-z0-9-]*$'
    ),
  room_id uuid not null references public.rooms(id) on delete cascade,
  packet_version integer not null check (packet_version >= 1),
  source_revision bigint not null check (source_revision >= 0),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  title text not null check (char_length(title) between 1 and 160),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  recipient_draft jsonb not null default '[]'::jsonb
    check (
      case
        when jsonb_typeof(recipient_draft) = 'array'
          then jsonb_array_length(recipient_draft) <= 10
        else false
      end
    ),
  recipient_snapshot jsonb,
  recipient_snapshot_hash text,
  approved_content_hash text,
  created_by uuid not null,
  approved_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  unique (room_id, packet_version),
  unique (room_id, id),
  check (
    (
      status = 'draft'
      and recipient_snapshot is null
      and recipient_snapshot_hash is null
      and approved_content_hash is null
      and approved_by is null
      and approved_at is null
    )
    or
    (
      status = 'approved'
      and case
        when jsonb_typeof(recipient_snapshot) = 'array'
          then jsonb_array_length(recipient_snapshot) between 1 and 10
        else false
      end
      and recipient_snapshot_hash is not null
      and recipient_snapshot_hash ~ '^[0-9a-f]{64}$'
      and approved_content_hash is not null
      and approved_content_hash ~ '^[0-9a-f]{64}$'
      and approved_by is not null
      and approved_at is not null
    )
  )
);

create index meeting_packets_room_version_idx
  on public.meeting_packets(room_id, packet_version desc);

create index meeting_packets_approved_idx
  on public.meeting_packets(room_id, approved_at desc)
  where status = 'approved';

create table public.packet_send_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  packet_id text not null,
  packet_version integer not null check (packet_version >= 1),
  packet_content_hash text not null check (packet_content_hash ~ '^[0-9a-f]{64}$'),
  recipient_snapshot jsonb not null
    check (
      case
        when jsonb_typeof(recipient_snapshot) = 'array'
          then jsonb_array_length(recipient_snapshot) between 1 and 10
        else false
      end
    ),
  recipient_snapshot_hash text not null
    check (recipient_snapshot_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'awaiting_human_approval'
    check (
      status in (
        'awaiting_human_approval',
        'sending',
        'sent',
        'cancelled',
        'failed',
        'preview_only',
        'expired'
      )
    ),
  requested_by_user_id uuid not null,
  requested_by_actor_type text not null
    check (requested_by_actor_type in ('human', 'agent')),
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  authorized_by_user_id uuid,
  authorized_at timestamptz,
  completed_at timestamptz,
  idempotency_key text not null unique
    check (char_length(idempotency_key) between 16 and 180),
  last_error_code text,
  foreign key (room_id, packet_id)
    references public.meeting_packets(room_id, id)
    on delete cascade,
  unique (room_id, packet_id, id),
  check (expires_at > requested_at)
);

create index packet_send_requests_pending_idx
  on public.packet_send_requests(room_id, requested_at desc)
  where status = 'awaiting_human_approval';

create table public.outbound_shares (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  packet_id text not null,
  send_request_id uuid not null,
  provider text not null check (provider in ('resend', 'preview')),
  status text not null check (status in ('pending', 'sent', 'failed', 'preview_only')),
  recipient_snapshot jsonb not null
    check (
      case
        when jsonb_typeof(recipient_snapshot) = 'array'
          then jsonb_array_length(recipient_snapshot) between 1 and 10
        else false
      end
    ),
  subject text not null check (char_length(subject) between 1 and 200),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  provider_message_id text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  error_code text,
  foreign key (room_id, packet_id)
    references public.meeting_packets(room_id, id)
    on delete restrict,
  foreign key (room_id, packet_id, send_request_id)
    references public.packet_send_requests(room_id, packet_id, id)
    on delete restrict,
  unique (send_request_id)
);

create index outbound_shares_room_created_idx
  on public.outbound_shares(room_id, created_at desc);

create unique index outbound_shares_provider_message_idx
  on public.outbound_shares(provider, provider_message_id)
  where provider_message_id is not null;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at()
  from public, anon, authenticated;

create trigger rooms_touch_updated_at
before update on public.rooms
for each row execute function private.touch_updated_at();

create trigger canvas_objects_touch_updated_at
before update on public.canvas_objects
for each row execute function private.touch_updated_at();

create trigger meeting_packets_touch_updated_at
before update on public.meeting_packets
for each row execute function private.touch_updated_at();

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
    new.approved_content_hash := null;
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

revoke execute on function private.invalidate_packet_approval()
  from public, anon, authenticated;

create trigger meeting_packets_invalidate_approval
before update on public.meeting_packets
for each row execute function private.invalidate_packet_approval();

create or replace function private.reject_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'receipts are immutable';
end;
$$;

revoke execute on function private.reject_receipt_mutation()
  from public, anon, authenticated;

create trigger receipts_are_immutable
before update or delete on public.receipts
for each row execute function private.reject_receipt_mutation();

create or replace function private.broadcast_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'receiptId', new.id,
      'revision', new.revision,
      'action', new.action,
      'affectedObjectIds', to_jsonb(new.affected_object_ids)
    ),
    'room_revision_committed',
    'room:' || new.room_id::text,
    true
  );

  return new;
end;
$$;

revoke execute on function private.broadcast_receipt()
  from public, anon, authenticated;

create trigger receipts_broadcast_after_insert
after insert on public.receipts
for each row execute function private.broadcast_receipt();

create or replace function private.canvas_object_state(
  p_object public.canvas_objects
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_object.id,
    'roomId', p_object.room_id,
    'type', p_object.object_type,
    'title', p_object.title,
    'x', p_object.x,
    'y', p_object.y,
    'width', p_object.width,
    'height', p_object.height,
    'zIndex', p_object.z_index,
    'minimized', p_object.minimized,
    'pinned', p_object.pinned,
    'createdBy', p_object.created_by,
    'createdAt', p_object.created_at,
    'updatedAt', p_object.updated_at,
    'deletedAt', p_object.deleted_at,
    'version', p_object.version,
    'revision', p_object.revision,
    'metadata', p_object.metadata,
    'payload', p_object.payload
  );
$$;

revoke execute on function private.canvas_object_state(public.canvas_objects)
  from public, anon, authenticated;

create or replace function private.canvas_object_mutable_state(
  p_object public.canvas_objects
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'type', p_object.object_type,
    'title', p_object.title,
    'x', p_object.x,
    'y', p_object.y,
    'width', p_object.width,
    'height', p_object.height,
    'zIndex', p_object.z_index,
    'minimized', p_object.minimized,
    'pinned', p_object.pinned,
    'deletedAt', p_object.deleted_at,
    'metadata', p_object.metadata,
    'payload', p_object.payload
  );
$$;

revoke execute on function private.canvas_object_mutable_state(public.canvas_objects)
  from public, anon, authenticated;

create or replace function private.validate_canvas_mutable_state(p_state jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_x double precision;
  v_y double precision;
  v_width double precision;
  v_height double precision;
  v_z_index integer;
  v_deleted_at timestamptz;
begin
  if jsonb_typeof(p_state) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_after_state';
  end if;

  if (select count(*) from jsonb_object_keys(p_state)) <> 12
     or not (
       p_state ?& array[
         'type', 'title', 'x', 'y', 'width', 'height', 'zIndex',
         'minimized', 'pinned', 'deletedAt', 'metadata', 'payload'
       ]
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_after_state';
  end if;

  if jsonb_typeof(p_state -> 'type') is distinct from 'string'
     or (p_state ->> 'type') not in (
       'note', 'task_board', 'schedule', 'sketch', 'diagram'
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_object_type';
  end if;

  if jsonb_typeof(p_state -> 'title') is distinct from 'string'
     or char_length(btrim(p_state ->> 'title')) not between 1 and 120
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_object_title';
  end if;

  if jsonb_typeof(p_state -> 'x') is distinct from 'number'
     or jsonb_typeof(p_state -> 'y') is distinct from 'number'
     or jsonb_typeof(p_state -> 'width') is distinct from 'number'
     or jsonb_typeof(p_state -> 'height') is distinct from 'number'
     or jsonb_typeof(p_state -> 'zIndex') is distinct from 'number'
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_spatial_values';
  end if;

  begin
    v_x := (p_state ->> 'x')::double precision;
    v_y := (p_state ->> 'y')::double precision;
    v_width := (p_state ->> 'width')::double precision;
    v_height := (p_state ->> 'height')::double precision;
    v_z_index := (p_state ->> 'zIndex')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_invalid_spatial_values';
  end;

  if v_x not between -1000000 and 1000000
     or v_y not between -1000000 and 1000000
     or v_width not between 160 and 2000
     or v_height not between 80 and 1400
     or v_z_index not between 0 and 100000
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_spatial_values';
  end if;

  if jsonb_typeof(p_state -> 'minimized') is distinct from 'boolean'
     or jsonb_typeof(p_state -> 'pinned') is distinct from 'boolean'
     or jsonb_typeof(p_state -> 'metadata') is distinct from 'object'
     or jsonb_typeof(p_state -> 'payload') is distinct from 'object'
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_after_state';
  end if;

  if jsonb_typeof(p_state -> 'deletedAt') not in ('null', 'string') then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_deleted_at';
  end if;

  if jsonb_typeof(p_state -> 'deletedAt') = 'string' then
    begin
      v_deleted_at := (p_state ->> 'deletedAt')::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_invalid_deleted_at';
    end;
  end if;
end;
$$;

revoke execute on function private.validate_canvas_mutable_state(jsonb)
  from public, anon, authenticated;

create or replace function public.commit_canvas_mutation(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_action text,
  p_description text,
  p_changes jsonb,
  p_inverse_command jsonb default null,
  p_reversible boolean default true,
  p_undoes_receipt_id uuid default null,
  p_receipt_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room_revision bigint;
  v_new_revision bigint;
  v_member_role text;
  v_actor_display_name text;
  v_now timestamptz;
  v_change jsonb;
  v_after jsonb;
  v_expected jsonb;
  v_restore jsonb;
  v_inverse_entry jsonb;
  v_inverse_changes jsonb := '[]'::jsonb;
  v_previous_state jsonb := '[]'::jsonb;
  v_resulting_state jsonb := '[]'::jsonb;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_current_mutable jsonb;
  v_object_id text;
  v_expected_version bigint;
  v_affected_object_ids text[] := '{}'::text[];
  v_has_current boolean;
  v_deleted_at timestamptz;
  v_current public.canvas_objects%rowtype;
  v_result public.canvas_objects%rowtype;
  v_target public.receipts%rowtype;
  v_latest_reversible_id uuid;
  v_inverse_mode text;
begin
  if p_room_id is null or p_actor_user_id is null or p_receipt_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_required_identifier_missing';
  end if;

  if p_actor_type is null
     or p_actor_type not in ('human', 'participant', 'agent')
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_actor_type';
  end if;

  if p_action is null
     or char_length(p_action) not between 1 and 80
     or p_action !~ '^[a-z][a-z0-9_]*$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_action';
  end if;

  if p_description is null
     or char_length(btrim(p_description)) not between 1 and 280
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_description';
  end if;

  if p_reversible is null then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_reversible_flag_required';
  end if;

  if p_inverse_command is not null then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_inverse_is_server_derived';
  end if;

  if exists (select 1 from public.receipts r where r.id = p_receipt_id) then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_receipt_id_exists';
  end if;

  select r.revision
  into v_room_revision
  from public.rooms r
  where r.id = p_room_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_room_not_found';
  end if;

  select rm.role, rm.display_name
  into v_member_role, v_actor_display_name
  from public.room_members rm
  where rm.room_id = p_room_id
    and rm.user_id = p_actor_user_id
  for key share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_actor_not_member';
  end if;

  if p_actor_type = 'agent' then
    if v_member_role <> 'host' then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_agent_requires_host';
    end if;
    v_actor_display_name := 'CommandCanvas agent';
  elsif p_actor_type = 'human' and v_member_role <> 'host' then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_actor_type_mismatch';
  elsif p_actor_type = 'participant' and v_member_role <> 'participant' then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_actor_type_mismatch';
  end if;

  v_now := clock_timestamp();
  v_new_revision := v_room_revision + 1;

  if p_action = 'undo' then
    if p_undoes_receipt_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_target_required';
    end if;

    if p_reversible then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_cannot_be_reversible';
    end if;

    if jsonb_typeof(p_changes) is distinct from 'array' then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_rejects_client_changes';
    end if;

    if jsonb_array_length(p_changes) <> 0 then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_rejects_client_changes';
    end if;

    select receipt.*
    into v_target
    from public.receipts receipt
    where receipt.room_id = p_room_id
      and receipt.id = p_undoes_receipt_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_target_not_found';
    end if;

    if exists (
      select 1
      from public.receipts undo_receipt
      where undo_receipt.undoes_receipt_id = v_target.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_target_already_undone';
    end if;

    if not v_target.reversible or v_target.inverse_command is null then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_target_not_reversible';
    end if;

    select receipt.id
    into v_latest_reversible_id
    from public.receipts receipt
    where receipt.room_id = p_room_id
      and receipt.reversible
      and receipt.inverse_command is not null
      and receipt.undoes_receipt_id is null
      and not exists (
        select 1
        from public.receipts undo_receipt
        where undo_receipt.undoes_receipt_id = receipt.id
      )
    order by receipt.revision desc
    limit 1;

    if v_latest_reversible_id is distinct from v_target.id then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_target_not_latest';
    end if;

    if jsonb_typeof(v_target.inverse_command) is distinct from 'object' then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_inverse_invalid';
    end if;

    if (select count(*) from jsonb_object_keys(v_target.inverse_command)) <> 2
       or not (v_target.inverse_command ?& array['schemaVersion', 'changes'])
       or v_target.inverse_command ->> 'schemaVersion' <> '1'
       or jsonb_typeof(v_target.inverse_command -> 'changes') is distinct from 'array'
    then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_inverse_invalid';
    end if;

    if jsonb_array_length(v_target.inverse_command -> 'changes') not between 1 and 50 then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_inverse_invalid';
    end if;

    for v_inverse_entry in
      select value
      from jsonb_array_elements(v_target.inverse_command -> 'changes')
    loop
      if jsonb_typeof(v_inverse_entry) is distinct from 'object' then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_undo_inverse_invalid';
      end if;

      if not (v_inverse_entry ?& array['objectId', 'mode', 'expected'])
         or jsonb_typeof(v_inverse_entry -> 'objectId') is distinct from 'string'
         or jsonb_typeof(v_inverse_entry -> 'mode') is distinct from 'string'
      then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_undo_inverse_invalid';
      end if;

      v_object_id := v_inverse_entry ->> 'objectId';
      if char_length(v_object_id) not between 2 and 96
         or v_object_id !~ '^[a-z][a-z0-9-]*$'
      then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_undo_inverse_invalid';
      end if;

      if v_object_id = any(v_affected_object_ids) then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_duplicate_object_id';
      end if;

      v_affected_object_ids := array_append(v_affected_object_ids, v_object_id);
      v_inverse_mode := v_inverse_entry ->> 'mode';
      v_expected := v_inverse_entry -> 'expected';

      perform private.validate_canvas_mutable_state(v_expected);

      select canvas_object.*
      into v_current
      from public.canvas_objects canvas_object
      where canvas_object.id = v_object_id
      for update;

      if not found then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_object_not_found';
      end if;

      if v_current.room_id <> p_room_id then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_object_wrong_room';
      end if;

      v_current_mutable := private.canvas_object_mutable_state(v_current);
      if v_current_mutable is distinct from v_expected then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_undo_state_conflict';
      end if;

      v_previous_state := v_previous_state || jsonb_build_array(
        jsonb_build_object(
          'objectId', v_object_id,
          'state', private.canvas_object_state(v_current)
        )
      );

      if v_inverse_mode = 'soft_delete' then
        if (select count(*) from jsonb_object_keys(v_inverse_entry)) <> 3 then
          raise exception using
            errcode = 'P0001',
            message = 'canvas_undo_inverse_invalid';
        end if;

        update public.canvas_objects
        set deleted_at = v_now,
            updated_at = v_now,
            version = version + 1,
            revision = v_new_revision
        where id = v_object_id
          and room_id = p_room_id
        returning * into v_result;
      elsif v_inverse_mode = 'restore_snapshot' then
        if (select count(*) from jsonb_object_keys(v_inverse_entry)) <> 4
           or not (v_inverse_entry ? 'restore')
        then
          raise exception using
            errcode = 'P0001',
            message = 'canvas_undo_inverse_invalid';
        end if;

        v_restore := v_inverse_entry -> 'restore';
        perform private.validate_canvas_mutable_state(v_restore);

        update public.canvas_objects
        set object_type = v_restore ->> 'type',
            title = btrim(v_restore ->> 'title'),
            x = (v_restore ->> 'x')::double precision,
            y = (v_restore ->> 'y')::double precision,
            width = (v_restore ->> 'width')::double precision,
            height = (v_restore ->> 'height')::double precision,
            z_index = (v_restore ->> 'zIndex')::integer,
            minimized = (v_restore ->> 'minimized')::boolean,
            pinned = (v_restore ->> 'pinned')::boolean,
            deleted_at = case
              when jsonb_typeof(v_restore -> 'deletedAt') = 'null' then null
              else (v_restore ->> 'deletedAt')::timestamptz
            end,
            metadata = v_restore -> 'metadata',
            payload = v_restore -> 'payload',
            updated_at = v_now,
            version = version + 1,
            revision = v_new_revision
        where id = v_object_id
          and room_id = p_room_id
        returning * into v_result;
      else
        raise exception using
          errcode = 'P0001',
          message = 'canvas_undo_inverse_invalid';
      end if;

      v_resulting_state := v_resulting_state || jsonb_build_array(
        jsonb_build_object(
          'objectId', v_object_id,
          'state', private.canvas_object_state(v_result)
        )
      );
    end loop;

    insert into public.receipts (
      id,
      room_id,
      revision,
      occurred_at,
      actor_user_id,
      actor_type,
      actor_display_name,
      action,
      affected_object_ids,
      previous_state,
      resulting_state,
      inverse_command,
      reversible,
      undoes_receipt_id,
      description
    ) values (
      p_receipt_id,
      p_room_id,
      v_new_revision,
      v_now,
      p_actor_user_id,
      p_actor_type,
      v_actor_display_name,
      'undo',
      v_affected_object_ids,
      v_previous_state,
      v_resulting_state,
      null,
      false,
      v_target.id,
      btrim(p_description)
    );

    update public.rooms
    set revision = v_new_revision
    where id = p_room_id;

    return jsonb_build_object(
      'receiptId', p_receipt_id,
      'revision', v_new_revision,
      'action', 'undo',
      'affectedObjectIds', to_jsonb(v_affected_object_ids)
    );
  end if;

  if p_undoes_receipt_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_undo_target_forbidden';
  end if;

  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_change_count_out_of_range';
  end if;

  if jsonb_array_length(p_changes) not between 1 and 50 then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_change_count_out_of_range';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    if jsonb_typeof(v_change) is distinct from 'object' then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_invalid_change';
    end if;

    if (select count(*) from jsonb_object_keys(v_change)) <> 3
       or not (v_change ?& array['objectId', 'expectedVersion', 'after'])
       or jsonb_typeof(v_change -> 'objectId') is distinct from 'string'
    then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_invalid_change';
    end if;

    v_object_id := v_change ->> 'objectId';
    if char_length(v_object_id) not between 2 and 96
       or v_object_id !~ '^[a-z][a-z0-9-]*$'
    then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_invalid_object_id';
    end if;

    if v_object_id = any(v_affected_object_ids) then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_duplicate_object_id';
    end if;
    v_affected_object_ids := array_append(v_affected_object_ids, v_object_id);

    if jsonb_typeof(v_change -> 'expectedVersion') = 'null' then
      v_expected_version := null;
    elsif jsonb_typeof(v_change -> 'expectedVersion') = 'number' then
      begin
        v_expected_version := (v_change ->> 'expectedVersion')::bigint;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception using
            errcode = 'P0001',
            message = 'canvas_invalid_expected_version';
      end;

      if v_expected_version < 1 then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_invalid_expected_version';
      end if;
    else
      raise exception using
        errcode = 'P0001',
        message = 'canvas_invalid_expected_version';
    end if;

    v_after := v_change -> 'after';
    perform private.validate_canvas_mutable_state(v_after);

    select canvas_object.*
    into v_current
    from public.canvas_objects canvas_object
    where canvas_object.id = v_object_id
    for update;
    v_has_current := found;

    if v_has_current and v_current.room_id <> p_room_id then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_object_wrong_room';
    end if;

    if v_expected_version is null and v_has_current then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_object_exists';
    elsif v_expected_version is not null and not v_has_current then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_object_not_found';
    elsif v_expected_version is not null
       and v_current.version <> v_expected_version
    then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_object_version_conflict';
    end if;

    if v_has_current and v_current.deleted_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_object_deleted';
    end if;

    if v_expected_version is null
       and jsonb_typeof(v_after -> 'deletedAt') <> 'null'
    then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_create_cannot_start_deleted';
    end if;

    if v_has_current
       and v_current.pinned
       and (
         v_current.x is distinct from (v_after ->> 'x')::double precision
         or v_current.y is distinct from (v_after ->> 'y')::double precision
         or v_current.width is distinct from (v_after ->> 'width')::double precision
         or v_current.height is distinct from (v_after ->> 'height')::double precision
       )
    then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_pinned_transform_forbidden';
    end if;

    if v_has_current then
      v_before_snapshot := private.canvas_object_state(v_current);
      v_current_mutable := private.canvas_object_mutable_state(v_current);

      if jsonb_typeof(v_after -> 'deletedAt') = 'null' then
        v_deleted_at := null;
      else
        v_deleted_at := v_now;
      end if;

      update public.canvas_objects
      set object_type = v_after ->> 'type',
          title = btrim(v_after ->> 'title'),
          x = (v_after ->> 'x')::double precision,
          y = (v_after ->> 'y')::double precision,
          width = (v_after ->> 'width')::double precision,
          height = (v_after ->> 'height')::double precision,
          z_index = (v_after ->> 'zIndex')::integer,
          minimized = (v_after ->> 'minimized')::boolean,
          pinned = (v_after ->> 'pinned')::boolean,
          deleted_at = v_deleted_at,
          metadata = v_after -> 'metadata',
          payload = v_after -> 'payload',
          updated_at = v_now,
          version = version + 1,
          revision = v_new_revision
      where id = v_object_id
        and room_id = p_room_id
        and version = v_expected_version
      returning * into v_result;

      if not found then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_object_version_conflict';
      end if;
    else
      v_before_snapshot := null;
      v_current_mutable := null;

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
        created_at,
        updated_at,
        deleted_at,
        version,
        revision,
        metadata,
        payload
      ) values (
        v_object_id,
        p_room_id,
        v_after ->> 'type',
        btrim(v_after ->> 'title'),
        (v_after ->> 'x')::double precision,
        (v_after ->> 'y')::double precision,
        (v_after ->> 'width')::double precision,
        (v_after ->> 'height')::double precision,
        (v_after ->> 'zIndex')::integer,
        (v_after ->> 'minimized')::boolean,
        (v_after ->> 'pinned')::boolean,
        p_actor_user_id,
        v_now,
        v_now,
        null,
        1,
        v_new_revision,
        v_after -> 'metadata',
        v_after -> 'payload'
      )
      returning * into v_result;
    end if;

    v_after_snapshot := private.canvas_object_state(v_result);

    v_previous_state := v_previous_state || jsonb_build_array(
      jsonb_build_object('objectId', v_object_id, 'state', v_before_snapshot)
    );
    v_resulting_state := v_resulting_state || jsonb_build_array(
      jsonb_build_object('objectId', v_object_id, 'state', v_after_snapshot)
    );

    if p_reversible then
      if v_has_current then
        v_inverse_changes := v_inverse_changes || jsonb_build_array(
          jsonb_build_object(
            'objectId', v_object_id,
            'mode', 'restore_snapshot',
            'expected', private.canvas_object_mutable_state(v_result),
            'restore', v_current_mutable
          )
        );
      else
        v_inverse_changes := v_inverse_changes || jsonb_build_array(
          jsonb_build_object(
            'objectId', v_object_id,
            'mode', 'soft_delete',
            'expected', private.canvas_object_mutable_state(v_result)
          )
        );
      end if;
    end if;
  end loop;

  insert into public.receipts (
    id,
    room_id,
    revision,
    occurred_at,
    actor_user_id,
    actor_type,
    actor_display_name,
    action,
    affected_object_ids,
    previous_state,
    resulting_state,
    inverse_command,
    reversible,
    undoes_receipt_id,
    description
  ) values (
    p_receipt_id,
    p_room_id,
    v_new_revision,
    v_now,
    p_actor_user_id,
    p_actor_type,
    v_actor_display_name,
    p_action,
    v_affected_object_ids,
    v_previous_state,
    v_resulting_state,
    case
      when p_reversible then jsonb_build_object(
        'schemaVersion', 1,
        'changes', v_inverse_changes
      )
      else null
    end,
    p_reversible,
    null,
    btrim(p_description)
  );

  update public.rooms
  set revision = v_new_revision
  where id = p_room_id;

  return jsonb_build_object(
    'receiptId', p_receipt_id,
    'revision', v_new_revision,
    'action', p_action,
    'affectedObjectIds', to_jsonb(v_affected_object_ids)
  );
end;
$$;

revoke execute on function public.commit_canvas_mutation(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.commit_canvas_mutation(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) to service_role;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.canvas_objects enable row level security;
alter table public.receipts enable row level security;
alter table public.meeting_packets enable row level security;
alter table public.packet_send_requests enable row level security;
alter table public.outbound_shares enable row level security;

revoke all on table public.rooms from anon, authenticated;
revoke all on table public.room_members from anon, authenticated;
revoke all on table public.canvas_objects from anon, authenticated;
revoke all on table public.receipts from anon, authenticated;
revoke all on table public.meeting_packets from anon, authenticated;
revoke all on table public.packet_send_requests from anon, authenticated;
revoke all on table public.outbound_shares from anon, authenticated;

grant select on table public.rooms to authenticated;
grant select on table public.room_members to authenticated;
grant select on table public.canvas_objects to authenticated;
grant select on table public.receipts to authenticated;
grant select on table public.meeting_packets to authenticated;
grant select on table public.packet_send_requests to authenticated;
grant select on table public.outbound_shares to authenticated;

grant select, insert, update, delete
  on table public.rooms,
           public.room_members,
           public.canvas_objects,
           public.receipts,
           public.meeting_packets,
           public.packet_send_requests,
           public.outbound_shares
  to service_role;

create policy room_members_select_self
on public.room_members
for select
to authenticated
using (user_id = (select auth.uid()));

create policy rooms_select_member
on public.rooms
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.room_id = rooms.id
      and member.user_id = (select auth.uid())
  )
);

create policy canvas_objects_select_member
on public.canvas_objects
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.room_id = canvas_objects.room_id
      and member.user_id = (select auth.uid())
  )
);

create policy receipts_select_member
on public.receipts
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.room_id = receipts.room_id
      and member.user_id = (select auth.uid())
  )
);

create policy meeting_packets_select_host
on public.meeting_packets
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.room_id = meeting_packets.room_id
      and member.user_id = (select auth.uid())
      and member.role = 'host'
  )
);

create policy packet_send_requests_select_host
on public.packet_send_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.room_id = packet_send_requests.room_id
      and member.user_id = (select auth.uid())
      and member.role = 'host'
  )
);

create policy outbound_shares_select_host
on public.outbound_shares
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.room_id = outbound_shares.room_id
      and member.user_id = (select auth.uid())
      and member.role = 'host'
  )
);

-- Supabase's Realtime schema is locked against ordinary DDL. Only supported
-- RLS policies are created here. The project must disable public Realtime
-- access, and clients must join the exact private topic room:<room-uuid>.
create policy commandcanvas_room_realtime_read
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.room_members member
    where member.user_id = (select auth.uid())
      and (select realtime.topic()) = 'room:' || member.room_id::text
  )
);

create policy commandcanvas_room_realtime_write
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.room_members member
    where member.user_id = (select auth.uid())
      and (select realtime.topic()) = 'room:' || member.room_id::text
  )
);

-- Do not allow future migration-created public tables or functions to inherit
-- broader browser privileges accidentally.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions
  from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences
  from anon, authenticated;

commit;
