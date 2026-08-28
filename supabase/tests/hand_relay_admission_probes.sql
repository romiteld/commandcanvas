\set ON_ERROR_STOP on

-- Required input: host_user_id, an existing Supabase Auth user UUID. All room
-- fixtures and durable admission attempts are rolled back.
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

select
  gen_random_uuid() as room_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug
\gset cc_hand_relay_

insert into public.rooms (id, slug, name, mode, created_by)
values (
  :'cc_hand_relay_room_id',
  :'cc_hand_relay_room_slug',
  'Private hand relay admission probe',
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
  :'cc_hand_relay_room_id',
  :'host_user_id',
  'host',
  'Probe Host',
  '#2563EB'
);

delete from private.hand_relay_session_admissions;
set local role service_role;

select public.admit_private_hand_relay_session(
  :'cc_hand_relay_room_id',
  :'host_user_id'
) as admission
\gset cc_hand_relay_first_

select pg_temp.assert_json_text(
  :'cc_hand_relay_first_admission'::jsonb,
  array['outcome'],
  'admitted',
  'hand_relay_first_admission_invalid'
);

select public.admit_private_hand_relay_session(
  :'cc_hand_relay_room_id', :'host_user_id'
)
from generate_series(1, 9);

select public.admit_private_hand_relay_session(
  :'cc_hand_relay_room_id', :'host_user_id'
) as admission
\gset cc_hand_relay_actor_limited_

select pg_temp.assert_json_text(
  :'cc_hand_relay_actor_limited_admission'::jsonb,
  array['code'],
  'hand_relay_actor_rate_limit',
  'hand_relay_actor_limit_not_enforced'
);

reset role;
delete from private.hand_relay_session_admissions;
insert into private.hand_relay_session_admissions (
  room_id,
  actor_user_id,
  admitted_at
)
select
  gen_random_uuid(),
  gen_random_uuid(),
  clock_timestamp()
from generate_series(1, 120);

set local role service_role;

select public.admit_private_hand_relay_session(
  :'cc_hand_relay_room_id', :'host_user_id'
) as admission
\gset cc_hand_relay_global_burst_limited_

select pg_temp.assert_json_text(
  :'cc_hand_relay_global_burst_limited_admission'::jsonb,
  array['code'],
  'hand_relay_global_burst_rate_limit',
  'hand_relay_global_burst_limit_not_enforced'
);

reset role;
delete from private.hand_relay_session_admissions;
insert into private.hand_relay_session_admissions (
  room_id,
  actor_user_id,
  admitted_at
)
select
  gen_random_uuid(),
  gen_random_uuid(),
  clock_timestamp() - interval '1 hour'
from generate_series(1, 600);

set local role service_role;

select public.admit_private_hand_relay_session(
  :'cc_hand_relay_room_id', :'host_user_id'
) as admission
\gset cc_hand_relay_global_daily_limited_

select pg_temp.assert_json_text(
  :'cc_hand_relay_global_daily_limited_admission'::jsonb,
  array['code'],
  'hand_relay_global_daily_rate_limit',
  'hand_relay_global_daily_limit_not_enforced'
);

reset role;
delete from private.hand_relay_session_admissions;
insert into private.hand_relay_session_admissions (
  room_id,
  actor_user_id,
  admitted_at
)
select
  :'cc_hand_relay_room_id',
  gen_random_uuid(),
  clock_timestamp()
from generate_series(1, 60);

set local role service_role;

select public.admit_private_hand_relay_session(
  :'cc_hand_relay_room_id', :'host_user_id'
) as admission
\gset cc_hand_relay_room_limited_

select pg_temp.assert_json_text(
  :'cc_hand_relay_room_limited_admission'::jsonb,
  array['code'],
  'hand_relay_room_rate_limit',
  'hand_relay_room_limit_not_enforced'
);

rollback;

\echo hand_relay_admission_probes_passed
