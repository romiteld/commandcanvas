\set ON_ERROR_STOP on

-- Required inputs are two existing Supabase Auth user UUIDs. All fixtures and
-- state transitions are rolled back.

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

select
  gen_random_uuid() as demo_room_id,
  gen_random_uuid() as standard_room_id,
  gen_random_uuid() as second_standard_room_id,
  gen_random_uuid() as first_lease_token,
  gen_random_uuid() as second_lease_token,
  gen_random_uuid() as third_lease_token,
  'room-' || replace(gen_random_uuid()::text, '-', '') as demo_room_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as standard_room_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as second_room_slug,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as demo_sketch_id,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as standard_sketch_id,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as second_sketch_id
\gset cc_

insert into public.rooms (id, slug, name, mode, created_by)
values
  (:'cc_demo_room_id', :'cc_demo_room_slug', 'Demo room', 'demo', :'host_user_id'),
  (:'cc_standard_room_id', :'cc_standard_room_slug', 'Standard room', 'standard', :'host_user_id'),
  (:'cc_second_standard_room_id', :'cc_second_room_slug', 'Second room', 'standard', :'host_user_id');

insert into public.room_members (
  room_id,
  user_id,
  role,
  display_name,
  color
)
values
  (:'cc_demo_room_id', :'host_user_id', 'host', 'Probe Host', '#2563EB'),
  (:'cc_standard_room_id', :'host_user_id', 'host', 'Probe Host', '#2563EB'),
  (:'cc_second_standard_room_id', :'host_user_id', 'host', 'Probe Host', '#2563EB');

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
  (:'cc_demo_sketch_id', :'cc_demo_room_id', 'sketch', 'Demo sketch', 0, 0, 400, 280, 1, :'host_user_id', 1, 1, '{"strokes":[]}'::jsonb),
  (:'cc_standard_sketch_id', :'cc_standard_room_id', 'sketch', 'Standard sketch', 0, 0, 400, 280, 1, :'host_user_id', 1, 1, '{"strokes":[]}'::jsonb),
  (:'cc_second_sketch_id', :'cc_second_standard_room_id', 'sketch', 'Second sketch', 0, 0, 400, 280, 1, :'host_user_id', 1, 1, '{"strokes":[]}'::jsonb);

select
  repeat('a', 64) as instruction_hash,
  repeat('b', 64) as png_hash
\gset cc_

select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n',
          'v1',
          :'cc_demo_room_id',
          :'cc_demo_sketch_id',
          '1',
          'architecture',
          :'cc_instruction_hash',
          :'cc_png_hash'
        ),
        'UTF8'
      )
    ),
    'hex'
  ) as demo_request_key
\gset cc_

set local role service_role;

select public.admit_sketch_transform(
  :'cc_demo_room_id',
  :'host_user_id',
  :'cc_demo_sketch_id',
  1,
  'architecture',
  :'cc_instruction_hash',
  :'cc_png_hash',
  :'cc_demo_request_key',
  :'cc_first_lease_token'
) as admission
\gset cc_first_

select pg_temp.assert_json_text(
  :'cc_first_admission'::jsonb,
  array['outcome'],
  'admitted',
  'vision_probe_first_admission_outcome_invalid'
);
select pg_temp.assert_json_text(
  :'cc_first_admission'::jsonb,
  array['requestKey'],
  :'cc_demo_request_key',
  'vision_probe_first_admission_key_invalid'
);
select pg_temp.assert_json_text(
  :'cc_first_admission'::jsonb,
  array['leaseToken'],
  :'cc_first_lease_token',
  'vision_probe_first_admission_lease_invalid'
);

select public.admit_sketch_transform(
  :'cc_demo_room_id',
  :'host_user_id',
  :'cc_demo_sketch_id',
  1,
  'architecture',
  :'cc_instruction_hash',
  :'cc_png_hash',
  :'cc_demo_request_key',
  :'cc_second_lease_token'
) as admission
\gset cc_duplicate_

