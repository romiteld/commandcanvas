begin;

-- Standard-room members have completed email OTP verification. Keep the
-- no-signup demo path, but require the permanent Auth record again inside the
-- durable admission transaction before any paid provider call can begin.
create or replace function public.admit_realtime_voice_session(
  p_room_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day_start timestamptz := (
    pg_catalog.date_trunc('day', pg_catalog.clock_timestamp() at time zone 'UTC')
    at time zone 'UTC'
  );
  v_room_mode text;
  v_is_anonymous boolean;
  v_email_confirmed_at timestamptz;
  v_count bigint;
  v_oldest timestamptz;
  v_retry_after integer;
begin
  if p_room_id is null or p_actor_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'realtime_voice_admission_input_invalid';
  end if;

  -- A fixed lock order keeps independent ceilings atomic across concurrent
  -- Vercel instances and avoids actor/room lock inversion.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:voice:global:' || v_day_start::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:voice:actor:' || p_actor_user_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:voice:room:' || p_room_id::text,
      0
    )
  );

  select
    room.mode,
    user_row.is_anonymous,
    user_row.email_confirmed_at
  into
    v_room_mode,
    v_is_anonymous,
    v_email_confirmed_at
  from public.rooms room
  join public.room_members member
    on member.room_id = room.id
   and member.user_id = p_actor_user_id
  left join auth.users user_row
    on user_row.id = member.user_id
  where room.id = p_room_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'realtime_voice_member_required';
  end if;

  if v_room_mode = 'standard'
     and (
       v_is_anonymous is distinct from false
       or v_email_confirmed_at is null
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'realtime_voice_permanent_member_required';
  end if;

  if v_room_mode not in ('demo', 'standard') then
    raise exception using
      errcode = 'P0001',
      message = 'realtime_voice_room_mode_invalid';
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.realtime_voice_admissions admission
  where admission.actor_user_id = p_actor_user_id
    and admission.admitted_at >= v_day_start;

  if v_count >= 8 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'voice_actor_daily_limit',
      'retryAfterSeconds', greatest(
        1,
        pg_catalog.ceil(
          extract(epoch from ((v_day_start + interval '1 day') - v_now))
        )::integer
      )
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(admission.admitted_at)
  into v_count, v_oldest
  from private.realtime_voice_admissions admission
  where admission.actor_user_id = p_actor_user_id
    and admission.admitted_at > v_now - interval '10 minutes';

  if v_count >= 3 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + interval '10 minutes') - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'voice_actor_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.realtime_voice_admissions admission
  where admission.room_id = p_room_id
    and admission.admitted_at >= v_day_start;

  if v_count >= 20 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'voice_room_daily_limit',
      'retryAfterSeconds', greatest(
        1,
        pg_catalog.ceil(
          extract(epoch from ((v_day_start + interval '1 day') - v_now))
        )::integer
      )
    );
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.realtime_voice_admissions admission
  where admission.admitted_at >= v_day_start;

  if v_count >= 30 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'voice_global_daily_limit',
      'retryAfterSeconds', greatest(
        1,
        pg_catalog.ceil(
          extract(epoch from ((v_day_start + interval '1 day') - v_now))
        )::integer
      )
    );
  end if;

  insert into private.realtime_voice_admissions (
    room_id,
    actor_user_id,
    room_mode,
    admitted_at
  ) values (
    p_room_id,
    p_actor_user_id,
    v_room_mode,
    v_now
  );

  return pg_catalog.jsonb_build_object('outcome', 'admitted');
end;
$$;

revoke all on function public.admit_realtime_voice_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admit_realtime_voice_session(uuid, uuid)
  to service_role;

commit;
