begin;

-- Session starts are intentionally not foreign-keyed to rooms or users.
-- Resetting a no-signup demo room must not erase the rate ledger and allow
-- repeated short-lived relay token minting to bypass the shared GPU boundary.
create table private.hand_relay_session_admissions (
  id bigint generated always as identity primary key,
  room_id uuid not null,
  actor_user_id uuid not null,
  admitted_at timestamptz not null default clock_timestamp()
);

create index hand_relay_session_admissions_actor_time_idx
  on private.hand_relay_session_admissions(actor_user_id, admitted_at desc);
create index hand_relay_session_admissions_room_time_idx
  on private.hand_relay_session_admissions(room_id, admitted_at desc);
create index hand_relay_session_admissions_time_idx
  on private.hand_relay_session_admissions(admitted_at desc);

alter table private.hand_relay_session_admissions enable row level security;

revoke all privileges on table private.hand_relay_session_admissions
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.hand_relay_session_admissions_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.admit_private_hand_relay_session(
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
  v_window interval := interval '10 minutes';
  v_daily_window interval := interval '24 hours';
  v_count bigint;
  v_oldest timestamptz;
  v_retry_after integer;
begin
  if p_room_id is null or p_actor_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'hand_relay_admission_input_invalid';
  end if;

  -- The fixed global lock is always taken first, followed by actor and room.
  -- That ordering makes every rolling-window decision atomic across Vercel
  -- instances without holding an application connection between requests.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:hand-relay:global', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:hand-relay:actor:' || p_actor_user_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:hand-relay:room:' || p_room_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.room_members member
    where member.room_id = p_room_id
      and member.user_id = p_actor_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'hand_relay_member_required';
  end if;

  -- Retention is bounded inside the same global critical section. This ledger
  -- is intentionally independent of demo-room deletion so Reset demo cannot
  -- reset the service budget.
  delete from private.hand_relay_session_admissions admission
  where admission.admitted_at < v_now - interval '7 days';

  select pg_catalog.count(*), pg_catalog.min(admission.admitted_at)
  into v_count, v_oldest
  from private.hand_relay_session_admissions admission
  where admission.admitted_at > v_now - v_window;

  if v_count >= 120 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + v_window) - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'hand_relay_global_burst_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(admission.admitted_at)
  into v_count, v_oldest
  from private.hand_relay_session_admissions admission
  where admission.admitted_at > v_now - v_daily_window;

  if v_count >= 600 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + v_daily_window) - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'hand_relay_global_daily_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(admission.admitted_at)
  into v_count, v_oldest
  from private.hand_relay_session_admissions admission
  where admission.actor_user_id = p_actor_user_id
    and admission.admitted_at > v_now - v_window;

  if v_count >= 10 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + v_window) - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'hand_relay_actor_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(admission.admitted_at)
  into v_count, v_oldest
  from private.hand_relay_session_admissions admission
  where admission.room_id = p_room_id
    and admission.admitted_at > v_now - v_window;

  if v_count >= 60 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + v_window) - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'hand_relay_room_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  insert into private.hand_relay_session_admissions (
    room_id,
    actor_user_id,
    admitted_at
  ) values (
    p_room_id,
    p_actor_user_id,
    v_now
  );

  return pg_catalog.jsonb_build_object('outcome', 'admitted');
end;
$$;

revoke all on function public.admit_private_hand_relay_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admit_private_hand_relay_session(uuid, uuid)
  to service_role;

commit;
