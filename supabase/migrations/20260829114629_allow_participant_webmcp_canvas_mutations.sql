begin;

-- A WebMCP agent acts with the authenticated room member's ordinary canvas
-- authority. Membership remains mandatory; human-host and participant actor
-- roles keep their existing checks. Consequential meeting operations use
-- separate host-only RPCs and are intentionally outside this migration.

create or replace function private.commit_canvas_mutation_core(
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
  v_parent_id text;
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

  if p_action in ('undo', 'redo') then
    if p_undoes_receipt_id is null then
      raise exception using
        errcode = 'P0001',
        message = case
          when p_action = 'undo' then 'canvas_undo_target_required'
          else 'canvas_redo_target_required'
        end;
    end if;

    if p_action = 'undo' and p_reversible then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_undo_cannot_be_reversible';
    elsif p_action = 'redo' and not p_reversible then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_redo_must_be_reversible';
    end if;

    if jsonb_typeof(p_changes) is distinct from 'array'
       or jsonb_array_length(p_changes) <> 0
    then
      raise exception using
        errcode = 'P0001',
        message = case
          when p_action = 'undo' then 'canvas_undo_rejects_client_changes'
          else 'canvas_redo_rejects_client_changes'
        end;
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
        message = case
          when p_action = 'undo' then 'canvas_undo_target_not_found'
          else 'canvas_redo_target_not_found'
        end;
    end if;

    if exists (
      select 1
      from public.receipts history_receipt
      where history_receipt.undoes_receipt_id = v_target.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = case
          when p_action = 'undo' then 'canvas_undo_target_already_undone'
          else 'canvas_redo_target_already_redone'
        end;
    end if;

    if p_action = 'undo' then
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
        and receipt.action <> 'undo'
        and not exists (
          select 1
          from public.receipts history_receipt
          where history_receipt.undoes_receipt_id = receipt.id
        )
      order by receipt.revision desc
      limit 1;

      if v_latest_reversible_id is distinct from v_target.id then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_undo_target_not_latest';
      end if;
    else
      if v_target.action <> 'undo'
         or v_target.inverse_command is null
      then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_redo_target_not_undo';
      end if;

      select receipt.id
      into v_latest_reversible_id
      from public.receipts receipt
      where receipt.room_id = p_room_id
        and receipt.action = 'undo'
        and receipt.inverse_command is not null
        and not exists (
          select 1
          from public.receipts history_receipt
          where history_receipt.undoes_receipt_id = receipt.id
        )
      order by receipt.revision desc
      limit 1;

      if v_latest_reversible_id is distinct from v_target.id
         or exists (
           select 1
           from public.receipts later_receipt
           where later_receipt.room_id = p_room_id
             and later_receipt.revision > v_target.revision
             and later_receipt.action not in ('undo', 'redo')
         )
      then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_redo_target_not_latest';
      end if;
    end if;

    if jsonb_typeof(v_target.inverse_command) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_target.inverse_command)) <> 2
       or not (v_target.inverse_command ?& array['schemaVersion', 'changes'])
       or v_target.inverse_command ->> 'schemaVersion' <> '1'
       or jsonb_typeof(v_target.inverse_command -> 'changes') is distinct from 'array'
       or jsonb_array_length(v_target.inverse_command -> 'changes') not between 1 and 50
    then
      raise exception using
        errcode = 'P0001',
        message = case
          when p_action = 'undo' then 'canvas_undo_inverse_invalid'
          else 'canvas_redo_inverse_invalid'
        end;
    end if;

    for v_inverse_entry in
      select value
      from jsonb_array_elements(v_target.inverse_command -> 'changes')
    loop
      if jsonb_typeof(v_inverse_entry) is distinct from 'object'
         or not (v_inverse_entry ?& array['objectId', 'mode', 'expected'])
         or jsonb_typeof(v_inverse_entry -> 'objectId') is distinct from 'string'
         or jsonb_typeof(v_inverse_entry -> 'mode') is distinct from 'string'
      then
        raise exception using
          errcode = 'P0001',
          message = case
            when p_action = 'undo' then 'canvas_undo_inverse_invalid'
            else 'canvas_redo_inverse_invalid'
          end;
      end if;

      v_object_id := v_inverse_entry ->> 'objectId';
      if char_length(v_object_id) not between 2 and 96
         or v_object_id !~ '^[a-z][a-z0-9-]*$'
      then
        raise exception using
          errcode = 'P0001',
          message = case
            when p_action = 'undo' then 'canvas_undo_inverse_invalid'
            else 'canvas_redo_inverse_invalid'
          end;
      end if;

      if v_object_id = any(v_affected_object_ids) then
        raise exception using
          errcode = 'P0001',
          message = 'canvas_duplicate_object_id';
      end if;

      v_affected_object_ids := array_append(v_affected_object_ids, v_object_id);
      v_inverse_mode := v_inverse_entry ->> 'mode';
      v_expected := private.normalize_canvas_mutable_state(
        v_inverse_entry -> 'expected'
      );

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
          message = case
            when p_action = 'undo' then 'canvas_undo_state_conflict'
            else 'canvas_redo_state_conflict'
          end;
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
            message = case
              when p_action = 'undo' then 'canvas_undo_inverse_invalid'
              else 'canvas_redo_inverse_invalid'
            end;
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
            message = case
              when p_action = 'undo' then 'canvas_undo_inverse_invalid'
              else 'canvas_redo_inverse_invalid'
            end;
        end if;

        v_restore := private.normalize_canvas_mutable_state(
          v_inverse_entry -> 'restore'
        );
        perform private.validate_canvas_mutable_state(v_restore);

        update public.canvas_objects
        set object_type = v_restore ->> 'type',
            title = btrim(v_restore ->> 'title'),
            x = (v_restore ->> 'x')::double precision,
            y = (v_restore ->> 'y')::double precision,
            width = (v_restore ->> 'width')::double precision,
            height = (v_restore ->> 'height')::double precision,
            rotation = (v_restore ->> 'rotation')::double precision,
            z_index = (v_restore ->> 'zIndex')::integer,
            minimized = (v_restore ->> 'minimized')::boolean,
            pinned = (v_restore ->> 'pinned')::boolean,
            parent_id = case
              when jsonb_typeof(v_restore -> 'parentId') = 'null' then null
              else v_restore ->> 'parentId'
            end,
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
          message = case
            when p_action = 'undo' then 'canvas_undo_inverse_invalid'
            else 'canvas_redo_inverse_invalid'
          end;
      end if;

      v_resulting_state := v_resulting_state || jsonb_build_array(
        jsonb_build_object(
          'objectId', v_object_id,
          'state', private.canvas_object_state(v_result)
        )
      );

      v_inverse_changes := v_inverse_changes || jsonb_build_array(
        jsonb_build_object(
          'objectId', v_object_id,
          'mode', 'restore_snapshot',
          'expected', private.canvas_object_mutable_state(v_result),
          'restore', v_current_mutable
        )
      );
    end loop;

    perform private.validate_canvas_parent_graph(p_room_id);

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
      jsonb_build_object(
        'schemaVersion', 1,
        'changes', v_inverse_changes
      ),
      p_action = 'redo',
      v_target.id,
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
  end if;

  if p_undoes_receipt_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_undo_target_forbidden';
  end if;

  if jsonb_typeof(p_changes) is distinct from 'array'
     or jsonb_array_length(p_changes) not between 1 and 50
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_change_count_out_of_range';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    if jsonb_typeof(v_change) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_change)) <> 3
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

    v_after := private.normalize_canvas_mutable_state(v_change -> 'after');
    perform private.validate_canvas_mutable_state(v_after);

    if jsonb_typeof(v_after -> 'parentId') = 'null' then
      v_parent_id := null;
    else
      v_parent_id := v_after ->> 'parentId';
    end if;

    if v_parent_id = v_object_id then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_invalid_parent_id';
    end if;

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
         or v_current.rotation is distinct from (v_after ->> 'rotation')::double precision
         or v_current.parent_id is distinct from v_parent_id
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
          rotation = (v_after ->> 'rotation')::double precision,
          z_index = (v_after ->> 'zIndex')::integer,
          minimized = (v_after ->> 'minimized')::boolean,
          pinned = (v_after ->> 'pinned')::boolean,
          parent_id = v_parent_id,
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
        rotation,
        z_index,
        minimized,
        pinned,
        parent_id,
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
        (v_after ->> 'rotation')::double precision,
        (v_after ->> 'zIndex')::integer,
        (v_after ->> 'minimized')::boolean,
        (v_after ->> 'pinned')::boolean,
        v_parent_id,
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

  perform private.validate_canvas_parent_graph(p_room_id);

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

revoke all on function private.commit_canvas_mutation_core(
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
) from public, anon, authenticated, service_role;

commit;
