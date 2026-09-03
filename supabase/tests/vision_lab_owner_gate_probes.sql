\set ON_ERROR_STOP on

-- Required privileged input: vision_lab_user_id, an existing non-anonymous,
-- email-confirmed Supabase Auth user UUID. The user's metadata change and every
-- other test effect are rolled back.
begin;

select pg_catalog.set_config(
  'commandcanvas.vision_lab_owner_gate_user_id',
  :'vision_lab_user_id',
  true
);

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  - 'vision_lab_capture'
where id = :'vision_lab_user_id'::uuid
  and is_anonymous is false
  and email_confirmed_at is not null;

do $$
begin
  if not exists (
    select 1
    from auth.users as actor
    where actor.id = pg_catalog.current_setting(
      'commandcanvas.vision_lab_owner_gate_user_id'
    )::uuid
      and actor.is_anonymous is false
      and actor.email_confirmed_at is not null
  ) then
    raise exception 'vision_lab_owner_gate_probe_user_unavailable';
  end if;
end;
$$;

-- A browser can put a lookalike value in its claims during this direct probe.
-- Authorization must still come from auth.users.raw_app_meta_data.
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', :'vision_lab_user_id',
    'role', 'authenticated',
    'is_anonymous', false,
    'app_metadata', pg_catalog.jsonb_build_object(
      'vision_lab_capture', true
    )
  )::text,
  true
);

set local role authenticated;

do $$
begin
  if public.is_confirmed_permanent_vision_lab_owner() then
    raise exception 'vision_lab_unflagged_user_was_authorized';
  end if;

  begin
    perform public.finalize_vision_lab_capture_submission(
      'vision-lab-ownergate01',
      'acquisition',
      pg_catalog.current_setting('commandcanvas.vision_lab_owner_gate_user_id')
        || '/vision-lab-ownergate01/capture.webm',
      pg_catalog.current_setting('commandcanvas.vision_lab_owner_gate_user_id')
        || '/vision-lab-ownergate01/manifest.json',
      pg_catalog.repeat('a', 64),
      pg_catalog.repeat('b', 64),
      1,
      1,
      'vision-lab-consent-v1',
      'commandcanvas-hand-finetune',
      1
    );
    raise exception 'vision_lab_unflagged_finalization_was_authorized';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'permanent_owner_required' then
        raise;
      end if;
  end;
end;
$$;

reset role;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"vision_lab_capture": true}'::jsonb
where id = :'vision_lab_user_id'::uuid;

set local role authenticated;

do $$
begin
  if not public.is_confirmed_permanent_vision_lab_owner() then
    raise exception 'vision_lab_flagged_user_was_refused';
  end if;

  begin
    perform public.finalize_vision_lab_capture_submission(
      'vision-lab-ownergate01',
      'acquisition',
      pg_catalog.current_setting('commandcanvas.vision_lab_owner_gate_user_id')
        || '/vision-lab-ownergate01/capture.webm',
      pg_catalog.current_setting('commandcanvas.vision_lab_owner_gate_user_id')
        || '/vision-lab-ownergate01/manifest.json',
      pg_catalog.repeat('a', 64),
      pg_catalog.repeat('b', 64),
      1,
      1,
      'vision-lab-consent-v1',
      'commandcanvas-hand-finetune',
      1
    );
    raise exception 'vision_lab_flagged_finalization_skipped_object_checks';
  exception
    when no_data_found then
      if sqlerrm <> 'vision_lab_capture_object_missing' then
        raise;
      end if;
  end;
end;
$$;

rollback;
\echo vision_lab_owner_gate_probes_passed