select pg_temp.assert_json_text(
  :'cc_duplicate_admission'::jsonb,
  array['code'],
  'transform_in_progress',
  'vision_probe_duplicate_not_blocked'
);

select public.complete_sketch_transform(
  :'cc_demo_request_key',
  :'cc_first_lease_token',
  'gpt-5.6-terra',
  'resp-probe-1',
  jsonb_build_object(
    'kind', 'architecture',
    'sourceSketchId', :'cc_demo_sketch_id',
    'interpretationSummary', 'A valid cached probe result.',
    'nodes', jsonb_build_array(
      jsonb_build_object(
        'id', 'node-probe',
        'label', 'Probe',
        'kind', 'service',
        'x', 20,
        'y', 20,
        'width', 160,
        'height', 80
      )
    ),
    'edges', '[]'::jsonb
  )
);

select public.admit_sketch_transform(
  :'cc_demo_room_id',
  :'host_user_id',
  :'cc_demo_sketch_id',
  1,
  'architecture',
  :'cc_instruction_hash',
  :'cc_png_hash',
  :'cc_demo_request_key',
  :'cc_third_lease_token'
) as admission
\gset cc_cached_

select pg_temp.assert_json_text(
  :'cc_cached_admission'::jsonb,
  array['outcome'],
  'cached',
  'vision_probe_cache_outcome_invalid'
);
select pg_temp.assert_json_text(
  :'cc_cached_admission'::jsonb,
  array['transform', 'responseId'],
  'resp-probe-1',
  'vision_probe_cache_response_invalid'
);

reset role;
select pg_temp.assert_true(
  (
    select pg_catalog.count(*) = 1
    from private.sketch_transform_attempts
    where request_key = :'cc_demo_request_key'
  ),
  'vision_probe_cached_request_recounted'
);
set local role service_role;

-- A second active key in the same room must be denied without consuming an
-- attempt. The exact key is independently calculated from its changed PNG.
select repeat('c', 64) as second_png_hash
\gset cc_
select
  'vision_v1_' || encode(
    sha256(convert_to(concat_ws(E'\n', 'v1', :'cc_demo_room_id', :'cc_demo_sketch_id', '1', 'architecture', :'cc_instruction_hash', :'cc_second_png_hash'), 'UTF8')),
    'hex'
  ) as second_demo_key
\gset cc_

-- Reopen the first request as active to exercise the room-level lease guard.
reset role;
update private.sketch_transform_admissions
set
  status = 'active',
  lease_token = :'cc_first_lease_token',
  lease_expires_at = clock_timestamp() + interval '90 seconds',
  result_model = null,
  result_response_id = null,
  result_payload = null,
  completed_at = null
where request_key = :'cc_demo_request_key';
set local role service_role;

select public.admit_sketch_transform(
  :'cc_demo_room_id', :'host_user_id', :'cc_demo_sketch_id', 1,
  'architecture', :'cc_instruction_hash', :'cc_second_png_hash',
  :'cc_second_demo_key', :'cc_second_lease_token'
) as admission
\gset cc_busy_

select pg_temp.assert_json_text(
  :'cc_busy_admission'::jsonb,
  array['code'],
  'room_transform_busy',
  'vision_probe_room_concurrency_missing'
);

-- The exact lease can be released idempotently. A different token cannot
-- release or complete it.
select public.release_sketch_transform(
  :'cc_demo_request_key', :'cc_second_lease_token', 'request_cancelled'
) as release
\gset cc_wrong_
select pg_temp.assert_json_text(
  :'cc_wrong_release'::jsonb,
  array['released'],
  'false',
  'vision_probe_wrong_lease_released'
);

