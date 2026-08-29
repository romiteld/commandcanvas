\set ON_ERROR_STOP on

-- Required inputs are two existing Supabase Anonymous Auth user UUIDs:
--
-- psql "$DATABASE_URL" \
--   -v host_user_id='<uuid>' \
--   -v participant_user_id='<uuid>' \
--   -f supabase/tests/mutation_rpc_probes.sql
--
-- Run with a privileged connection. Calls are made after SET ROLE service_role
-- so the function ACL is exercised. Every fixture is rolled back.

begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as create_receipt_id,
  gen_random_uuid() as transform_one_receipt_id,
  gen_random_uuid() as transform_two_receipt_id,
  gen_random_uuid() as rejected_receipt_id,
  gen_random_uuid() as undo_two_receipt_id,
  gen_random_uuid() as undo_one_receipt_id,
  gen_random_uuid() as pin_receipt_id,
  gen_random_uuid() as rejected_pin_receipt_id,
  gen_random_uuid() as participant_agent_receipt_id,
  gen_random_uuid() as rejected_inverse_receipt_id,
  'note-' || gen_random_uuid()::text as object_id,
  'note-' || gen_random_uuid()::text as participant_agent_object_id
\gset cc_

select
  set_config('commandcanvas.test_room_id', :'cc_room_id', true),
  set_config('commandcanvas.test_object_id', :'cc_object_id', true),
  set_config('commandcanvas.test_host_user_id', :'host_user_id', true),
  set_config(
    'commandcanvas.test_participant_user_id',
    :'participant_user_id',
    true
  ),
  set_config(
    'commandcanvas.test_transform_one_receipt_id',
    :'cc_transform_one_receipt_id',
    true
  ),
  set_config(
    'commandcanvas.test_transform_two_receipt_id',
    :'cc_transform_two_receipt_id',
    true
  ),
  set_config(
    'commandcanvas.test_rejected_receipt_id',
    :'cc_rejected_receipt_id',
    true
  ),
  set_config(
    'commandcanvas.test_rejected_pin_receipt_id',
    :'cc_rejected_pin_receipt_id',
    true
  ),
  set_config(
    'commandcanvas.test_participant_agent_receipt_id',
    :'cc_participant_agent_receipt_id',
    true
  ),
  set_config(
    'commandcanvas.test_participant_agent_object_id',
    :'cc_participant_agent_object_id',
    true
  ),
  set_config(
    'commandcanvas.test_rejected_inverse_receipt_id',
    :'cc_rejected_inverse_receipt_id',
    true
  );

insert into public.rooms (
  id,
  slug,
  name,
  mode,
  created_by
) values (
  :'cc_room_id'::uuid,
  'probe-room-' || replace(:'cc_room_id', '-', ''),
  'CommandCanvas mutation probe',
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
    :'cc_room_id'::uuid,
    :'host_user_id'::uuid,
    'host',
    'Mutation host',
    '#2563EB'
  ),
  (
    :'cc_room_id'::uuid,
    :'participant_user_id'::uuid,
    'participant',
    'Mutation participant',
    '#F97316'
  );

set local role service_role;

select public.commit_canvas_mutation(
  p_room_id => :'cc_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'typed',
  p_action => 'create',
  p_description => 'Mutation host created a note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_object_id',
      'expectedVersion', null,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Mutation probe note',
        'x', 40,
        'y', 60,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Atomic mutation probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_create_receipt_id'::uuid
);

