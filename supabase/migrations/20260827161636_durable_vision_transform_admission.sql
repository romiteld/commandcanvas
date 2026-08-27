begin;

-- Paid vision work is admitted through lease-bound RPCs. The underlying state
-- stays outside the exposed schema, and even service_role has no direct table
-- privileges; this keeps every provider call behind one atomic policy.
create table private.sketch_transform_admissions (
  request_key text primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  sketch_object_id text not null
    check (
      pg_catalog.char_length(sketch_object_id) between 2 and 96
      and sketch_object_id ~ '^[a-z][a-z0-9-]*$'
    ),
  source_version bigint not null check (source_version >= 1),
  output_kind text not null check (output_kind in ('architecture', 'flowchart')),
  normalized_instruction_sha256 text not null
    check (normalized_instruction_sha256 ~ '^[0-9a-f]{64}$'),
  png_sha256 text not null check (png_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('active', 'completed', 'released')),
  lease_token uuid not null,
  lease_expires_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count >= 1),
  result_model text check (result_model in ('gpt-5.6-terra', 'gpt-5.6-sol')),
  result_response_id text
    check (
      result_response_id is null
      or (
        pg_catalog.char_length(result_response_id) between 1 and 160
        and result_response_id !~ '[[:cntrl:]]'
      )
    ),
  result_payload jsonb,
  last_error_code text
    check (
      last_error_code is null
      or last_error_code in (
        'vision_unconfigured',
        'provider_unavailable',
        'invalid_provider_response',
        'request_cancelled',
        'lease_expired'
      )
    ),
  admitted_at timestamptz not null,
  completed_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz not null,
  constraint sketch_transform_admission_key_exact check (
    request_key = 'vision_v1_' || pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.concat_ws(
            E'\n',
            'v1',
            room_id::text,
            sketch_object_id,
            source_version::text,
            output_kind,
            normalized_instruction_sha256,
            png_sha256
          ),
          'UTF8'
        )
      ),
      'hex'
    )
  ),
  constraint sketch_transform_admission_payload_bound check (
    result_payload is null
    or (
      pg_catalog.jsonb_typeof(result_payload) = 'object'
      and result_payload ->> 'sourceSketchId' = sketch_object_id
      and result_payload ->> 'kind' = output_kind
    )
  ),
  constraint sketch_transform_admission_lifecycle_exact check (
    (
      status = 'active'
      and lease_expires_at is not null
      and result_model is null
      and result_response_id is null
      and result_payload is null
      and last_error_code is null
      and completed_at is null
      and released_at is null
    )
    or
    (
      status = 'completed'
      and lease_expires_at is null
      and result_model is not null
      and result_response_id is not null
      and result_payload is not null
      and last_error_code is null
      and completed_at is not null
      and released_at is null
    )
    or
    (
      status = 'released'
      and lease_expires_at is null
      and result_model is null
      and result_response_id is null
      and result_payload is null
      and last_error_code is not null
      and completed_at is null
      and released_at is not null
    )
  )
);

create table private.sketch_transform_attempts (
  id bigint generated always as identity primary key,
  request_key text not null
    references private.sketch_transform_admissions(request_key)
    on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  admitted_at timestamptz not null
);

create index sketch_transform_admissions_room_lease_idx
  on private.sketch_transform_admissions(room_id, lease_expires_at)
  where status = 'active';

create index sketch_transform_attempts_actor_window_idx
  on private.sketch_transform_attempts(actor_user_id, admitted_at desc);

create index sketch_transform_attempts_room_time_idx
  on private.sketch_transform_attempts(room_id, admitted_at desc);

alter table private.sketch_transform_admissions enable row level security;
alter table private.sketch_transform_attempts enable row level security;

revoke all privileges on table private.sketch_transform_admissions
  from public, anon, authenticated, service_role;