select public.release_sketch_transform(
  :'cc_demo_request_key', :'cc_first_lease_token', 'request_cancelled'
) as release
\gset cc_release_
select public.release_sketch_transform(
  :'cc_demo_request_key', :'cc_first_lease_token', 'request_cancelled'
) as release
\gset cc_repeat_
select pg_temp.assert_json_text(
  :'cc_release_release'::jsonb,
  array['released'],
  'true',
  'vision_probe_release_failed'
);
select pg_temp.assert_json_text(
  :'cc_repeat_release'::jsonb,
  array['released'],
  'true',
  'vision_probe_release_not_idempotent'
);

-- Seed prior attempts as the migration owner to hit each allowance branch.
reset role;

insert into private.sketch_transform_admissions (
  request_key, room_id, actor_user_id, sketch_object_id, source_version,
  output_kind, normalized_instruction_sha256, png_sha256, status,
  lease_token, attempt_count, admitted_at, released_at, last_error_code,
  updated_at
)
select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n', 'v1', :'cc_demo_room_id', :'cc_demo_sketch_id', '1',
          'architecture', repeat('d', 64),
          encode(sha256(convert_to('demo-png-' || series::text, 'UTF8')), 'hex')
        ),
        'UTF8'
      )
    ),
    'hex'
  ),
  :'cc_demo_room_id', :'host_user_id', :'cc_demo_sketch_id', 1,
  'architecture', repeat('d', 64),
  encode(sha256(convert_to('demo-png-' || series::text, 'UTF8')), 'hex'),
  'released', gen_random_uuid(), 1,
  clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day',
  'request_cancelled', clock_timestamp() - interval '1 day'
from generate_series(1, 2) series;

insert into private.sketch_transform_attempts (
  request_key, room_id, actor_user_id, admitted_at
)
select request_key, room_id, actor_user_id, admitted_at
from private.sketch_transform_admissions
where room_id = :'cc_demo_room_id'
  and request_key <> :'cc_demo_request_key';

-- Move the first attempt outside the actor short window while keeping the
-- room-lifetime demo count at three.
update private.sketch_transform_attempts
set admitted_at = clock_timestamp() - interval '1 day'
where room_id = :'cc_demo_room_id';

set local role service_role;

select repeat('e', 64) as png_hash
\gset cc_demo_limit_
select
  'vision_v1_' || encode(
    sha256(convert_to(concat_ws(E'\n', 'v1', :'cc_demo_room_id', :'cc_demo_sketch_id', '1', 'architecture', :'cc_instruction_hash', :'cc_demo_limit_png_hash'), 'UTF8')),
    'hex'
  ) as request_key
\gset cc_demo_limit_
select public.admit_sketch_transform(
  :'cc_demo_room_id', :'host_user_id', :'cc_demo_sketch_id', 1,
  'architecture', :'cc_instruction_hash', :'cc_demo_limit_png_hash',
  :'cc_demo_limit_request_key', gen_random_uuid()
) as admission
\gset cc_demo_limit_
select pg_temp.assert_json_text(
  :'cc_demo_limit_admission'::jsonb,
  array['code'],
  'demo_transform_limit',
  'vision_probe_demo_limit_missing'
);

-- Standard-room daily allowance: 20 previous paid admissions in the room.
reset role;
insert into private.sketch_transform_admissions (
  request_key, room_id, actor_user_id, sketch_object_id, source_version,
  output_kind, normalized_instruction_sha256, png_sha256, status,
  lease_token, attempt_count, admitted_at, released_at, last_error_code,
  updated_at
)
select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n', 'v1', :'cc_standard_room_id', :'cc_standard_sketch_id', '1',
          'architecture', repeat('f', 64),
          encode(sha256(convert_to('daily-png-' || series::text, 'UTF8')), 'hex')
        ),
        'UTF8'
      )
    ),
    'hex'
  ),
  :'cc_standard_room_id', :'participant_user_id', :'cc_standard_sketch_id', 1,
  'architecture', repeat('f', 64),
  encode(sha256(convert_to('daily-png-' || series::text, 'UTF8')), 'hex'),
  'released', gen_random_uuid(), 1,
  clock_timestamp(), clock_timestamp(), 'provider_unavailable',
  clock_timestamp()
