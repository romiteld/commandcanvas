begin;

-- Packet workflow mutations are exposed only through the host-checking,
-- SECURITY DEFINER RPCs. The server keeps read access for exact-state checks,
-- but cannot bypass those RPC guards with direct table writes.
revoke all privileges on table public.meeting_packets
  from service_role;
revoke all privileges on table public.packet_send_requests
  from service_role;
revoke all privileges on table public.outbound_shares
  from service_role;

grant select on table public.meeting_packets
  to service_role;
grant select on table public.packet_send_requests
  to service_role;
grant select on table public.outbound_shares
  to service_role;

grant execute on function public.prepare_meeting_packet_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  text[]
) to service_role;

grant execute on function public.update_meeting_packet_draft(
  uuid,
  text,
  uuid,
  text,
  jsonb
) to service_role;

grant execute on function public.approve_meeting_packet(
  uuid,
  text,
  uuid
) to service_role;

grant execute on function public.stage_meeting_packet_send(
  uuid,
  text,
  uuid,
  text,
  uuid
) to service_role;

grant execute on function public.authorize_meeting_packet_send(
  uuid,
  uuid,
  uuid,
  text,
  uuid
) to service_role;

grant execute on function public.complete_meeting_packet_send(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text
) to service_role;

commit;
