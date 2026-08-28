\set ON_ERROR_STOP on

do $$
declare
  v_read_qual text;
  v_write_check text;
begin
  select policy_row.qual
  into v_read_qual
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'realtime'
    and policy_row.tablename = 'messages'
    and policy_row.policyname = 'commandcanvas_room_realtime_read';

  select policy_row.with_check
  into v_write_check
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'realtime'
    and policy_row.tablename = 'messages'
    and policy_row.policyname = 'commandcanvas_room_realtime_write';

  if v_read_qual is null
     or v_read_qual not like '%room-media:%'
     or v_read_qual not like '%room:%'
  then
    raise exception 'meeting_media_realtime_read_topic_missing';
  end if;

  if v_write_check is null
     or v_write_check not like '%room-media:%'
     or v_write_check not like '%room:%'
  then
    raise exception 'meeting_media_realtime_write_topic_missing';
  end if;
end;
$$;

\echo meeting_media_realtime_catalog_assertions_passed