from generate_series(1, 20) series;

insert into private.sketch_transform_attempts (
  request_key, room_id, actor_user_id, admitted_at
)
select request_key, room_id, actor_user_id, admitted_at
from private.sketch_transform_admissions
where room_id = :'cc_standard_room_id';

set local role service_role;
select repeat('1', 64) as png_hash
\gset cc_daily_limit_
select
  'vision_v1_' || encode(
    sha256(convert_to(concat_ws(E'\n', 'v1', :'cc_standard_room_id', :'cc_standard_sketch_id', '1', 'architecture', :'cc_instruction_hash', :'cc_daily_limit_png_hash'), 'UTF8')),
    'hex'
  ) as request_key
\gset cc_daily_limit_
select public.admit_sketch_transform(
  :'cc_standard_room_id', :'host_user_id', :'cc_standard_sketch_id', 1,
  'architecture', :'cc_instruction_hash', :'cc_daily_limit_png_hash',
  :'cc_daily_limit_request_key', gen_random_uuid()
) as admission
\gset cc_daily_limit_
select pg_temp.assert_json_text(
  :'cc_daily_limit_admission'::jsonb,
  array['code'],
  'daily_transform_limit',
  'vision_probe_daily_limit_missing'
);

-- Two recent admissions by one actor across rooms are enough to deny the
-- third before it consumes another attempt.
reset role;
delete from private.sketch_transform_attempts
where actor_user_id = :'host_user_id'
  and admitted_at >= clock_timestamp() - interval '60 seconds';

insert into private.sketch_transform_admissions (
  request_key, room_id, actor_user_id, sketch_object_id, source_version,
  output_kind, normalized_instruction_sha256, png_sha256, status,
  lease_token, attempt_count, admitted_at, released_at, last_error_code,
  updated_at
)
select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n', 'v1', :'cc_second_standard_room_id', :'cc_second_sketch_id', '1',
          'architecture', repeat('2', 64),
          encode(sha256(convert_to('rate-png-' || series::text, 'UTF8')), 'hex')
        ),
        'UTF8'
      )
    ),
    'hex'
  ),
  :'cc_second_standard_room_id', :'host_user_id', :'cc_second_sketch_id', 1,
  'architecture', repeat('2', 64),
  encode(sha256(convert_to('rate-png-' || series::text, 'UTF8')), 'hex'),
  'released', gen_random_uuid(), 1,
  clock_timestamp(), clock_timestamp(), 'request_cancelled',
  clock_timestamp()
from generate_series(1, 2) series;

insert into private.sketch_transform_attempts (
  request_key, room_id, actor_user_id, admitted_at
)
select request_key, room_id, actor_user_id, admitted_at
from private.sketch_transform_admissions
where room_id = :'cc_second_standard_room_id';

set local role service_role;
select repeat('3', 64) as png_hash
\gset cc_rate_limit_
select
  'vision_v1_' || encode(
    sha256(convert_to(concat_ws(E'\n', 'v1', :'cc_second_standard_room_id', :'cc_second_sketch_id', '1', 'architecture', :'cc_instruction_hash', :'cc_rate_limit_png_hash'), 'UTF8')),
    'hex'
  ) as request_key
\gset cc_rate_limit_
select public.admit_sketch_transform(
  :'cc_second_standard_room_id', :'host_user_id', :'cc_second_sketch_id', 1,
  'architecture', :'cc_instruction_hash', :'cc_rate_limit_png_hash',
  :'cc_rate_limit_request_key', gen_random_uuid()
) as admission
\gset cc_rate_limit_
select pg_temp.assert_json_text(
  :'cc_rate_limit_admission'::jsonb,
  array['code'],
  'transform_rate_limited',
  'vision_probe_actor_rate_limit_missing'
);

rollback;

\echo vision_admission_probes_passed
