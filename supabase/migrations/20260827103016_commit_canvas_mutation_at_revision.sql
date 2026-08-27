begin;

create or replace function public.commit_canvas_mutation_at_revision(
  p_room_id uuid,
  p_expected_room_revision bigint,
  p_actor_user_id uuid,
  p_actor_type text,
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
begin
  select room.revision
  into v_room_revision
  from public.rooms room
  where room.id = p_room_id
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

  return public.commit_canvas_mutation(
    p_room_id => p_room_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_type => p_actor_type,
    p_action => p_action,
    p_description => p_description,
    p_changes => p_changes,
    p_inverse_command => p_inverse_command,
    p_reversible => p_reversible,
    p_undoes_receipt_id => p_undoes_receipt_id,
    p_receipt_id => p_receipt_id
  );
end;
$$;

revoke execute on function public.commit_canvas_mutation_at_revision(
  uuid,
  bigint,
  uuid,
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
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) to service_role;

commit;
