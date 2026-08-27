begin;

alter table public.receipts
  add column source text;

alter table public.receipts
  disable trigger receipts_are_immutable;

update public.receipts
set source = case actor_type
  when 'participant' then 'collaborator'
  when 'agent' then 'webmcp'
  else 'system'
end;

alter table public.receipts
  enable trigger receipts_are_immutable;

alter table public.receipts
  alter column source set not null,
  alter column source set default
    nullif(current_setting('commandcanvas.receipt_source', true), '');

alter table public.receipts
  add constraint receipts_actor_source_consistent
  check (
    (actor_type = 'human' and source in (
      'pointer',
      'touch',
      'stylus',
      'gesture',
      'voice',
      'typed',
      'system'
    ))
    or (actor_type = 'participant' and source in ('collaborator', 'system'))
    or (actor_type = 'agent' and source in ('webmcp', 'system'))
  );

drop function public.commit_canvas_mutation_at_revision(
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
);

alter function public.commit_canvas_mutation(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) set schema private;

alter function private.commit_canvas_mutation(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) rename to commit_canvas_mutation_core;

revoke all on function private.commit_canvas_mutation_core(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  jsonb,
  boolean,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

create or replace function private.validate_canvas_actor_source(
  p_actor_type text,
  p_source text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_source is null
     or p_source not in (
       'pointer',
       'touch',
       'stylus',
       'gesture',
       'voice',
       'typed',
       'collaborator',
       'webmcp',
       'system'
     )
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_source';
  end if;

  if (p_actor_type = 'human' and p_source not in (
        'pointer',
        'touch',
        'stylus',
        'gesture',
        'voice',
        'typed',
        'system'
      ))
     or (p_actor_type = 'participant' and p_source not in (
       'collaborator',
       'system'
     ))
     or (p_actor_type = 'agent' and p_source not in ('webmcp', 'system'))
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_actor_source_mismatch';
  end if;
end;
$$;

revoke execute on function private.validate_canvas_actor_source(text, text)
  from public, anon, authenticated;

create or replace function public.commit_canvas_mutation(
  p_room_id uuid,
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
begin
  perform private.validate_canvas_actor_source(p_actor_type, p_source);
  perform pg_catalog.set_config(
    'commandcanvas.receipt_source',
    p_source,
    true
  );

  return private.commit_canvas_mutation_core(
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

revoke execute on function public.commit_canvas_mutation(
  uuid,
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

grant execute on function public.commit_canvas_mutation(
  uuid,
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
    p_source => p_source,
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
