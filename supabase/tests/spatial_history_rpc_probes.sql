\set ON_ERROR_STOP on

-- Required input is one existing Supabase Anonymous Auth host UUID:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -f supabase/tests/spatial_history_rpc_probes.sql
--
-- Run with a privileged connection. Calls are made after SET ROLE service_role
-- so the function ACL is exercised. Every fixture is rolled back.

begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as other_room_id,
  gen_random_uuid() as group_receipt_id,
  gen_random_uuid() as transform_receipt_id,
  gen_random_uuid() as undo_receipt_id,
  gen_random_uuid() as redo_receipt_id,
  gen_random_uuid() as ungroup_receipt_id,
  gen_random_uuid() as nested_group_receipt_id,
  gen_random_uuid() as nested_transform_receipt_id,
  gen_random_uuid() as nested_undo_transform_receipt_id,
  gen_random_uuid() as nested_redo_receipt_id,
  gen_random_uuid() as nested_undo_redo_receipt_id,
  gen_random_uuid() as nested_undo_group_receipt_id,
  'frame-' || gen_random_uuid()::text as frame_id,
  'frame-' || gen_random_uuid()::text as outer_frame_id,
  'frame-' || gen_random_uuid()::text as inner_frame_id,
  'note-' || gen_random_uuid()::text as first_note_id,
  'note-' || gen_random_uuid()::text as second_note_id
\gset cc_spatial_

select
  set_config('commandcanvas.spatial_room_id', :'cc_spatial_room_id', true),
  set_config('commandcanvas.spatial_other_room_id', :'cc_spatial_other_room_id', true),
  set_config('commandcanvas.spatial_host_user_id', :'host_user_id', true),
  set_config('commandcanvas.spatial_frame_id', :'cc_spatial_frame_id', true),
  set_config('commandcanvas.spatial_outer_frame_id', :'cc_spatial_outer_frame_id', true),
  set_config('commandcanvas.spatial_inner_frame_id', :'cc_spatial_inner_frame_id', true),
  set_config('commandcanvas.spatial_first_note_id', :'cc_spatial_first_note_id', true),
  set_config('commandcanvas.spatial_second_note_id', :'cc_spatial_second_note_id', true),
  set_config('commandcanvas.spatial_transform_receipt_id', :'cc_spatial_transform_receipt_id', true),
  set_config('commandcanvas.spatial_undo_receipt_id', :'cc_spatial_undo_receipt_id', true);

insert into public.rooms (id, slug, name, mode, created_by) values
  (
    :'cc_spatial_room_id'::uuid,
    'spatial-room-' || replace(:'cc_spatial_room_id', '-', ''),
    'Spatial history probe',
    'demo',
    :'host_user_id'::uuid
  ),
  (
    :'cc_spatial_other_room_id'::uuid,
    'spatial-room-' || replace(:'cc_spatial_other_room_id', '-', ''),
    'Spatial history isolation probe',
    'demo',
    :'host_user_id'::uuid
  );

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
) values
  (
    :'cc_spatial_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'Spatial host',
    '#2563EB'
  ),
  (
    :'cc_spatial_other_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'Spatial host',
    '#2563EB'
  );

set local role service_role;

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_other_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'group',
  p_description => 'Spatial host nested one frame inside another.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_spatial_outer_frame_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'frame',
        'title', 'Outer frame',
        'x', 40,
        'y', 40,
        'width', 900,
        'height', 640,
        'rotation', -12,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'parentId', null,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"tone":"indigo"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_inner_frame_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'frame',
        'title', 'Inner frame',
        'x', 140,
        'y', 140,
        'width', 560,
        'height', 360,
        'rotation', 18,
        'zIndex', 2,
        'minimized', false,
        'pinned', false,
        'parentId', :'cc_spatial_outer_frame_id',
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_spatial_nested_group_receipt_id'::uuid
);

do $$
declare
  v_revision_before bigint;
