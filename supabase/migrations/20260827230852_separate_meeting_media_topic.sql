-- Supabase JS reuses an existing channel when the topic matches. Keep
-- collaboration presence/cursors and WebRTC signaling on separate private
-- topics so each channel retains its own acknowledgement configuration and
-- subscription lifecycle.
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
      and (
        (
          (select realtime.topic()) = 'room:' || member.room_id::text
          and realtime.messages.extension in ('broadcast', 'presence')
        )
        or (
          (select realtime.topic()) = 'room-media:' || member.room_id::text
          and realtime.messages.extension = 'broadcast'
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
      and (
        (
          (select realtime.topic()) = 'room:' || member.room_id::text
          and realtime.messages.extension in ('broadcast', 'presence')
        )
        or (
          (select realtime.topic()) = 'room-media:' || member.room_id::text
          and realtime.messages.extension = 'broadcast'
        )
      )
  )
);
