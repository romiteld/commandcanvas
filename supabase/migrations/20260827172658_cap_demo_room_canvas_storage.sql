begin;

create or replace function public.commit_canvas_mutation_at_revision(
  p_room_id uuid,
  p_expected_room_revision bigint,
  p_actor_user_id uuid,
  p_actor_type text,
  p_source text,
  p_action text,
  p_description text,
  p_changes jsonb,
  p_inverse_command jsonb default null,
  p_reversible boolean default true,
  p_undoes_receipt_id uuid default null,
  p_receipt_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room_revision bigint;
  v_room_mode text;
  v_live_object_count bigint;
  v_result jsonb;
begin
  select room_row.revision, room_row.mode
  into v_room_revision, v_room_mode
  from public.rooms room_row
  where room_row.id = p_room_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_room_not_found';
  end if;

  if v_room_revision is distinct from p_expected_room_revision then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_room_revision_conflict';
  end if;

  if v_room_mode = 'demo' and v_room_revision >= 400 then
    raise exception using
      errcode = 'P0001',
      message = 'demo_room_storage_limit_reached';
  end if;

  v_result := public.commit_canvas_mutation(
    p_room_id => p_room_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_type => p_actor_type,
    p_source => p_source,
    p_action => p_action,
    p_description => p_description,
    p_changes => p_changes,
    p_inverse_command => p_inverse_command,
    p_reversible => p_reversible,
    p_undoes_receipt_id => p_undoes_receipt_id,
    p_receipt_id => p_receipt_id
  );

  if v_room_mode = 'demo' then
    select pg_catalog.count(*)
    into v_live_object_count
    from public.canvas_objects object_row
    where object_row.room_id = p_room_id
      and object_row.deleted_at is null;

    if v_live_object_count > 160 then
      -- Raising after the inner commit rolls the complete RPC statement back,
      -- including its object, receipt, and room-revision writes.
      raise exception using
        errcode = 'P0001',
        message = 'demo_room_storage_limit_reached';
    end if;
  end if;

  return v_result;
end;
$$;

revoke execute on function public.commit_canvas_mutation_at_revision(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.commit_canvas_mutation_at_revision(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) to service_role;

commit;