do $$
begin
  if (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
     or (
       select version
       from public.canvas_objects
       where id = current_setting('commandcanvas.test_object_id')
     ) <> 1
     or (
       select count(*)
       from public.receipts
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 1
  then
    raise exception 'mutation_create_atomic_state_failed';
  end if;

  if not exists (
    select 1
    from public.receipts receipt
    where receipt.room_id = current_setting('commandcanvas.test_room_id')::uuid
      and receipt.revision = 1
      and receipt.actor_display_name = 'Mutation host'
      and receipt.source = 'typed'
      and receipt.previous_state -> 0 -> 'state' = 'null'::jsonb
      and receipt.resulting_state -> 0 -> 'state' ->> 'title' = 'Mutation probe note'
      and receipt.inverse_command ->> 'schemaVersion' = '1'
  ) then
    raise exception 'mutation_server_derived_receipt_failed';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.test_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'collaborator',
      p_action => 'transform',
      p_description => 'Actor and source mismatch must fail.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'mutation_actor_source_mismatch_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_actor_source_mismatch' then
        raise;
      end if;
  end;

  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.test_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'camera_frame',
      p_action => 'transform',
      p_description => 'Unknown source must fail.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'mutation_unknown_source_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_invalid_source' then
        raise;
      end if;
  end;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'transform',
  p_description => 'Mutation host moved the note once.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_object_id',
      'expectedVersion', 1,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Mutation probe note',
        'x', 100,
        'y', 60,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Atomic mutation probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_transform_one_receipt_id'::uuid
);

do $$
begin
  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.test_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'pointer',
      p_action => 'transform',
      p_description => 'This stale transform must fail.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', current_setting('commandcanvas.test_object_id'),
          'expectedVersion', 1,
          'after', jsonb_build_object(
            'type', 'note',
            'title', 'Mutation probe note',
            'x', 140,
            'y', 60,
            'width', 300,
            'height', 180,
            'zIndex', 1,
            'minimized', false,
            'pinned', false,
            'deletedAt', null,
            'metadata', '{}'::jsonb,
            'payload', '{"text":"Atomic mutation probe","tone":"sky"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => current_setting(
        'commandcanvas.test_rejected_receipt_id'
      )::uuid
    );
    raise exception 'mutation_version_conflict_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_object_version_conflict' then
        raise;
      end if;
  end;

  if (
       select revision
       from public.rooms
       where id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 2
     or (
       select count(*)
       from public.receipts
       where room_id = current_setting('commandcanvas.test_room_id')::uuid
     ) <> 2
     or (
       select version
       from public.canvas_objects
       where id = current_setting('commandcanvas.test_object_id')
     ) <> 2
  then
    raise exception 'mutation_version_conflict_wrote_partial_state';
  end if;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'transform',
  p_description => 'Mutation host moved the note twice.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_object_id',
      'expectedVersion', 2,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Mutation probe note',
        'x', 200,
        'y', 60,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', false,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Atomic mutation probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_transform_two_receipt_id'::uuid
);

do $$
begin
  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.test_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'undo',
      p_description => 'Out-of-order undo must fail.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => false,
      p_undoes_receipt_id => current_setting(
        'commandcanvas.test_transform_one_receipt_id'
      )::uuid,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'mutation_out_of_order_undo_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_undo_target_not_latest' then
        raise;
      end if;
  end;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Mutation host undid the second move.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_transform_two_receipt_id'::uuid,
  p_receipt_id => :'cc_undo_two_receipt_id'::uuid
);

do $$
begin
  if (
    select x
    from public.canvas_objects
    where id = current_setting('commandcanvas.test_object_id')
  ) <> 100 then
    raise exception 'mutation_latest_undo_did_not_restore_exact_state';
  end if;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'system',
  p_action => 'undo',
  p_description => 'Mutation host undid the first move.',
  p_changes => '[]'::jsonb,
  p_inverse_command => null,
  p_reversible => false,
  p_undoes_receipt_id => :'cc_transform_one_receipt_id'::uuid,
  p_receipt_id => :'cc_undo_one_receipt_id'::uuid
);

do $$
begin
  if (
    select x
    from public.canvas_objects
    where id = current_setting('commandcanvas.test_object_id')
  ) <> 40 then
    raise exception 'mutation_second_undo_did_not_restore_exact_state';
  end if;

  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.test_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'system',
      p_action => 'undo',
      p_description => 'Repeated undo must fail.',
      p_changes => '[]'::jsonb,
      p_inverse_command => null,
      p_reversible => false,
      p_undoes_receipt_id => current_setting(
        'commandcanvas.test_transform_two_receipt_id'
      )::uuid,
      p_receipt_id => gen_random_uuid()
    );
    raise exception 'mutation_repeated_undo_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_undo_target_already_undone' then
        raise;
      end if;
  end;
end;
$$;

select public.commit_canvas_mutation(
  p_room_id => :'cc_room_id'::uuid,
  p_actor_user_id => :'host_user_id'::uuid,
  p_actor_type => 'human',
  p_source => 'pointer',
  p_action => 'pin',
  p_description => 'Mutation host pinned the note.',
  p_changes => jsonb_build_array(
    jsonb_build_object(
      'objectId', :'cc_object_id',
      'expectedVersion', 5,
      'after', jsonb_build_object(
        'type', 'note',
        'title', 'Mutation probe note',
        'x', 40,
        'y', 60,
        'width', 300,
        'height', 180,
        'zIndex', 1,
        'minimized', false,
        'pinned', true,
        'deletedAt', null,
        'metadata', '{}'::jsonb,
        'payload', '{"text":"Atomic mutation probe","tone":"sky"}'::jsonb
      )
    )
  ),
  p_inverse_command => null,
  p_reversible => true,
  p_undoes_receipt_id => null,
  p_receipt_id => :'cc_pin_receipt_id'::uuid
);

