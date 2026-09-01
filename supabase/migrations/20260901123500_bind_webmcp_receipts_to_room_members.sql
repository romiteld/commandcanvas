begin;

-- Keep the table-lock portion short. The replacement constraint is broader
-- than the prior constraint and is enforced for new rows immediately; a later
-- migration validates historical rows without extending this lock window.
set local lock_timeout = '5s';

alter table public.receipts
  drop constraint receipts_actor_source_consistent,
  add constraint receipts_actor_source_consistent
  check (
    (actor_type = 'human' and source in (
      'pointer',
      'touch',
      'stylus',
      'gesture',
      'voice',
      'typed',
      'webmcp',
      'system'
    ))
    or (actor_type = 'participant' and source in (
      'collaborator',
      'webmcp',
      'system'
    ))
    -- Historical releases persisted WebMCP calls as agent receipts. Keep
    -- those rows valid; the canonical wrapper below prevents new ones.
    or (actor_type = 'agent' and source in ('webmcp', 'system'))
  ) not valid;

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
        'webmcp',
        'system'
      ))
     or (p_actor_type = 'participant' and p_source not in (
       'collaborator',
       'webmcp',
       'system'
     ))
     -- Trusted server-side system work may use an agent actor. A WebMCP call
     -- is always attributable to the authenticated room member instead.
     or (p_actor_type = 'agent' and p_source <> 'system')
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_actor_source_mismatch';
  end if;
end;
$$;

revoke execute on function private.validate_canvas_actor_source(text, text)
  from public, anon, authenticated, service_role;

-- The previous production client sends agent + webmcp. The current client
-- sends human/participant + webmcp. Canonicalize both request shapes to the
-- authenticated room member before validation and persistence so either
-- release can run on either side of this migration without false attribution.
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
declare
  v_effective_actor_type text := p_actor_type;
  v_member_role text;
begin
  perform private.assert_room_active(p_room_id);

  if p_actor_type is null
     or p_actor_type not in ('human', 'participant', 'agent')
  then
    raise exception using
      errcode = 'P0001',
      message = 'canvas_invalid_actor_type';
  end if;

  if p_source = 'webmcp' then
    select member.role
    into v_member_role
    from public.room_members member
    where member.room_id = p_room_id
      and member.user_id = p_actor_user_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_actor_not_member';
    end if;

    v_effective_actor_type := case v_member_role
      when 'host' then 'human'
      when 'participant' then 'participant'
      else null
    end;

    if v_effective_actor_type is null then
      raise exception using
        errcode = 'P0001',
        message = 'canvas_actor_type_mismatch';
    end if;
  end if;

  perform private.validate_canvas_actor_source(
    v_effective_actor_type,
    p_source
  );
  perform pg_catalog.set_config(
    'commandcanvas.receipt_source',
    p_source,
    true
  );

  return private.commit_canvas_mutation_core(
    p_room_id => p_room_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_type => v_effective_actor_type,
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

revoke all on function public.commit_canvas_mutation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, boolean, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.commit_canvas_mutation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, boolean, uuid, uuid
) to service_role;

commit;
