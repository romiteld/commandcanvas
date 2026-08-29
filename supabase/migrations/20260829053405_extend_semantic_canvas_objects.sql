begin;

alter table public.canvas_objects
  drop constraint canvas_objects_object_type_check,
  add constraint canvas_objects_object_type_check
    check (
      object_type in (
        'note',
        'task_board',
        'schedule',
        'sketch',
        'diagram',
        'frame',
        'data_table',
        'reference_card',
        'meeting_card'
      )
    );

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
  v_rotation double precision;
  v_z_index integer;
  v_parent_id text;
begin
  if pg_catalog.jsonb_typeof(p_state) is distinct from 'object' then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_after_state';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_state)) <> 14
     or not (
       p_state ?& array[
         'type', 'title', 'x', 'y', 'width', 'height', 'rotation',
         'zIndex', 'minimized', 'pinned', 'parentId', 'deletedAt',
         'metadata', 'payload'
       ]
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_after_state';
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'type') is distinct from 'string'
     or (p_state ->> 'type') not in (
       'note', 'task_board', 'schedule', 'sketch', 'diagram', 'frame',
       'data_table', 'reference_card', 'meeting_card'
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_object_type';
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'title') is distinct from 'string'
     or pg_catalog.char_length(pg_catalog.btrim(p_state ->> 'title'))
       not between 1 and 120
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_object_title';
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'x') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_state -> 'y') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_state -> 'width') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_state -> 'height') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_state -> 'rotation') is distinct from 'number'
     or pg_catalog.jsonb_typeof(p_state -> 'zIndex') is distinct from 'number'
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
    v_rotation := (p_state ->> 'rotation')::double precision;
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
     or v_rotation not between -180 and 180
     or v_z_index not between 0 and 100000
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_spatial_values';
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'minimized') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_state -> 'pinned') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_state -> 'metadata') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_state -> 'payload') is distinct from 'object'
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_after_state';
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'parentId') not in ('null', 'string') then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_parent_id';
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'parentId') = 'string' then
    v_parent_id := p_state ->> 'parentId';
    if pg_catalog.char_length(v_parent_id) not between 2 and 96
       or v_parent_id !~ '^[a-z][a-z0-9-]*$'
    then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_invalid_parent_id';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'deletedAt') not in ('null', 'string') then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_deleted_at';
  end if;

  if pg_catalog.jsonb_typeof(p_state -> 'deletedAt') = 'string' then
    begin
      perform (p_state ->> 'deletedAt')::timestamptz;
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
  from public, anon, authenticated, service_role;

create or replace function private.prepare_meeting_packet_draft_base(
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
        'note', 'task_board', 'schedule', 'diagram',
        'data_table', 'reference_card', 'meeting_card'
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
      'note', 'task_board', 'schedule', 'diagram',
      'data_table', 'reference_card', 'meeting_card'
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

revoke execute on function private.prepare_meeting_packet_draft_base(
  uuid,
  uuid,
  text,
  text,
  text,
  text[]
) from public, anon, authenticated, service_role;

commit;
