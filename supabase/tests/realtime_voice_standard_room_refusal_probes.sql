\set ON_ERROR_STOP on

-- Required inputs:
--   permanent_user_id: an existing confirmed permanent Supabase Auth user UUID
--   anonymous_user_id: an existing anonymous Supabase Auth user UUID
-- Every fixture and admission attempt is rolled back.

begin;

create function pg_temp.assert_json_text(
  p_value jsonb,
  p_path text[],
  p_expected text,
  p_error_code text
)
returns void
language plpgsql
as $$
begin
  if p_value #>> p_path is distinct from p_expected then
    raise exception '%:expected=% actual=% value=%',
      p_error_code,
      p_expected,
      p_value #>> p_path,
      p_value;
  end if;
end;
$$;

create function pg_temp.assert_standard_anonymous_refused(
  p_room_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
as $$
begin
  perform public.admit_realtime_voice_session(p_room_id, p_actor_user_id);
  raise exception 'realtime_voice_standard_anonymous_unexpectedly_admitted';
exception
  when sqlstate 'P0001' then
    if sqlerrm <> 'realtime_voice_permanent_member_required' then
      raise exception 'realtime_voice_standard_anonymous_wrong_refusal:%', sqlerrm;
    end if;
end;
$$;

select pg_temp.assert_json_text(
  pg_catalog.jsonb_build_object(
    'eligible', exists (
      select 1
      from auth.users user_row
      where user_row.id = :'permanent_user_id'
        and user_row.is_anonymous is false
        and user_row.email_confirmed_at is not null
    )::text
  ),
  array['eligible'],
  'true',
  'realtime_voice_standard_permanent_fixture_invalid'
);

select pg_temp.assert_json_text(
  pg_catalog.jsonb_build_object(
    'anonymous', exists (
      select 1
      from auth.users user_row
      where user_row.id = :'anonymous_user_id'
        and user_row.is_anonymous is true
    )::text
  ),
  array['anonymous'],
  'true',
  'realtime_voice_standard_anonymous_fixture_invalid'
);

select
  gen_random_uuid() as room_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug
\gset cc_standard_voice_

insert into public.rooms (id, slug, name, mode, created_by)
values (
  :'cc_standard_voice_room_id',
  :'cc_standard_voice_room_slug',
  'Standard Realtime voice refusal probe',
  'standard',
  :'permanent_user_id'
);

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
)
values
  (
    :'cc_standard_voice_room_id',
    :'permanent_user_id',
    'host',
    'Permanent Host',
    '#0EA5E9'
  ),
  (
    :'cc_standard_voice_room_id',
    :'anonymous_user_id',
    'participant',
    'Anonymous Participant',
    '#A855F7'
  );

delete from private.realtime_voice_admissions;

set local role service_role;

select public.admit_realtime_voice_session(
  :'cc_standard_voice_room_id',
  :'permanent_user_id'
) as admission
\gset cc_standard_voice_permanent_

select pg_temp.assert_json_text(
  :'cc_standard_voice_permanent_admission'::jsonb,
  array['outcome'],
  'admitted',
  'realtime_voice_standard_permanent_not_admitted'
);

select pg_temp.assert_standard_anonymous_refused(
  :'cc_standard_voice_room_id',
  :'anonymous_user_id'
);

reset role;

select pg_temp.assert_json_text(
  pg_catalog.jsonb_build_object(
    'count', (
      select pg_catalog.count(*)::text
      from private.realtime_voice_admissions admission
      where admission.room_id = :'cc_standard_voice_room_id'
        and admission.actor_user_id = :'anonymous_user_id'
    )
  ),
  array['count'],
  '0',
  'realtime_voice_standard_anonymous_ledger_mutated'
);

rollback;

\echo realtime_voice_standard_room_refusal_probes_passed
