begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'vision-lab-captures',
  'vision-lab-captures',
  false,
  262144000,
  array['video/webm', 'application/json']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_confirmed_permanent_vision_lab_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and ((auth.jwt() ->> 'is_anonymous') is not distinct from 'false')
    and exists (
      select 1
      from auth.users as actor
      where actor.id = auth.uid()
        and actor.is_anonymous is false
        and actor.email is not null
        and actor.email <> ''
        and actor.email_confirmed_at is not null
    );
$$;

revoke all on function public.is_confirmed_permanent_vision_lab_owner()
  from public, anon, authenticated;
grant execute on function public.is_confirmed_permanent_vision_lab_owner()
  to authenticated;

create policy "Permanent owners can upload Vision Lab captures"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vision-lab-captures'
  and ((select auth.jwt()) ->> 'is_anonymous') = 'false'
  and (select public.is_confirmed_permanent_vision_lab_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and pg_catalog.array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] ~ '^vision-lab-[A-Za-z0-9_-]{8,120}$'
  and storage.filename(name) in ('capture.webm', 'manifest.json')
);

create policy "Permanent owners can read Vision Lab captures"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vision-lab-captures'
  and ((select auth.jwt()) ->> 'is_anonymous') = 'false'
  and (select public.is_confirmed_permanent_vision_lab_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and pg_catalog.array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] ~ '^vision-lab-[A-Za-z0-9_-]{8,120}$'
  and storage.filename(name) in ('capture.webm', 'manifest.json')
);

create policy "Permanent owners can delete Vision Lab captures"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'vision-lab-captures'
  and ((select auth.jwt()) ->> 'is_anonymous') = 'false'
  and (select public.is_confirmed_permanent_vision_lab_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and pg_catalog.array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] ~ '^vision-lab-[A-Za-z0-9_-]{8,120}$'
  and storage.filename(name) in ('capture.webm', 'manifest.json')
);

create table public.vision_lab_capture_submissions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  vision_lab_session_id text not null
    check (vision_lab_session_id ~ '^vision-lab-[A-Za-z0-9_-]{8,120}$'),
  capture_type text not null
    check (capture_type in (
      'acquisition',
      'drawing',
      'pinch',
      'edges-corners',
      'two-hand-transforms',
      'throws',
      'difficult-conditions',
      'negative-no-hand'
    )),
  video_object_path text not null,
  manifest_object_path text not null,
  video_sha256 text not null
    check (video_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null
    check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  video_bytes bigint not null
    check (video_bytes > 0 and video_bytes <= 262144000),
  manifest_bytes integer not null
    check (manifest_bytes > 0 and manifest_bytes <= 262144),
  consent_version text not null
    check (consent_version = 'vision-lab-consent-v1'),
  protocol_id text not null
    check (protocol_id = 'commandcanvas-hand-finetune'),
  protocol_version integer not null
    check (protocol_version = 1),
  status text not null default 'uploaded_unverified'
    check (status = 'uploaded_unverified'),
  created_at timestamptz not null default now(),
  unique (actor_user_id, vision_lab_session_id),
  check (
    video_object_path = actor_user_id::text || '/' || vision_lab_session_id || '/capture.webm'
  ),
  check (
    manifest_object_path = actor_user_id::text || '/' || vision_lab_session_id || '/manifest.json'
  )
);

alter table public.vision_lab_capture_submissions enable row level security;

comment on table public.vision_lab_capture_submissions is
  'Append-only audit of owner-submitted, uploaded-unverified Vision Lab artifacts. Object presence is not implied; processing must re-hash both files before trust.';

create policy "Permanent owners can create Vision Lab submission receipts"
on public.vision_lab_capture_submissions
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and ((select auth.jwt()) ->> 'is_anonymous') = 'false'
  and (select public.is_confirmed_permanent_vision_lab_owner())
  and status = 'uploaded_unverified'
);

create policy "Permanent owners can read Vision Lab submission receipts"
on public.vision_lab_capture_submissions
for select
to authenticated
using (
  actor_user_id = (select auth.uid())
  and ((select auth.jwt()) ->> 'is_anonymous') = 'false'
  and (select public.is_confirmed_permanent_vision_lab_owner())
);

