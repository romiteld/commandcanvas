begin;

-- Demo usage intentionally has no room foreign key. Resetting or deleting a
-- room must not erase the actor or global paid-work allowance it consumed.
create table private.demo_vision_usage (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  request_key text not null
    check (request_key ~ '^vision_v1_[0-9a-f]{64}$'),
  admitted_at timestamptz not null
);

create index demo_vision_usage_actor_day_idx
  on private.demo_vision_usage(actor_user_id, admitted_at desc);

create index demo_vision_usage_global_day_idx
  on private.demo_vision_usage(admitted_at desc);

alter table private.demo_vision_usage enable row level security;

revoke all privileges on table private.demo_vision_usage
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.demo_vision_usage_id_seq
  from public, anon, authenticated, service_role;

-- This trigger is below the existing service-only admission RPC. A limit
-- refusal aborts the surrounding admission transaction before the provider is
-- called. Advisory locks serialize actors and the global circuit breaker across
-- concurrent Vercel instances.
create function private.enforce_demo_vision_limits()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day_start timestamptz := (
    pg_catalog.date_trunc('day', v_now at time zone 'UTC')
    at time zone 'UTC'
  );
  v_room_mode text;
  v_count bigint;
begin
  select room.mode
  into v_room_mode
  from public.rooms room
  where room.id = new.room_id;

  if v_room_mode is distinct from 'demo' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:vision:demo:global', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:vision:demo:actor:' || new.actor_user_id::text,
      0
    )
  );

  select pg_catalog.count(*)
  into v_count
  from private.demo_vision_usage usage
  where usage.actor_user_id = new.actor_user_id
    and usage.admitted_at >= v_day_start;

  if v_count >= 6 then
    raise exception using
      errcode = 'P0001',
      message = 'demo_actor_daily_limit';
  end if;

  select pg_catalog.count(*)
  into v_count
  from private.demo_vision_usage usage
  where usage.admitted_at >= v_day_start;

  if v_count >= 60 then
    raise exception using
      errcode = 'P0001',
      message = 'demo_global_daily_limit';
  end if;

  insert into private.demo_vision_usage (
    actor_user_id,
    room_id,
    request_key,
    admitted_at
  ) values (
    new.actor_user_id,
    new.room_id,
    new.request_key,
    new.admitted_at
  );

  return new;
end;
$$;

revoke all on function private.enforce_demo_vision_limits()
  from public, anon, authenticated, service_role;

create trigger enforce_demo_vision_limits_before_attempt
before insert on private.sketch_transform_attempts
for each row
execute function private.enforce_demo_vision_limits();

commit;
