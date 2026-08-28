\set ON_ERROR_STOP on

-- Required input is one existing Supabase Anonymous Auth host UUID:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -f supabase/tests/multi_redo_rpc_probes.sql
--
-- Run with a privileged connection. Calls are made after SET ROLE service_role
-- so the public RPC ACL and private implementation are exercised. Fixtures
-- are rolled back.

begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as create_receipt_id,
  gen_random_uuid() as move_one_receipt_id,
  gen_random_uuid() as move_two_receipt_id,
  gen_random_uuid() as undo_two_receipt_id,
  gen_random_uuid() as undo_one_receipt_id,
  gen_random_uuid() as redo_one_receipt_id,
  gen_random_uuid() as redo_two_receipt_id,
  gen_random_uuid() as undo_redo_two_receipt_id,
  gen_random_uuid() as branch_receipt_id,
  'note-' || gen_random_uuid()::text as object_id
\gset cc_redo_

select
  set_config('commandcanvas.redo.room_id', :'cc_redo_room_id', true),
  set_config('commandcanvas.redo.host_user_id', :'host_user_id', true),
  set_config('commandcanvas.redo.object_id', :'cc_redo_object_id', true),
  set_config(
    'commandcanvas.redo.undo_redo_two_receipt_id',
    :'cc_redo_undo_redo_two_receipt_id',
    true
  );

insert into public.rooms (id, slug, name, mode, created_by)
values (
  :'cc_redo_room_id'::uuid,
  'multi-redo-' || replace(:'cc_redo_room_id', '-', ''),
  'Multi-redo history probe',
  'demo',
  :'host_user_id'::uuid
);

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
) values (
  :'cc_redo_room_id'::uuid,
  :'host_user_id'::uuid,
  'host',
  'Redo probe host',
  '#2563EB'
);

set local role service_role;

select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'typed',
  p_action => 'create',
  p_description => 'Redo probe host created a note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_redo_object_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Multi-redo probe note',
        'x', 40,
        'y', 60,
        'width', 300,
        'height', 180,
        'rotation', 0,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'parentId', null,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Multi-redo probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_redo_create_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'transform',
  p_description => 'Redo probe host moved the note once.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_redo_object_id',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'note', 'title', 'Multi-redo probe note',
        'x', 100, 'y', 60, 'width', 300, 'height', 180,
        'rotation', 0, 'zIndex', 1,
        'minimized', false, 'pinned', false, 'parentId', null,
        'deletedAt', null, 'metadata', '{}'::jsonb,
        'payload', '{"text":"Multi-redo probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_redo_move_one_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'transform',
  p_description => 'Redo probe host moved the note twice.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_redo_object_id',
      'expectedVersion', 2,
      'after', jsonb_build_object(
        'type', 'note', 'title', 'Multi-redo probe note',
        'x', 200, 'y', 60, 'width', 300, 'height', 180,
        'rotation', 0, 'zIndex', 1,
        'minimized', false, 'pinned', false, 'parentId', null,
        'deletedAt', null, 'metadata', '{}'::jsonb,
        'payload', '{"text":"Multi-redo probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_redo_move_two_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Redo probe host undid the second move.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_redo_move_two_receipt_id'::uuid,
  p_receipt_id => :'cc_redo_undo_two_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Redo probe host undid the first move.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_redo_move_one_receipt_id'::uuid,
  p_receipt_id => :'cc_redo_undo_one_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'redo',
  p_description => 'Redo probe host redid the first move.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => :'cc_redo_undo_one_receipt_id'::uuid,
  p_receipt_id => :'cc_redo_redo_one_receipt_id'::uuid
);

-- This second redo is the regression: it must consume the next pending undo
-- even though a successful redo receipt is now the room's latest revision.
select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'redo',
  p_description => 'Redo probe host redid the second move.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => :'cc_redo_undo_two_receipt_id'::uuid,
  p_receipt_id => :'cc_redo_redo_two_receipt_id'::uuid
);

do $$
begin
  if (
       select x
       from public.canvas_objects
       where id = current_setting('commandcanvas.redo.object_id')
     ) <> 200
     or (
       select version
       from public.canvas_objects
       where id = current_setting('commandcanvas.redo.object_id')
     ) <> 7
     or (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.redo.room_id')::uuid
     ) <> 7
  then
    raise exception 'multi_redo_did_not_restore_exact_state';
  end if;
end;
$$;

-- A normal mutation after an undo creates a new branch. It must continue to
-- invalidate that pending redo even though multiple history-only receipts are
-- now allowed between an undo and its redo.
select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Redo probe host undid the second redo.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_redo_redo_two_receipt_id'::uuid,
  p_receipt_id => :'cc_redo_undo_redo_two_receipt_id'::uuid
);

select public.commit_canvas_mutation(
  p_room_id => :'cc_redo_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'transform',
  p_description => 'Redo probe host started a new branch.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_redo_object_id',
      'expectedVersion', 8,
      'after', jsonb_build_object(
        'type', 'note', 'title', 'Multi-redo probe note',
        'x', 400, 'y', 60, 'width', 300, 'height', 180,
        'rotation', 0, 'zIndex', 1,
        'minimized', false, 'pinned', false, 'parentId', null,
        'deletedAt', null, 'metadata', '{}'::jsonb,
        'payload', '{"text":"Multi-redo probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_redo_branch_receipt_id'::uuid
);

do $$
declare
  v_revision_before bigint;
  v_version_before bigint;
begin
  select revision into v_revision_before
  from public.rooms
  where id = current_setting('commandcanvas.redo.room_id')::uuid;

  select version into v_version_before
  from public.canvas_objects
  where id = current_setting('commandcanvas.redo.object_id');

  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.redo.room_id')::uuid,
      p_actor_user_id => current_setting(
        'commandcanvas.redo.host_user_id'
      )::uuid,
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'redo',
      p_description => 'A redo after a new branch must fail.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => current_setting(
        'commandcanvas.redo.undo_redo_two_receipt_id'
      )::uuid,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'redo_after_new_branch_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_redo_target_not_latest' then
        raise;
      end if;
  end;

  if (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.redo.room_id')::uuid
     ) <> v_revision_before
     or (
       select version
       from public.canvas_objects
       where id = current_setting('commandcanvas.redo.object_id')
     ) <> v_version_before
     or (
       select x
       from public.canvas_objects
       where id = current_setting('commandcanvas.redo.object_id')
     ) <> 400
  then
    raise exception 'rejected_redo_wrote_partial_state';
  end if;

  raise notice 'multi_redo_rpc_probes_passed';
end;
$$;

rollback;