do $$
begin
  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.test_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'pointer',
      p_action => 'transform',
      p_description => 'Pinned spatial transform must fail.',
      p_changes => jsonb_build_array(
        jsonb_build_object(
          'objectId', current_setting('commandcanvas.test_object_id'),
          'expectedVersion', 6,
          'after', jsonb_build_object(
            'type', 'note',
            'title', 'Mutation probe note',
            'x', 80,
            'y', 60,
            'width', 300,
            'height', 180,
            'zIndex', 1,
            'minimized', false,
            'pinned', true,
            'deletedAt', null,
            'metadata', '{}'::jsonb,
            'payload', '{"text":"Atomic mutation probe","tone":"sky"}'::jsonb
          )
        )
      ),
      p_inverse_command => null,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => current_setting(
        'commandcanvas.test_rejected_pin_receipt_id'
      )::uuid
    );
    raise exception 'mutation_pinned_transform_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_pinned_transform_forbidden' then
        raise;
      end if;
  end;

  perform public.commit_canvas_mutation(
    p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
    p_actor_user_id => current_setting(
      'commandcanvas.test_participant_user_id'
    )::uuid,
    p_actor_type => 'agent',
    p_source => 'webmcp',
    p_action => 'create',
    p_description => 'CommandCanvas agent created a participant note.',
    p_changes => jsonb_build_array(
      jsonb_build_object(
        'objectId', current_setting(
          'commandcanvas.test_participant_agent_object_id'
        ),
        'expectedVersion', null,
        'after', jsonb_build_object(
          'type', 'note',
          'title', 'Participant agent note',
          'x', 380,
          'y', 60,
          'width', 300,
          'height', 180,
          'zIndex', 2,
          'minimized', false,
          'pinned', false,
          'deletedAt', null,
          'metadata', '{}'::jsonb,
          'payload', '{"text":"Participant WebMCP probe","tone":"sky"}'::jsonb
        )
      )
    ),
    p_inverse_command => null,
    p_reversible => true,
    p_undoes_receipt_id => null,
    p_receipt_id => current_setting(
      'commandcanvas.test_participant_agent_receipt_id'
    )::uuid
  );

  if not exists (
    select 1
    from public.canvas_objects object_row
    where object_row.room_id = current_setting(
      'commandcanvas.test_room_id'
    )::uuid
      and object_row.id = current_setting(
        'commandcanvas.test_participant_agent_object_id'
      )
      and object_row.created_by = current_setting(
        'commandcanvas.test_participant_user_id'
      )::uuid
  ) then
    raise exception 'mutation_participant_agent_object_missing';
  end if;

  if not exists (
    select 1
    from public.receipts receipt
    where receipt.id = current_setting(
      'commandcanvas.test_participant_agent_receipt_id'
    )::uuid
      and receipt.actor_user_id = current_setting(
        'commandcanvas.test_participant_user_id'
      )::uuid
      and receipt.actor_type = 'agent'
      and receipt.source = 'webmcp'
      and receipt.actor_display_name = 'CommandCanvas agent'
  ) then
    raise exception 'mutation_participant_agent_receipt_invalid';
  end if;

  begin
    perform public.commit_canvas_mutation(
      p_room_id => current_setting('commandcanvas.test_room_id')::uuid,
      p_actor_user_id => current_setting('commandcanvas.test_host_user_id')::uuid,
      p_actor_type => 'human',
      p_source => 'typed',
      p_action => 'transform',
      p_description => 'Client inverse state must be rejected.',
      p_changes => '[]'::jsonb,
      p_inverse_command => '{"client":"supplied"}'::jsonb,
      p_reversible => true,
      p_undoes_receipt_id => null,
      p_receipt_id => current_setting(
        'commandcanvas.test_rejected_inverse_receipt_id'
      )::uuid
    );
    raise exception 'mutation_client_inverse_was_accepted';
  exception
    when raise_exception then
      if sqlerrm <> 'canvas_inverse_is_server_derived' then
        raise;
      end if;
  end;
end;
$$;

reset role;

do $$
begin
  begin
    update public.receipts
    set description = 'tampered'
    where room_id = current_setting('commandcanvas.test_room_id')::uuid;
    raise exception 'mutation_receipt_tamper_was_accepted';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'receipts are immutable' then
        raise;
      end if;
  end;

  raise notice 'mutation_rpc_probes_passed';
end;
$$;

rollback;
