\set ON_ERROR_STOP on

-- Required input: host_user_id for an existing Supabase Auth user. The probe
-- exercises auto admission and concrete chart completion, then rolls back.
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

create function pg_temp.assert_admission_raises(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_sketch_object_id text,
  p_source_version bigint,
  p_output_kind text,
  p_instruction_hash text,
  p_png_hash text,
  p_request_key text,
  p_lease_token uuid,
  p_narration_hash text,
  p_expected_message text
)
returns void
language plpgsql
as $$
begin
  begin
    perform public.admit_sketch_transform(
      p_room_id,
      p_actor_user_id,
      p_sketch_object_id,
      p_source_version,
      p_output_kind,
      p_instruction_hash,
      p_png_hash,
      p_request_key,
      p_lease_token,
      p_narration_hash
    );
    raise exception 'expected_admission_error_missing:%', p_expected_message;
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from p_expected_message then
      raise exception 'unexpected_admission_error:expected=% actual=%',
        p_expected_message,
        sqlerrm;
    end if;
  end;
end;
$$;

create function pg_temp.assert_completion_raises(
  p_request_key text,
  p_lease_token uuid,
  p_payload jsonb,
  p_expected_message text
)
returns void
language plpgsql
as $$
begin
  begin
    perform public.complete_sketch_transform(
      p_request_key,
      p_lease_token,
      'gpt-5.6-terra',
      'resp-general-visual-negative-probe',
      p_payload
    );
    raise exception 'expected_completion_error_missing:%', p_expected_message;
  exception when sqlstate 'P0001' then
    if sqlerrm is distinct from p_expected_message then
      raise exception 'unexpected_completion_error:expected=% actual=%',
        p_expected_message,
        sqlerrm;
    end if;
  end;
end;
$$;

select
  gen_random_uuid() as room_id,
  gen_random_uuid() as legacy_room_id,
  gen_random_uuid() as lease_token,
  gen_random_uuid() as legacy_lease_token,
  gen_random_uuid() as explicit_lease_token,
  'room-' || replace(gen_random_uuid()::text, '-', '') as room_slug,
  'room-' || replace(gen_random_uuid()::text, '-', '') as legacy_room_slug,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as sketch_id,
  'sketch-' || replace(gen_random_uuid()::text, '-', '') as legacy_sketch_id,
  repeat('a', 64) as instruction_hash,
  repeat('c', 64) as narration_hash,
  repeat('b', 64) as png_hash
\gset visual_

insert into public.rooms (id, slug, name, mode, created_by)
values
  (
    :'visual_room_id',
    :'visual_room_slug',
    'General visual probe',
    'standard',
    :'host_user_id'
  ),
  (
    :'visual_legacy_room_id',
    :'visual_legacy_room_slug',
    'Legacy key probe',
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
values
  (
    :'visual_room_id',
    :'host_user_id',
    'host',
    'Visual Probe Host',
    '#2563EB'
  ),
  (
    :'visual_legacy_room_id',
    :'host_user_id',
    'host',
    'Visual Probe Host',
    '#2563EB'
  );

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
  (
    :'visual_sketch_id',
    :'visual_room_id',
    'sketch',
    'Chart sketch',
    0,
    0,
    400,
    280,
    1,
    :'host_user_id',
    1,
    1,
    '{"strokes":[]}'::jsonb
  ),
  (
    :'visual_legacy_sketch_id',
    :'visual_legacy_room_id',
    'sketch',
    'No narration sketch',
    0,
    0,
    400,
    280,
    1,
    :'host_user_id',
    1,
    1,
    '{"strokes":[]}'::jsonb
  );

select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n',
          'v1',
          :'visual_room_id',
          :'visual_sketch_id',
          '1',
          'auto',
          :'visual_instruction_hash',
          :'visual_narration_hash',
          :'visual_png_hash'
        ),
        'UTF8'
      )
    ),
    'hex'
  ) as request_key
\gset visual_

set local role service_role;

-- Malformed narration and unsupported output kinds fail before any paid-work
-- admission. A key that omits a present narration hash is also rejected.
select pg_temp.assert_admission_raises(
  :'visual_room_id',
  :'host_user_id',
  :'visual_sketch_id',
  1,
  'auto',
  :'visual_instruction_hash',
  :'visual_png_hash',
  :'visual_request_key',
  gen_random_uuid(),
  'not-a-sha256',
  'vision_admission_input_invalid'
);

select pg_temp.assert_admission_raises(
  :'visual_room_id',
  :'host_user_id',
  :'visual_sketch_id',
  1,
  'scatter_plot',
  :'visual_instruction_hash',
  :'visual_png_hash',
  :'visual_request_key',
  gen_random_uuid(),
  :'visual_narration_hash',
  'vision_admission_input_invalid'
);

select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n',
          'v1',
          :'visual_room_id',
          :'visual_sketch_id',
          '1',
          'auto',
          :'visual_instruction_hash',
          :'visual_png_hash'
        ),
        'UTF8'
      )
    ),
    'hex'
  ) as missing_narration_key
\gset visual_

