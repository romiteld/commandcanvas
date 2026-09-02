begin;

-- A private Realtime topic authorizes channel admission, but Broadcast payload
-- fields remain client-authored JSON. Meeting-media publishers therefore get
-- one topic whose suffix is their authenticated user id. Other active room
-- members may subscribe to that current member's topic, while only the actor
-- matching the suffix may publish to it.
create or replace function private.room_media_topic_allowed(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.room_members sender
      where (select private.room_access_allowed(sender.room_id, null))
        and p_topic =
          'room-media:' || sender.room_id::text || ':' || sender.user_id::text
    );
$$;

revoke all on function private.room_media_topic_allowed(text)
  from public, anon, authenticated, service_role;
grant execute on function private.room_media_topic_allowed(text)
  to authenticated;

drop policy if exists commandcanvas_room_realtime_read
on realtime.messages;
create policy commandcanvas_room_realtime_read
on realtime.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members member
    where member.user_id = (select auth.uid())
      and (select private.room_access_allowed(member.room_id, null))
      and (
        (
          (select realtime.topic()) = 'room:' || member.room_id::text
          and realtime.messages.extension in ('broadcast', 'presence')
        )
        or (
          realtime.messages.extension = 'broadcast'
          and (select private.room_media_topic_allowed(
            (select realtime.topic())
          ))
        )
      )
  )
);

drop policy if exists commandcanvas_room_realtime_write
on realtime.messages;
create policy commandcanvas_room_realtime_write
on realtime.messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.room_members member
    where member.user_id = (select auth.uid())
      and (select private.room_access_allowed(member.room_id, null))
      and (
        (
          (select realtime.topic()) = 'room:' || member.room_id::text
          and realtime.messages.extension in ('broadcast', 'presence')
        )
        or (
          realtime.messages.extension = 'broadcast'
          and (select realtime.topic()) =
            'room-media:' || member.room_id::text || ':' || (select auth.uid())::text
        )
      )
  )
);

commit;
