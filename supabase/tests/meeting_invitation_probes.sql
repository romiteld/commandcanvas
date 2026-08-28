\set ON_ERROR_STOP on

-- Required privileged inputs: host_user_id, participant_user_id,
-- outsider_user_id. Existing auth rows are modified only inside this rollback.
begin;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as invitation_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') as join_token,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') as invite_token,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') as wrong_token
\gset cc_meeting_

update auth.users
set email = case id
      when :'host_user_id' then 'meeting-host@example.com'
      when :'participant_user_id' then 'meeting-participant@example.com'
      when :'outsider_user_id' then 'meeting-outsider@example.com'
    end,
    email_confirmed_at = pg_catalog.clock_timestamp(),
    is_anonymous = false
where id in (:'host_user_id', :'participant_user_id', :'outsider_user_id');

select
  pg_catalog.set_config('commandcanvas.test_meeting_room_id', :'cc_meeting_room_id', true),
  pg_catalog.set_config('commandcanvas.test_meeting_invitation_id', :'cc_meeting_invitation_id', true),
  pg_catalog.set_config('commandcanvas.test_meeting_invite_token', :'cc_meeting_invite_token', true),
  pg_catalog.set_config('commandcanvas.test_meeting_host_id', :'host_user_id', true),
  pg_catalog.set_config('commandcanvas.test_meeting_participant_id', :'participant_user_id', true),
  pg_catalog.set_config('commandcanvas.test_meeting_outsider_id', :'outsider_user_id', true);

set local role service_role;

select public.create_standard_meeting_with_host(
  :'cc_meeting_room_id', :'cc_meeting_room_slug', 'Invitation probe',
  :'host_user_id', 'Host', '#2563EB', :'cc_meeting_join_token'
);

-- Browser roles cannot bypass the server identity boundary.
reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.create_room_email_invitation(
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid,
      'x@example.com', 'X', '#2563EB', repeat('a', 43),
      pg_catalog.clock_timestamp() + interval '1 day', 'participant'
    );
    raise exception 'meeting_invitation_authenticated_execute_present';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

set local role service_role;
select public.create_room_email_invitation(
  :'cc_meeting_invitation_id', :'cc_meeting_room_id', :'host_user_id',
  'MEETING-PARTICIPANT@EXAMPLE.COM', 'Participant', '#A855F7',
  :'cc_meeting_invite_token', pg_catalog.clock_timestamp() + interval '1 day',
  'participant'
);

reset role;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'room_email_invitations'
      and column_name in ('email', 'invited_email', 'token', 'raw_token')
  ) then
    raise exception 'meeting_invitation_plaintext_secret_persisted';
  end if;
end;
$$;

-- A permanent but different verified email gets the same non-enumerating error.
set local role service_role;
do $$
declare
  v_result jsonb;
begin
  v_result := public.accept_room_email_invitation(
    pg_catalog.current_setting('commandcanvas.test_meeting_outsider_id')::uuid,
    pg_catalog.current_setting('commandcanvas.test_meeting_invite_token')
  );
  if v_result is distinct from '{"outcome":"unavailable"}'::jsonb then
    raise exception 'meeting_invitation_wrong_email_accepted';
  end if;
  if not exists (
    select 1
    from private.room_invitation_acceptance_attempts attempt
    where attempt.actor_user_id = pg_catalog.current_setting(
      'commandcanvas.test_meeting_outsider_id'
    )::uuid
  ) then
    raise exception 'meeting_invitation_failed_attempt_not_retained';
  end if;
end;
$$;

select public.accept_room_email_invitation(
  :'participant_user_id', :'cc_meeting_invite_token'
) as accepted
\gset cc_meeting_accept_

reset role;
select pg_catalog.set_config(
  'commandcanvas.test_meeting_acceptance',
  :'cc_meeting_accept_accepted',
  true
);
do $$
begin
  if pg_catalog.current_setting(
       'commandcanvas.test_meeting_acceptance'
     )::jsonb #>> array['role'] <> 'participant'
     or not exists (
       select 1 from public.room_members member
       where member.room_id = pg_catalog.current_setting(
           'commandcanvas.test_meeting_room_id'
         )::uuid
         and member.user_id = pg_catalog.current_setting(
           'commandcanvas.test_meeting_participant_id'
         )::uuid
         and member.role = 'participant'
     )
     or not exists (
       select 1 from private.room_email_invitations invitation
       where invitation.id = pg_catalog.current_setting(
           'commandcanvas.test_meeting_invitation_id'
         )::uuid
         and invitation.consumed_by_user_id = pg_catalog.current_setting(
           'commandcanvas.test_meeting_participant_id'
         )::uuid
         and invitation.consumed_at is not null
     )
  then
    raise exception 'meeting_invitation_atomic_acceptance_failed';
  end if;
end;
$$;

-- Actor issuance limit uses a durable non-FK ledger, not the cascade-prone invite row.
delete from private.room_invitation_issuance_admissions;
insert into private.room_invitation_issuance_admissions(room_id, actor_user_id)
select :'cc_meeting_room_id', :'host_user_id' from generate_series(1, 10);
set local role service_role;
do $$
begin
  begin
    perform public.create_room_email_invitation(
      gen_random_uuid(),
      pg_catalog.current_setting('commandcanvas.test_meeting_room_id')::uuid,
      pg_catalog.current_setting('commandcanvas.test_meeting_host_id')::uuid,
      'next@example.com', 'Next', '#A855F7', repeat('z', 43),
      pg_catalog.clock_timestamp() + interval '1 day', 'participant'
    );
    raise exception 'meeting_invite_actor_rate_limit_missing';
  exception when raise_exception then
    if sqlerrm <> 'meeting_invite_actor_rate_limit' then raise; end if;
  end;
end;
$$;

rollback;
\echo meeting_invitation_probes_passed