select pg_temp.assert_admission_raises(
  :'visual_room_id',
  :'host_user_id',
  :'visual_sketch_id',
  1,
  'auto',
  :'visual_instruction_hash',
  :'visual_png_hash',
  :'visual_missing_narration_key',
  gen_random_uuid(),
  :'visual_narration_hash',
  'vision_admission_key_invalid'
);

select public.admit_sketch_transform(
  :'visual_room_id',
  :'host_user_id',
  :'visual_sketch_id',
  1,
  'auto',
  :'visual_instruction_hash',
  :'visual_png_hash',
  :'visual_request_key',
  :'visual_lease_token',
  :'visual_narration_hash'
) as admission
\gset visual_

select pg_temp.assert_json_text(
  :'visual_admission'::jsonb,
  array['outcome'],
  'admitted',
  'general_visual_auto_admission_failed'
);

reset role;
select pg_temp.assert_json_text(
  to_jsonb(
    (
      select normalized_narration_sha256
      from private.sketch_transform_admissions
      where request_key = :'visual_request_key'
    )
  ),
  array[]::text[],
  :'visual_narration_hash',
  'general_visual_narration_hash_not_persisted'
);
set local role service_role;

select public.complete_sketch_transform(
  :'visual_request_key',
  :'visual_lease_token',
  'gpt-5.6-terra',
  'resp-general-visual-probe',
  jsonb_build_object(
    'kind', 'pie_chart',
    'sourceSketchId', :'visual_sketch_id',
    'interpretationSummary', 'Two values transcribed from the drawing.',
    'chart', jsonb_build_object(
      'title', 'Share',
      'xAxisLabel', null,
      'yAxisLabel', null,
      'series', jsonb_build_array(
        jsonb_build_object(
          'id', 'series-share',
          'label', 'Share',
          'points', jsonb_build_array(
            jsonb_build_object('label', 'A', 'value', 70),
            jsonb_build_object('label', 'B', 'value', 30)
          )
        )
      )
    )
  )
) as completion
\gset visual_

select pg_temp.assert_json_text(
  :'visual_completion'::jsonb,
  array['completed'],
  'true',
  'general_visual_chart_completion_failed'
);

-- With no narration, concat_ws skips the nullable digest and preserves the
-- exact pre-migration request-key identity.
select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n',
          'v1',
          :'visual_legacy_room_id',
          :'visual_legacy_sketch_id',
          '1',
          'diagram',
          :'visual_instruction_hash',
          :'visual_png_hash'
        ),
        'UTF8'
      )
    ),
    'hex'
  ) as legacy_request_key
\gset visual_

select public.admit_sketch_transform(
  :'visual_legacy_room_id',
  :'host_user_id',
  :'visual_legacy_sketch_id',
  1,
  'diagram',
  :'visual_instruction_hash',
  :'visual_png_hash',
  :'visual_legacy_request_key',
  :'visual_legacy_lease_token',
  null
) as admission
\gset visual_legacy_

select pg_temp.assert_json_text(
  :'visual_legacy_admission'::jsonb,
  array['outcome'],
  'admitted',
  'general_visual_legacy_key_admission_failed'
);

select public.complete_sketch_transform(
  :'visual_legacy_request_key',
  :'visual_legacy_lease_token',
  'gpt-5.6-terra',
  'resp-general-visual-legacy-probe',
  jsonb_build_object(
    'kind', 'diagram',
    'sourceSketchId', :'visual_legacy_sketch_id'
  )
);

-- Clear the probe-only attempt window, admit an explicit kind, and prove a
-- different concrete payload kind is refused.
reset role;
delete from private.sketch_transform_attempts
where actor_user_id = :'host_user_id'
  and room_id in (:'visual_room_id', :'visual_legacy_room_id');
set local role service_role;

select
  'vision_v1_' || encode(
    sha256(
      convert_to(
        concat_ws(
          E'\n',
          'v1',
          :'visual_legacy_room_id',
          :'visual_legacy_sketch_id',
          '1',
          'bar_chart',
          repeat('d', 64),
          :'visual_png_hash'
        ),
        'UTF8'
      )
    ),
    'hex'
  ) as explicit_request_key
\gset visual_

select public.admit_sketch_transform(
  :'visual_legacy_room_id',
  :'host_user_id',
  :'visual_legacy_sketch_id',
  1,
  'bar_chart',
  repeat('d', 64),
  :'visual_png_hash',
  :'visual_explicit_request_key',
  :'visual_explicit_lease_token',
  null
) as admission
\gset visual_explicit_

select pg_temp.assert_json_text(
  :'visual_explicit_admission'::jsonb,
  array['outcome'],
  'admitted',
  'general_visual_explicit_admission_failed'
);

select pg_temp.assert_completion_raises(
  :'visual_explicit_request_key',
  :'visual_explicit_lease_token',
  jsonb_build_object(
    'kind', 'line_chart',
    'sourceSketchId', :'visual_legacy_sketch_id'
  ),
  'vision_completion_payload_mismatch'
);

rollback;

\echo general_visual_admission_probes_passed