revoke all privileges on table private.sketch_transform_attempts
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.sketch_transform_attempts_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.admit_sketch_transform(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_sketch_object_id text,
  p_source_version bigint,
  p_output_kind text,
  p_normalized_instruction_sha256 text,
  p_png_sha256 text,
  p_request_key text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_lease_expires_at timestamptz;
  v_expected_key text;
  v_room_mode text;
  v_existing private.sketch_transform_admissions%rowtype;
  v_has_existing boolean := false;
  v_count bigint;
  v_oldest timestamptz;
  v_retry_after integer;
begin
  if p_room_id is null
     or p_actor_user_id is null
     or p_lease_token is null
     or p_sketch_object_id is null
     or pg_catalog.char_length(p_sketch_object_id) not between 2 and 96
     or p_sketch_object_id !~ '^[a-z][a-z0-9-]*$'
     or p_source_version is null
     or p_source_version < 1
     or p_output_kind not in ('architecture', 'flowchart')
     or p_normalized_instruction_sha256 !~ '^[0-9a-f]{64}$'
     or p_png_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = 'P0001',
      message = 'vision_admission_input_invalid';
  end if;

  v_expected_key := 'vision_v1_' || pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          E'\n',
          'v1',
          p_room_id::text,
          p_sketch_object_id,
          p_source_version::text,
          p_output_kind,
          p_normalized_instruction_sha256,
          p_png_sha256
        ),
        'UTF8'
      )
    ),
    'hex'
  );

  if p_request_key is distinct from v_expected_key then
    raise exception using
      errcode = 'P0001',
      message = 'vision_admission_key_invalid';
  end if;

  -- Global actor and room locks make the independent rate, concurrency, and
  -- allowance reads one atomic admission decision across Vercel instances.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:vision:actor:' || p_actor_user_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:vision:room:' || p_room_id::text,
      0
    )
  );

  select room.mode
  into v_room_mode
  from public.rooms room
  join public.room_members member
    on member.room_id = room.id
   and member.user_id = p_actor_user_id
  where room.id = p_room_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'vision_member_required';
  end if;

  if not exists (
    select 1
    from public.canvas_objects object_row
    where object_row.room_id = p_room_id
      and object_row.id = p_sketch_object_id
      and object_row.object_type = 'sketch'
      and object_row.deleted_at is null
      and object_row.version = p_source_version
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'vision_source_changed';
  end if;

  -- A crashed or timed-out function cannot strand a room. A later admission
  -- atomically expires its abandoned lease before checking concurrency.
  update private.sketch_transform_admissions admission
  set
    status = 'released',
    lease_expires_at = null,
    last_error_code = 'lease_expired',
    released_at = v_now,
    updated_at = v_now
  where admission.room_id = p_room_id
    and admission.status = 'active'
    and admission.lease_expires_at <= v_now;

  select admission.*
  into v_existing
  from private.sketch_transform_admissions admission
  where admission.request_key = p_request_key
  for update;
  v_has_existing := found;

  if v_has_existing
     and (
       v_existing.room_id is distinct from p_room_id
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.sketch_object_id is distinct from p_sketch_object_id
       or v_existing.source_version is distinct from p_source_version
       or v_existing.output_kind is distinct from p_output_kind
       or v_existing.normalized_instruction_sha256 is distinct from
          p_normalized_instruction_sha256
       or v_existing.png_sha256 is distinct from p_png_sha256
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'vision_admission_identity_conflict';
  end if;

  if v_has_existing and v_existing.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'cached',
      'requestKey', v_existing.request_key,
      'transform', pg_catalog.jsonb_build_object(
        'model', v_existing.result_model,
        'responseId', v_existing.result_response_id,
        'payload', v_existing.result_payload
      )
    );
  end if;

  if v_has_existing and v_existing.status = 'active' then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch from (v_existing.lease_expires_at - v_now)
        )
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'transform_in_progress',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(attempt.admitted_at)
  into v_count, v_oldest
  from private.sketch_transform_attempts attempt
  where attempt.actor_user_id = p_actor_user_id
    and attempt.admitted_at > v_now - interval '60 seconds';

  if v_count >= 2 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch from ((v_oldest + interval '60 seconds') - v_now)
        )
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'transform_rate_limited',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(admission.lease_expires_at)
  into v_count, v_oldest
  from private.sketch_transform_admissions admission
  where admission.room_id = p_room_id
    and admission.status = 'active';

  if v_count >= 1 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from (v_oldest - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'room_transform_busy',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  if v_room_mode = 'demo' then
    select pg_catalog.count(*)
    into v_count
    from private.sketch_transform_attempts attempt
    where attempt.room_id = p_room_id;

    if v_count >= 3 then
      return pg_catalog.jsonb_build_object(
        'outcome', 'denied',
        'code', 'demo_transform_limit',
        'retryAfterSeconds', 86400
      );
    end if;
  else
    select pg_catalog.count(*)
    into v_count
    from private.sketch_transform_attempts attempt
    where attempt.room_id = p_room_id
      and attempt.admitted_at >= (
        pg_catalog.date_trunc('day', v_now at time zone 'UTC')
        at time zone 'UTC'
      );

    if v_count >= 20 then
      v_retry_after := greatest(
        1,
        pg_catalog.ceil(
          extract(
            epoch from (
              (
                pg_catalog.date_trunc('day', v_now at time zone 'UTC')
                + interval '1 day'
              ) at time zone 'UTC'
              - v_now
            )
          )
        )::integer
      );
      return pg_catalog.jsonb_build_object(
        'outcome', 'denied',
        'code', 'daily_transform_limit',
        'retryAfterSeconds', v_retry_after
      );
    end if;
  end if;

  v_lease_expires_at := v_now + interval '90 seconds';

  if v_has_existing then
    update private.sketch_transform_admissions admission
    set
      status = 'active',
      lease_token = p_lease_token,
      lease_expires_at = v_lease_expires_at,
      attempt_count = admission.attempt_count + 1,
      result_model = null,
      result_response_id = null,
      result_payload = null,
      last_error_code = null,
      admitted_at = v_now,
      completed_at = null,
      released_at = null,
      updated_at = v_now
    where admission.request_key = p_request_key;
  else
    insert into private.sketch_transform_admissions (
      request_key,
      room_id,
      actor_user_id,
      sketch_object_id,
      source_version,
      output_kind,
      normalized_instruction_sha256,
      png_sha256,
      status,
      lease_token,
      lease_expires_at,
      attempt_count,
      admitted_at,
      updated_at
    ) values (
      p_request_key,
      p_room_id,
      p_actor_user_id,
      p_sketch_object_id,
      p_source_version,
      p_output_kind,
      p_normalized_instruction_sha256,
      p_png_sha256,
      'active',
      p_lease_token,
      v_lease_expires_at,
      1,
      v_now,
      v_now
    );
  end if;

  insert into private.sketch_transform_attempts (
    request_key,
    room_id,
    actor_user_id,
    admitted_at
  ) values (
    p_request_key,
    p_room_id,
    p_actor_user_id,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'admitted',
    'requestKey', p_request_key,
    'leaseToken', p_lease_token,
    'leaseExpiresAt', v_lease_expires_at
  );
end;
$$;

create or replace function public.complete_sketch_transform(
  p_request_key text,
  p_lease_token uuid,
  p_model text,
  p_provider_response_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing private.sketch_transform_admissions%rowtype;
begin
  if p_request_key !~ '^vision_v1_[0-9a-f]{64}$'
     or p_lease_token is null
     or p_model not in ('gpt-5.6-terra', 'gpt-5.6-sol')
     or p_provider_response_id is null
     or pg_catalog.char_length(p_provider_response_id) not between 1 and 160
     or p_provider_response_id ~ '[[:cntrl:]]'
     or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
  then
    raise exception using
      errcode = 'P0001',
      message = 'vision_completion_input_invalid';
  end if;

  select admission.*
  into v_existing
  from private.sketch_transform_admissions admission
  where admission.request_key = p_request_key
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'vision_completion_not_admitted';
  end if;

  if p_payload ->> 'sourceSketchId' is distinct from
       v_existing.sketch_object_id
     or p_payload ->> 'kind' is distinct from v_existing.output_kind
  then
    raise exception using
      errcode = 'P0001',
      message = 'vision_completion_payload_mismatch';
  end if;

  if v_existing.status = 'completed' then
    if v_existing.lease_token = p_lease_token
       and v_existing.result_model = p_model
       and v_existing.result_response_id = p_provider_response_id
       and v_existing.result_payload = p_payload
    then
      return pg_catalog.jsonb_build_object('completed', true);
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'vision_completion_conflict';
  end if;

  if v_existing.status <> 'active'
     or v_existing.lease_token is distinct from p_lease_token
  then
    raise exception using
      errcode = 'P0001',
      message = 'vision_completion_lease_invalid';
  end if;

  update private.sketch_transform_admissions admission
  set
    status = 'completed',
    lease_expires_at = null,
    result_model = p_model,
    result_response_id = p_provider_response_id,
    result_payload = p_payload,
    completed_at = v_now,
    updated_at = v_now
  where admission.request_key = p_request_key;

  return pg_catalog.jsonb_build_object('completed', true);
end;
$$;

create or replace function public.release_sketch_transform(
  p_request_key text,
  p_lease_token uuid,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing private.sketch_transform_admissions%rowtype;
begin
  if p_request_key !~ '^vision_v1_[0-9a-f]{64}$'
     or p_lease_token is null
     or p_error_code not in (
       'vision_unconfigured',
       'provider_unavailable',
       'invalid_provider_response',
       'request_cancelled'
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'vision_release_input_invalid';
  end if;

  select admission.*
  into v_existing
  from private.sketch_transform_admissions admission
  where admission.request_key = p_request_key
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('released', false);
  end if;

  if v_existing.status = 'released'
     and v_existing.lease_token = p_lease_token
     and v_existing.last_error_code = p_error_code
  then
    return pg_catalog.jsonb_build_object('released', true);
  end if;

  if v_existing.status <> 'active'
     or v_existing.lease_token is distinct from p_lease_token
  then
    return pg_catalog.jsonb_build_object('released', false);
  end if;

  update private.sketch_transform_admissions admission
  set
    status = 'released',
    lease_expires_at = null,
    last_error_code = p_error_code,
    released_at = v_now,
    updated_at = v_now
  where admission.request_key = p_request_key;

  return pg_catalog.jsonb_build_object('released', true);
end;
$$;

revoke all on function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.complete_sketch_transform(
  text, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.release_sketch_transform(
  text, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid
) to service_role;
grant execute on function public.complete_sketch_transform(
  text, uuid, text, text, jsonb
) to service_role;
grant execute on function public.release_sketch_transform(
  text, uuid, text
) to service_role;

commit;