begin
  if not exists (
    select 1
    from public.canvas_objects inner_frame
    join public.canvas_objects outer_frame
      on outer_frame.room_id = inner_frame.room_id
     and outer_frame.id = inner_frame.parent_id
    where inner_frame.room_id = current_setting(
      'commandcanvas.spatial_other_room_id'
    )::uuid
      and inner_frame.id = current_setting(
        'commandcanvas.spatial_inner_frame_id'
      )
      and inner_frame.object_type = 'frame'
      and outer_frame.id = current_setting(
        'commandcanvas.spatial_outer_frame_id'
      )
      and outer_frame.object_type = 'frame'
      and inner_frame.rotation = 18
      and outer_frame.rotation = -12
  ) then
    raise exception 'spatial_valid_nested_frame_missing';
  end if;

  select revision into v_revision_before
  from public.rooms
  where id = current_setting('commandcanvas.spatial_other_room_id')::uuid;

  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting(
        'commandcanvas.spatial_other_room_id'
      )::uuid,
      p_actor_user_id => current_setting(
        'commandcanvas.spatial_host_user_id'
      )::uuid,
      p_actor_type => 'human',
      p_source => 'pointer',
      p_action => 'group',
      p_description => 'A frame containment cycle must fail.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', current_setting(
            'commandcanvas.spatial_outer_frame_id'
          ),
          'expectedVersion', 1,
          'after', jsonb_build_object(
            'type', 'frame',
            'title', 'Outer frame',
            'x', 40,
            'y', 40,
            'width', 900,
            'height', 640,
            'rotation', -12,
            'zIndex', 1,
            'minimized', false,
            'pinned', false,
            'parentId', current_setting(
              'commandcanvas.spatial_inner_frame_id'
            ),
            'deletedAt', null,
            'metadata', '{}'::jsonb,
            'payload', '{"tone":"indigo"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'spatial_parent_cycle_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_parent_cycle' then
        raise;
      end if;
  end;

  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting(
        'commandcanvas.spatial_other_room_id'
      )::uuid,
      p_actor_user_id => current_setting(
        'commandcanvas.spatial_host_user_id'
      )::uuid,
      p_actor_type => 'human',
      p_source => 'pointer',
      p_action => 'transform',
      p_description => 'Rotation outside the canonical range must fail.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', current_setting(
            'commandcanvas.spatial_outer_frame_id'
          ),
          'expectedVersion', 1,
          'after', jsonb_build_object(
            'type', 'frame',
            'title', 'Outer frame',
            'x', 40,
            'y', 40,
            'width', 900,
            'height', 640,
            'rotation', 181,
            'zIndex', 1,
            'minimized', false,
            'pinned', false,
            'parentId', null,
            'deletedAt', null,
            'metadata', '{}'::jsonb,
            'payload', '{"tone":"indigo"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'spatial_rotation_out_of_range_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_invalid_spatial_values' then
        raise;
      end if;
  end;

  if (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.spatial_other_room_id')::uuid
     ) <> v_revision_before
     or (
       select parent_id
       from public.canvas_objects
       where id = current_setting('commandcanvas.spatial_outer_frame_id')
     ) is not null
  then
    raise exception 'spatial_parent_cycle_wrote_partial_state';
  end if;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_other_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'transform',
  p_description => 'Spatial host moved the nested frame hierarchy.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_spatial_outer_frame_id',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'frame', 'title', 'Outer frame',
        'x', 80, 'y', 60, 'width', 900, 'height', 640,
        'rotation', -10, 'zIndex', 1, 'minimized', false, 'pinned', false,
        'parentId', null, 'deletedAt', null,
        'metadata', '{}'::jsonb, 'payload', '{"tone":"indigo"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_inner_frame_id',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'frame', 'title', 'Inner frame',
        'x', 200, 'y', 160, 'width', 560, 'height', 360,
        'rotation', 20, 'zIndex', 2, 'minimized', false, 'pinned', false,
        'parentId', :'cc_spatial_outer_frame_id', 'deletedAt', null,
        'metadata', '{}'::jsonb, 'payload', '{"tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_spatial_nested_transform_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_other_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Spatial host undid the nested transform.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_spatial_nested_transform_receipt_id'::uuid,
  p_receipt_id => :'cc_spatial_nested_undo_transform_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_other_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'redo',
  p_description => 'Spatial host redid the nested transform.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => :'cc_spatial_nested_undo_transform_receipt_id'::uuid,
  p_receipt_id => :'cc_spatial_nested_redo_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_other_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Spatial host undid the nested redo.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_spatial_nested_redo_receipt_id'::uuid,
  p_receipt_id => :'cc_spatial_nested_undo_redo_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_other_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Spatial host next undid the prior nested group.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_spatial_nested_group_receipt_id'::uuid,
  p_receipt_id => :'cc_spatial_nested_undo_group_receipt_id'::uuid
);

do $$
begin
  if (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.spatial_other_room_id')::uuid
     ) <> 6
     or (
       select count(*)
       from public.canvas_objects object_row
       where object_row.room_id = current_setting(
         'commandcanvas.spatial_other_room_id'
       )::uuid
         and object_row.deleted_at is not null
         and object_row.version = 6
     ) <> 2
     or not exists (
       select 1
       from public.receipts group_receipt
       join public.receipts transform_receipt
         on transform_receipt.room_id = group_receipt.room_id
        and transform_receipt.revision = 2
        and transform_receipt.action = 'transform'
       join public.receipts undo_transform_receipt
         on undo_transform_receipt.room_id = group_receipt.room_id
        and undo_transform_receipt.revision = 3
        and undo_transform_receipt.action = 'undo'
        and undo_transform_receipt.undoes_receipt_id = transform_receipt.id
       join public.receipts redo_receipt
         on redo_receipt.room_id = group_receipt.room_id
        and redo_receipt.revision = 4
        and redo_receipt.action = 'redo'
        and redo_receipt.undoes_receipt_id = undo_transform_receipt.id
       join public.receipts undo_redo_receipt
         on undo_redo_receipt.room_id = group_receipt.room_id
        and undo_redo_receipt.revision = 5
        and undo_redo_receipt.action = 'undo'
        and undo_redo_receipt.undoes_receipt_id = redo_receipt.id
       join public.receipts undo_group_receipt
         on undo_group_receipt.room_id = group_receipt.room_id
        and undo_group_receipt.revision = 6
        and undo_group_receipt.action = 'undo'
        and undo_group_receipt.undoes_receipt_id = group_receipt.id
       where group_receipt.room_id = current_setting(
         'commandcanvas.spatial_other_room_id'
       )::uuid
         and group_receipt.revision = 1
         and group_receipt.action = 'group'
         and cardinality(undo_redo_receipt.affected_object_ids) = 2
         and cardinality(undo_group_receipt.affected_object_ids) = 2
     )
  then
    raise exception 'spatial_history_chain_progression_failed';
  end if;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'group',
  p_description => 'Spatial host grouped two notes in a frame.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_spatial_frame_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'frame',
        'title', 'Planning frame',
        'x', 100,
        'y', 100,
        'width', 720,
        'height', 480,
        'rotation', 0,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'parentId', null,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"tone":"indigo"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_first_note_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'First grouped note',
        'x', 160,
        'y', 180,
        'width', 240,
        'height', 160,
        'rotation', -4.5,
        'zIndex', 2,
        'minimized', false,
        'pinned', false,
        'parentId', :'cc_spatial_frame_id',
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"One","tone":"sky"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_second_note_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Second grouped note',
        'x', 460,
        'y', 180,
        'width', 240,
        'height', 160,
        'rotation', 3.25,
        'zIndex', 3,
        'minimized', false,
        'pinned', false,
        'parentId', :'cc_spatial_frame_id',
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Two","tone":"amber"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_spatial_group_receipt_id'::uuid
);