create or replace function public.finalize_vision_lab_capture_submission(
  p_vision_lab_session_id text,
  p_capture_type text,
  p_video_object_path text,
  p_manifest_object_path text,
  p_video_sha256 text,
  p_manifest_sha256 text,
  p_video_bytes bigint,
  p_manifest_bytes integer,
  p_consent_version text,
  p_protocol_id text,
  p_protocol_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_submission public.vision_lab_capture_submissions%rowtype;
begin
  if v_actor_user_id is null
    or (((select auth.jwt()) ->> 'is_anonymous') is distinct from 'false')
    or not exists (
      select 1
      from auth.users as actor
      where actor.id = v_actor_user_id
        and actor.is_anonymous is false
        and actor.email is not null
        and actor.email <> ''
        and actor.email_confirmed_at is not null
    )
  then
    raise exception using
      errcode = '42501',
      message = 'permanent_owner_required';
  end if;

  if p_vision_lab_session_id is null
    or p_vision_lab_session_id !~ '^vision-lab-[A-Za-z0-9_-]{8,120}$'
    or p_capture_type is null
    or p_capture_type not in (
      'acquisition',
      'drawing',
      'pinch',
      'edges-corners',
      'two-hand-transforms',
      'throws',
      'difficult-conditions',
      'negative-no-hand'
    )
    or p_video_object_path is distinct from
      v_actor_user_id::text || '/' || p_vision_lab_session_id || '/capture.webm'
    or p_manifest_object_path is distinct from
      v_actor_user_id::text || '/' || p_vision_lab_session_id || '/manifest.json'
    or p_video_sha256 is null
    or p_video_sha256 !~ '^[0-9a-f]{64}$'
    or p_manifest_sha256 is null
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_video_bytes is null
    or p_video_bytes <= 0
    or p_video_bytes > 262144000
    or p_manifest_bytes is null
    or p_manifest_bytes <= 0
    or p_manifest_bytes > 262144
    or p_consent_version is distinct from 'vision-lab-consent-v1'
    or p_protocol_id is distinct from 'commandcanvas-hand-finetune'
    or p_protocol_version is distinct from 1
  then
    raise exception using
      errcode = '22023',
      message = 'invalid_vision_lab_submission';
  end if;

  if not exists (
    select 1
    from storage.objects as object_row
    where object_row.bucket_id = 'vision-lab-captures'
      and object_row.name = p_video_object_path
      and object_row.owner_id = v_actor_user_id::text
      and (object_row.metadata ->> 'size') ~ '^[0-9]+$'
      and (object_row.metadata ->> 'size')::bigint = p_video_bytes
  )
  or not exists (
    select 1
    from storage.objects as object_row
    where object_row.bucket_id = 'vision-lab-captures'
      and object_row.name = p_manifest_object_path
      and object_row.owner_id = v_actor_user_id::text
      and (object_row.metadata ->> 'size') ~ '^[0-9]+$'
      and (object_row.metadata ->> 'size')::bigint = p_manifest_bytes
  )
  then
    raise exception using
      errcode = 'P0002',
      message = 'vision_lab_capture_object_missing';
  end if;

  insert into public.vision_lab_capture_submissions (
    actor_user_id,
    vision_lab_session_id,
    capture_type,
    video_object_path,
    manifest_object_path,
    video_sha256,
    manifest_sha256,
    video_bytes,
    manifest_bytes,
    consent_version,
    protocol_id,
    protocol_version,
    status
  )
  values (
    v_actor_user_id,
    p_vision_lab_session_id,
    p_capture_type,
    p_video_object_path,
    p_manifest_object_path,
    p_video_sha256,
    p_manifest_sha256,
    p_video_bytes,
    p_manifest_bytes,
    p_consent_version,
    p_protocol_id,
    p_protocol_version,
    'uploaded_unverified'
  )
  on conflict (actor_user_id, vision_lab_session_id) do nothing
  returning * into v_submission;

  if v_submission.id is null then
    select submission.*
    into v_submission
    from public.vision_lab_capture_submissions as submission
    where submission.actor_user_id = v_actor_user_id
      and submission.vision_lab_session_id = p_vision_lab_session_id;

    if v_submission.id is null
      or v_submission.capture_type is distinct from p_capture_type
      or v_submission.video_object_path is distinct from p_video_object_path
      or v_submission.manifest_object_path is distinct from p_manifest_object_path
      or v_submission.video_sha256 is distinct from p_video_sha256
      or v_submission.manifest_sha256 is distinct from p_manifest_sha256
      or v_submission.video_bytes is distinct from p_video_bytes
      or v_submission.manifest_bytes is distinct from p_manifest_bytes
      or v_submission.consent_version is distinct from p_consent_version
      or v_submission.protocol_id is distinct from p_protocol_id
      or v_submission.protocol_version is distinct from p_protocol_version
      or v_submission.status is distinct from 'uploaded_unverified'
    then
      raise exception using
        errcode = '23505',
        message = 'vision_lab_submission_conflict';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_submission.id,
    'status', v_submission.status
  );
end;
$$;

revoke all on function public.finalize_vision_lab_capture_submission(
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  text,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.finalize_vision_lab_capture_submission(
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  text,
  text,
  integer
) to authenticated;

revoke all privileges on table public.vision_lab_capture_submissions
  from public, anon, authenticated;
grant select on table public.vision_lab_capture_submissions
  to authenticated;

commit;
