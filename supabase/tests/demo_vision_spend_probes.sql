\set ON_ERROR_STOP on

-- Required inputs are two existing Supabase Auth user UUIDs. The transaction
-- proves that demo usage survives room deletion and that actor/global daily
-- circuit breakers fail closed before a provider admission can be returned.

begin;

create function pg_temp.assert_true(
  p_value boolean,
  p_error_code text
)
returns void
language plpgsql
as $$
begin
  if p_value is distinct from true then
    raise exception '%', p_error_code;
  end if;
end;
$$;

create function pg_temp.assert_demo_limit(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_sketch_object_id text,
  p_instruction_hash text,
  p_png_hash text,
  p_expected_code text
)
returns void
language plpgsql
as $$
declare
  v_key text := 'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n',
          'v1',
          p_room_id::text,
          p_sketch_object_id,
          '1',
          'architecture',
          p_instruction_hash,
          p_png_hash
        ),
        'UTF8'
      )
    ),
    'hex'
  );
begin
  perform public.admit_sketch_transform(
    p_room_id,
    p_actor_user_id,
    p_sketch_object_id,
    1,
    'architecture',
    p_instruction_hash,
    p_png_hash,
    v_key,
    gen_random_uuid()
  );
  raise exception '%_not_enforced', p_expected_code;
exception
  when sqlstate 'P0001' then
    if sqlerrm <> p_expected_code then
      raise;
    end if;
end;
$$;

select
  gen_random_uuid() as first_room_id,
  gen_random_uuid() as actor_limit_room_id,
  gen_random_uuid() as global_limit_room_id,
  'room-' || replace(gen_random_uuid()::text, '-', '') as first_room_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as actor_room_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as global_room_slug,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as first_sketch_id,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as actor_sketch_id,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as global_sketch_id,
  repeat('a', 64) as instruction_hash,
  repeat('b', 64) as first_png_hash,
  repeat('c', 64) as actor_png_hash,
  repeat('d', 64) as global_png_hash
\gset cc_spend_

delete from private.demo_vision_usage
where actor_user_id in (:'host_user_id', :'participant_user_id')
  and admitted_at >= (
    date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC'
  );

insert into public.rooms (id, slug, name, mode, created_by)
values
  (:'cc_spend_first_room_id', :'cc_spend_first_room_slug', 'Spend probe one', 'demo', :'host_user_id'),
  (:'cc_spend_actor_limit_room_id', :'cc_spend_actor_room_slug', 'Spend probe actor', 'demo', :'host_user_id'),
  (:'cc_spend_global_limit_room_id', :'cc_spend_global_room_slug', 'Spend probe global', 'demo', :'participant_user_id');

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
)
values
  (:'cc_spend_first_room_id', :'host_user_id', 'host', 'Probe Host', '#2563EB'),
  (:'cc_spend_actor_limit_room_id', :'host_user_id', 'host', 'Probe Host', '#2563EB'),
  (:'cc_spend_global_limit_room_id', :'participant_user_id', 'host', 'Probe Participant', '#7C3AED');

insert into public.canvas_objects (
  id,
  room_id,
  object_type,
  title,
  x,
  y,
  width,
  height,
  z_index,
  created_by,
  version,
  revision,
  payload
)
values
  (:'cc_spend_first_sketch_id', :'cc_spend_first_room_id', 'sketch', 'First sketch', 0, 0, 400, 280, 1, :'host_user_id', 1, 1, '{"strokes":[]}'::jsonb),
  (:'cc_spend_actor_sketch_id', :'cc_spend_actor_limit_room_id', 'sketch', 'Actor sketch', 0, 0, 400, 280, 1, :'host_user_id', 1, 1, '{"strokes":[]}'::jsonb),
  (:'cc_spend_global_sketch_id', :'cc_spend_global_limit_room_id', 'sketch', 'Global sketch', 0, 0, 400, 280, 1, :'participant_user_id', 1, 1, '{"strokes":[]}'::jsonb);

select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n',
          'v1',
          :'cc_spend_first_room_id',
          :'cc_spend_first_sketch_id',
          '1',
          'architecture',
          :'cc_spend_instruction_hash',
          :'cc_spend_first_png_hash'
        ),
        'UTF8'
      )
    ),
    'hex'
  ) as first_request_key
\gset cc_spend_

select public.admit_sketch_transform(
  :'cc_spend_first_room_id',
  :'host_user_id',
  :'cc_spend_first_sketch_id',
  1,
  'architecture',
  :'cc_spend_instruction_hash',
  :'cc_spend_first_png_hash',
  :'cc_spend_first_request_key',
  gen_random_uuid()
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from private.demo_vision_usage
    where actor_user_id = :'host_user_id'
      and request_key = :'cc_spend_first_request_key'
  ),
  'demo_vision_usage_not_recorded'
);

delete from public.rooms where id = :'cc_spend_first_room_id';

select pg_temp.assert_true(
  (
    select count(*) = 1
    from private.demo_vision_usage
    where actor_user_id = :'host_user_id'
      and request_key = :'cc_spend_first_request_key'
  ),
  'demo_vision_usage_did_not_survive_room_delete'
);

insert into private.demo_vision_usage (
  actor_user_id,
  room_id,
  request_key,
  admitted_at
)
select
  :'host_user_id',
  :'cc_spend_actor_limit_room_id',
  'vision_v1_' || encode(
    sha256(convert_to('actor-seed-' || series::text, 'UTF8')),
    'hex'
  ),
  clock_timestamp()
from generate_series(1, 5) series;

select pg_temp.assert_demo_limit(
  :'cc_spend_actor_limit_room_id',
  :'host_user_id',
  :'cc_spend_actor_sketch_id',
  :'cc_spend_instruction_hash',
  :'cc_spend_actor_png_hash',
  'demo_actor_daily_limit'
);

delete from private.demo_vision_usage;

insert into private.demo_vision_usage (
  actor_user_id,
  room_id,
  request_key,
  admitted_at
)
select
  :'host_user_id',
  :'cc_spend_actor_limit_room_id',
  'vision_v1_' || encode(
    sha256(convert_to('global-seed-' || series::text, 'UTF8')),
    'hex'
  ),
  clock_timestamp()
from generate_series(1, 60) series;

select pg_temp.assert_demo_limit(
  :'cc_spend_global_limit_room_id',
  :'participant_user_id',
  :'cc_spend_global_sketch_id',
  :'cc_spend_instruction_hash',
  :'cc_spend_global_png_hash',
  'demo_global_daily_limit'
);

rollback;

\echo demo_vision_spend_probes_passed