do $$
begin
  if (
       select count(*)
       from public.canvas_objects object_row
       where object_row.room_id = current_setting('commandcanvas.spatial_room_id')::uuid
         and object_row.deleted_at is null
     ) <> 3
     or (
       select count(*)
       from public.canvas_objects object_row
       where object_row.parent_id = current_setting('commandcanvas.spatial_frame_id')
     ) <> 2
     or (
       select rotation
       from public.canvas_objects object_row
       where object_row.id = current_setting('commandcanvas.spatial_first_note_id')
     ) <> -4.5::double precision
     or not exists (
       select 1
       from public.receipts receipt
       where receipt.room_id = current_setting('commandcanvas.spatial_room_id')::uuid
         and receipt.action = 'group'
         and cardinality(receipt.affected_object_ids) = 3
         and receipt.resulting_state -> 1 -> 'state' ->> 'parentId'
           = current_setting('commandcanvas.spatial_frame_id')
     )
  then
    raise exception 'spatial_group_atomic_state_failed';
  end if;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'transform',
  p_description => 'Spatial host moved the frame and both children.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_spatial_frame_id',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'frame', 'title', 'Planning frame',
        'x', 200, 'y', 140, 'width', 720, 'height', 480,
        'rotation', 8, 'zIndex', 1, 'minimized', false, 'pinned', false,
        'parentId', null, 'deletedAt', null,
        'metadata', '{}'::jsonb, 'payload', '{"tone":"indigo"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_first_note_id',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'note', 'title', 'First grouped note',
        'x', 260, 'y', 220, 'width', 240, 'height', 160,
        'rotation', 3.5, 'zIndex', 2, 'minimized', false, 'pinned', false,
        'parentId', :'cc_spatial_frame_id', 'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"One","tone":"sky"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_second_note_id',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'note', 'title', 'Second grouped note',
        'x', 560, 'y', 220, 'width', 240, 'height', 160,
        'rotation', 11.25, 'zIndex', 3, 'minimized', false, 'pinned', false,
        'parentId', :'cc_spatial_frame_id', 'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Two","tone":"amber"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_spatial_transform_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Spatial host undid the grouped transform.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_spatial_transform_receipt_id'::uuid,
  p_receipt_id => :'cc_spatial_undo_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'redo',
  p_description => 'Spatial host redid the grouped transform.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => :'cc_spatial_undo_receipt_id'::uuid,
  p_receipt_id => :'cc_spatial_redo_receipt_id'::uuid
);

