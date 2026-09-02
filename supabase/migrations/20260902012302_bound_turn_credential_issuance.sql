begin;

-- TURN REST credentials are short lived, but minting them still allocates an
-- externally reachable relay capability. This ledger is independent of room
-- deletion so resetting a demo room cannot reset the issuance budget.
create table private.turn_credential_issuance_admissions (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  room_id uuid not null,
  actor_user_id uuid not null,
  issued_at timestamptz not null default clock_timestamp()
);

create index turn_credential_issuance_actor_time_idx
  on private.turn_credential_issuance_admissions(actor_user_id, issued_at desc);
create index turn_credential_issuance_room_time_idx
  on private.turn_credential_issuance_admissions(room_id, issued_at desc);
create index turn_credential_issuance_time_idx
  on private.turn_credential_issuance_admissions(issued_at desc);

alter table private.turn_credential_issuance_admissions enable row level security;

revoke all privileges on table private.turn_credential_issuance_admissions
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.turn_credential_issuance_admissions_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.admit_turn_credential_issuance(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
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
  v_existing private.turn_credential_issuance_admissions%rowtype;
  v_count bigint;
  v_oldest timestamptz;
  v_retry_after integer;
begin
  if p_room_id is null or p_actor_user_id is null or p_request_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'turn_credential_admission_input_invalid';
  end if;

  -- A consistent global, actor, then room lock order makes idempotency and all
  -- rolling limits one atomic decision across independent Vercel instances.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('commandcanvas:turn:global', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:turn:actor:' || p_actor_user_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'commandcanvas:turn:room:' || p_room_id::text,
      0
    )
  );

  if not exists (
    select 1
    from auth.users user_row
    where user_row.id = p_actor_user_id
      and user_row.is_anonymous is not true
      and user_row.email is not null
      and user_row.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'turn_permanent_actor_required';
  end if;

  if not exists (
    select 1
    from public.room_members member
    where member.room_id = p_room_id
      and member.user_id = p_actor_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'turn_member_required';
  end if;
  perform private.assert_room_active(p_room_id);

  select admission.*
  into v_existing
  from private.turn_credential_issuance_admissions admission
  where admission.request_id = p_request_id;

  if found then
    if v_existing.room_id <> p_room_id
       or v_existing.actor_user_id <> p_actor_user_id
    then
      raise exception using
        errcode = 'P0001',
        message = 'turn_idempotency_key_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'admitted',
      'issuedAtSeconds', pg_catalog.floor(
        extract(epoch from v_existing.issued_at)
      )::bigint,
      'replayed', true
    );
  end if;

  delete from private.turn_credential_issuance_admissions admission
  where admission.issued_at < v_now - interval '7 days';

  select pg_catalog.count(*), pg_catalog.min(admission.issued_at)
  into v_count, v_oldest
  from private.turn_credential_issuance_admissions admission
  where admission.actor_user_id = p_actor_user_id
    and admission.issued_at > v_now - v_window;

  if v_count >= 6 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + v_window) - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'turn_actor_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(admission.issued_at)
  into v_count, v_oldest
  from private.turn_credential_issuance_admissions admission
  where admission.room_id = p_room_id
    and admission.issued_at > v_now - v_window;

  if v_count >= 20 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + v_window) - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'turn_room_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select pg_catalog.count(*), pg_catalog.min(admission.issued_at)
  into v_count, v_oldest
  from private.turn_credential_issuance_admissions admission
  where admission.issued_at > v_now - v_window;

  if v_count >= 60 then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from ((v_oldest + v_window) - v_now))
      )::integer
    );
    return pg_catalog.jsonb_build_object(
      'outcome', 'denied',
      'code', 'turn_global_rate_limit',
      'retryAfterSeconds', v_retry_after
    );
  end if;

  insert into private.turn_credential_issuance_admissions (
    request_id,
    room_id,
    actor_user_id,
    issued_at
  ) values (
    p_request_id,
    p_room_id,
    p_actor_user_id,
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'admitted',
    'issuedAtSeconds', pg_catalog.floor(extract(epoch from v_now))::bigint,
    'replayed', false
  );
end;
$$;

revoke all on function public.admit_turn_credential_issuance(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admit_turn_credential_issuance(uuid, uuid, uuid)
  to service_role;

commit;
