\set ON_ERROR_STOP on

-- Required input: host_user_id, an existing confirmed permanent Supabase Auth
-- user UUID. All room fixtures and admission attempts are rolled back.

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

select pg_temp.assert_json_text(
  pg_catalog.jsonb_build_object(
    'eligible', exists (
      select 1
      from auth.users user_row
      where user_row.id = :'host_user_id'
        and user_row.is_anonymous is false
        and user_row.email_confirmed_at is not null
    )::text
  ),
  array['eligible'],
  'true',
  'realtime_voice_probe_permanent_user_required'
);

select
  gen_random_uuid() as room_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug
\gset cc_voice_

insert into public.rooms (id, slug, name, mode, created_by)
values (
  :'cc_voice_room_id',
  :'cc_voice_room_slug',
  'Realtime voice admission probe',
  'demo',
  :'host_user_id'
);

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
)
values (
  :'cc_voice_room_id',
  :'host_user_id',
  'host',
  'Probe Host',
  '#2563EB'
);

delete from private.realtime_voice_admissions;

set local role service_role;

select public.admit_realtime_voice_session(
  :'cc_voice_room_id',
  :'host_user_id'
) as admission
\gset cc_voice_first_

select pg_temp.assert_json_text(
  :'cc_voice_first_admission'::jsonb,
  array['outcome'],
  'admitted',
  'realtime_voice_first_admission_invalid'
);

select public.admit_realtime_voice_session(
  :'cc_voice_room_id',
  :'host_user_id'
);
select public.admit_realtime_voice_session(
  :'cc_voice_room_id',
  :'host_user_id'
);

select public.admit_realtime_voice_session(
  :'cc_voice_room_id',
  :'host_user_id'
) as admission
\gset cc_voice_limited_

select pg_temp.assert_json_text(
  :'cc_voice_limited_admission'::jsonb,
  array['code'],
  'voice_actor_rate_limit',
  'realtime_voice_rate_limit_not_enforced'
);

-- The same bounded admission path now accepts a verified standard-room member.
reset role;

select
  gen_random_uuid() as room_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug
\gset cc_voice_standard_

insert into public.rooms (id, slug, name, mode, created_by)
values (
  :'cc_voice_standard_room_id',
  :'cc_voice_standard_room_slug',
  'Realtime voice standard-room probe',
  'standard',
  :'host_user_id'
);

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
)
values (
  :'cc_voice_standard_room_id',
  :'host_user_id',
  'host',
  'Probe Host',
  '#2563EB'
);

delete from private.realtime_voice_admissions;

set local role service_role;

select public.admit_realtime_voice_session(
  :'cc_voice_standard_room_id',
  :'host_user_id'
) as admission
\gset cc_voice_standard_admitted_

select pg_temp.assert_json_text(
  :'cc_voice_standard_admitted_admission'::jsonb,
  array['outcome'],
  'admitted',
  'realtime_voice_standard_room_not_admitted'
);

reset role;

select pg_temp.assert_json_text(
  pg_catalog.jsonb_build_object(
    'count', (
      select pg_catalog.count(*)::text
      from private.realtime_voice_admissions admission
      where admission.room_id = :'cc_voice_standard_room_id'
    )
  ),
  array['count'],
  '1',
  'realtime_voice_standard_room_ledger_missing'
);

-- Each durable daily branch is exercised independently so a passing burst
-- limiter cannot mask a missing actor, room, or global ceiling.
delete from private.realtime_voice_admissions;
insert into private.realtime_voice_admissions (
  room_id,
  actor_user_id,
  room_mode,
  admitted_at
)
select
  :'cc_voice_room_id',
  :'host_user_id',
  'demo',
  clock_timestamp()
from generate_series(1, 8);

set local role service_role;

select public.admit_realtime_voice_session(
  :'cc_voice_room_id',
  :'host_user_id'
) as admission
\gset cc_voice_actor_daily_

select pg_temp.assert_json_text(
  :'cc_voice_actor_daily_admission'::jsonb,
  array['code'],
  'voice_actor_daily_limit',
  'realtime_voice_actor_daily_limit_not_enforced'
);

reset role;
delete from private.realtime_voice_admissions;
insert into private.realtime_voice_admissions (
  room_id,
  actor_user_id,
  room_mode,
  admitted_at
)
select
  :'cc_voice_room_id',
  gen_random_uuid(),
  'demo',
  clock_timestamp()
from generate_series(1, 20);

set local role service_role;

select public.admit_realtime_voice_session(
  :'cc_voice_room_id',
  :'host_user_id'
) as admission
\gset cc_voice_room_daily_

select pg_temp.assert_json_text(
  :'cc_voice_room_daily_admission'::jsonb,
  array['code'],
  'voice_room_daily_limit',
  'realtime_voice_room_daily_limit_not_enforced'
);

reset role;
delete from private.realtime_voice_admissions;
insert into private.realtime_voice_admissions (
  room_id,
  actor_user_id,
  room_mode,
  admitted_at
)
select
  gen_random_uuid(),
  gen_random_uuid(),
  'demo',
  clock_timestamp()
from generate_series(1, 30);

set local role service_role;

select public.admit_realtime_voice_session(
  :'cc_voice_room_id',
  :'host_user_id'
) as admission
\gset cc_voice_global_daily_

select pg_temp.assert_json_text(
  :'cc_voice_global_daily_admission'::jsonb,
  array['code'],
  'voice_global_daily_limit',
  'realtime_voice_global_daily_limit_not_enforced'
);

rollback;

\echo realtime_voice_admission_probes_passed