do $$
begin
  if (
       select x
       from public.canvas_objects object_row
       where object_row.id = current_setting('commandcanvas.spatial_frame_id')
     ) <> 200
     or (
       select version
       from public.canvas_objects object_row
       where object_row.id = current_setting('commandcanvas.spatial_frame_id')
     ) <> 4
     or not exists (
       select 1
       from public.receipts receipt
       where receipt.room_id = current_setting('commandcanvas.spatial_room_id')::uuid
         and receipt.action = 'undo'
         and receipt.id = current_setting('commandcanvas.spatial_undo_receipt_id')::uuid
         and not receipt.reversible
         and receipt.inverse_command ->> 'schemaVersion' = '1'
         and jsonb_array_length(receipt.inverse_command -> 'changes') = 3
     )
     or not exists (
       select 1
       from public.receipts receipt
       where receipt.room_id = current_setting('commandcanvas.spatial_room_id')::uuid
         and receipt.action = 'redo'
         and receipt.undoes_receipt_id = current_setting('commandcanvas.spatial_undo_receipt_id')::uuid
         and receipt.reversible
         and receipt.inverse_command ->> 'schemaVersion' = '1'
         and cardinality(receipt.affected_object_ids) = 3
     )
  then
    raise exception 'spatial_redo_exact_restore_failed';
  end if;
end;
$$;

do $$
declare
  v_revision_before bigint;
begin
  select revision into v_revision_before
  from public.rooms
  where id = current_setting('commandcanvas.spatial_room_id')::uuid;

  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.spatial_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.spatial_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'pointer',
      p_action => 'group',
      p_description => 'A non-frame parent must be rejected.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', current_setting('commandcanvas.spatial_first_note_id'),
          'expectedVersion', 4,
          'after', jsonb_build_object(
            'type', 'note', 'title', 'First grouped note',
            'x', 260, 'y', 220, 'width', 240, 'height', 160,
            'rotation', 3.5, 'zIndex', 2, 'minimized', false, 'pinned', false,
            'parentId', current_setting('commandcanvas.spatial_second_note_id'),
            'deletedAt', null, 'metadata', '{}'::jsonb,
            'payload', '{"text":"One","tone":"sky"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'spatial_non_frame_parent_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_parent_not_active_frame' then
        raise;
      end if;
  end;

  if (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.spatial_room_id')::uuid
     ) <> v_revision_before
  then
    raise exception 'spatial_invalid_parent_wrote_partial_revision';
  end if;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_spatial_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'ungroup',
  p_description => 'Spatial host ungrouped the notes and discarded the frame.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_spatial_first_note_id',
      'expectedVersion', 4,
      'after', jsonb_build_object(
        'type', 'note', 'title', 'First grouped note',
        'x', 260, 'y', 220, 'width', 240, 'height', 160,
        'rotation', 3.5, 'zIndex', 2, 'minimized', false, 'pinned', false,
        'parentId', null, 'deletedAt', null, 'metadata', '{}'::jsonb,
        'payload', '{"text":"One","tone":"sky"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_second_note_id',
      'expectedVersion', 4,
      'after', jsonb_build_object(
        'type', 'note', 'title', 'Second grouped note',
        'x', 560, 'y', 220, 'width', 240, 'height', 160,
        'rotation', 11.25, 'zIndex', 3, 'minimized', false, 'pinned', false,
        'parentId', null, 'deletedAt', null, 'metadata', '{}'::jsonb,
        'payload', '{"text":"Two","tone":"amber"}'::jsonb
      )
    ),
    jsonb_build_object(
      'objectId', :'cc_spatial_frame_id',
      'expectedVersion', 4,
      'after', jsonb_build_object(
        'type', 'frame', 'title', 'Planning frame',
        'x', 200, 'y', 140, 'width', 720, 'height', 480,
        'rotation', 8, 'zIndex', 1, 'minimized', false, 'pinned', false,
        'parentId', null, 'deletedAt', clock_timestamp(),
        'metadata', '{}'::jsonb, 'payload', '{"tone":"indigo"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_spatial_ungroup_receipt_id'::uuid
);

do $$
begin
  if exists (
    select 1
    from public.canvas_objects object_row
    where object_row.room_id = current_setting('commandcanvas.spatial_room_id')::uuid
      and object_row.parent_id is not null
  )
  or not exists (
    select 1
    from public.canvas_objects object_row
    where object_row.id = current_setting('commandcanvas.spatial_frame_id')
      and object_row.deleted_at is not null
  )
  or not exists (
    select 1
    from public.receipts receipt
    where receipt.room_id = current_setting('commandcanvas.spatial_room_id')::uuid
      and receipt.action = 'ungroup'
      and cardinality(receipt.affected_object_ids) = 3
  )
  then
    raise exception 'spatial_ungroup_atomic_state_failed';
  end if;

  raise notice 'spatial_history_rpc_probes_passed';
end;
$$;

rollback;
