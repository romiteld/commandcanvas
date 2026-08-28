begin;

-- Spoken context is part of the paid-work cache/admission identity. Keeping it
-- in its own nullable digest preserves the original no-narration identity while
-- preventing two different explanations of the same pixels from sharing work.
alter table private.sketch_transform_admissions
  add column normalized_narration_sha256 text;

alter table private.sketch_transform_admissions
  add constraint sketch_transform_admission_narration_hash
  check (
    normalized_narration_sha256 is null
    or normalized_narration_sha256 ~ '^[0-9a-f]{64}$'
  );

alter table private.sketch_transform_admissions
  drop constraint sketch_transform_admission_key_exact;

alter table private.sketch_transform_admissions
  add constraint sketch_transform_admission_key_exact
  check (
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
            normalized_narration_sha256,
            png_sha256
          ),
          'UTF8'
        )
      ),
      'hex'
    )
  );

-- The admission ledger stores the requested kind. `auto` is a request-only
-- value; completed payloads always carry one concrete, renderable kind.
alter table private.sketch_transform_admissions
  drop constraint sketch_transform_admissions_output_kind_check;

alter table private.sketch_transform_admissions
  add constraint sketch_transform_admissions_output_kind_check
  check (
    output_kind in (
      'auto',
      'architecture',
      'flowchart',
      'diagram',
      'pie_chart',
      'bar_chart',
      'line_chart'
    )
  );

alter table private.sketch_transform_admissions
  drop constraint sketch_transform_admission_payload_bound;

alter table private.sketch_transform_admissions
  add constraint sketch_transform_admission_payload_bound
  check (
    result_payload is null
    or (
      pg_catalog.jsonb_typeof(result_payload) = 'object'
      and result_payload ->> 'sourceSketchId' = sketch_object_id
      and pg_catalog.jsonb_typeof(result_payload -> 'kind') = 'string'
      and result_payload ->> 'kind' in (
        'architecture',
        'flowchart',
        'diagram',
        'pie_chart',
        'bar_chart',
        'line_chart'
      )
      and (
        output_kind = 'auto'
        or result_payload ->> 'kind' = output_kind
      )
    )
  );

-- Preserve the already-audited admission function and replace only its closed
-- kind allowlist. The guard makes this migration fail instead of silently
-- weakening a function whose previous definition has drifted.
do $migration$
declare
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.admit_sketch_transform(uuid,uuid,text,bigint,text,text,text,text,uuid)'
  );
  v_definition text;
  v_old_allowlist text := $old$p_output_kind not in ('architecture', 'flowchart')$old$;
  v_new_allowlist text := $new$p_output_kind not in (
       'auto',
       'architecture',
       'flowchart',
       'diagram',
       'pie_chart',
       'bar_chart',
       'line_chart'
     )$new$;
  v_old_signature text := $old$p_lease_token uuid)$old$;
  v_new_signature text := $new$p_lease_token uuid,
  p_normalized_narration_sha256 text default null
)$new$;
  v_old_input_guard text := $old$or p_normalized_instruction_sha256 !~ '^[0-9a-f]{64}$'
     or p_png_sha256 !~ '^[0-9a-f]{64}$'$old$;
  v_new_input_guard text := $new$or p_normalized_instruction_sha256 !~ '^[0-9a-f]{64}$'
     or (
       p_normalized_narration_sha256 is not null
       and p_normalized_narration_sha256 !~ '^[0-9a-f]{64}$'
     )
     or p_png_sha256 !~ '^[0-9a-f]{64}$'$new$;
  v_old_key text := $old$p_normalized_instruction_sha256,
          p_png_sha256$old$;
  v_new_key text := $new$p_normalized_instruction_sha256,
          p_normalized_narration_sha256,
          p_png_sha256$new$;
  v_old_identity text := $old$or v_existing.png_sha256 is distinct from p_png_sha256$old$;
  v_new_identity text := $new$or v_existing.normalized_narration_sha256 is distinct from
          p_normalized_narration_sha256
       or v_existing.png_sha256 is distinct from p_png_sha256$new$;
  v_old_insert_columns text := $old$normalized_instruction_sha256,
      png_sha256,$old$;
  v_new_insert_columns text := $new$normalized_instruction_sha256,
      normalized_narration_sha256,
      png_sha256,$new$;
  v_old_insert_values text := $old$p_normalized_instruction_sha256,
      p_png_sha256,$old$;
  v_new_insert_values text := $new$p_normalized_instruction_sha256,
      p_normalized_narration_sha256,
      p_png_sha256,$new$;
begin
  if v_function is null then
    raise exception 'general_visual_admit_function_missing';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  if pg_catalog.strpos(v_definition, v_old_allowlist) = 0
     or pg_catalog.strpos(v_definition, v_old_signature) = 0
     or pg_catalog.strpos(v_definition, v_old_input_guard) = 0
     or pg_catalog.strpos(v_definition, v_old_key) = 0
     or pg_catalog.strpos(v_definition, v_old_identity) = 0
     or pg_catalog.strpos(v_definition, v_old_insert_columns) = 0
     or pg_catalog.strpos(v_definition, v_old_insert_values) = 0
  then
    raise exception 'general_visual_admit_definition_guard_mismatch';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_old_allowlist,
    v_new_allowlist
  );
  v_definition := pg_catalog.replace(v_definition, v_old_signature, v_new_signature);
  v_definition := pg_catalog.replace(v_definition, v_old_input_guard, v_new_input_guard);
  v_definition := pg_catalog.replace(v_definition, v_old_key, v_new_key);
  v_definition := pg_catalog.replace(v_definition, v_old_identity, v_new_identity);
  v_definition := pg_catalog.replace(
    v_definition,
    v_old_insert_columns,
    v_new_insert_columns
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_old_insert_values,
    v_new_insert_values
  );
  execute v_definition;
end;
$migration$;

revoke all on function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid, text
) to service_role;

drop function public.admit_sketch_transform(
  uuid, uuid, text, bigint, text, text, text, text, uuid
);

-- Auto completion accepts any concrete supported kind. Explicit requests keep
-- the existing exact-kind mismatch guard.
do $migration$
declare
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.complete_sketch_transform(text,uuid,text,text,jsonb)'
  );
  v_definition text;
  v_old text := $old$or p_payload ->> 'kind' is distinct from v_existing.output_kind$old$;
  v_new text := $new$or p_payload ->> 'kind' is null
     or p_payload ->> 'kind' not in (
       'architecture',
       'flowchart',
       'diagram',
       'pie_chart',
       'bar_chart',
       'line_chart'
     )
     or (
       v_existing.output_kind <> 'auto'
       and p_payload ->> 'kind' is distinct from v_existing.output_kind
     )$new$;
begin
  if v_function is null then
    raise exception 'general_visual_complete_function_missing';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'general_visual_complete_kind_guard_mismatch';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$migration$;

commit;
