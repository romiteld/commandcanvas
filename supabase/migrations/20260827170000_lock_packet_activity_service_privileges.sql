begin;

-- Tables are created by the migration owner, so service_role can retain
-- privileges inherited from an environment's default privileges even when
-- browser roles were explicitly revoked. Establish the complete service-role
-- table ACL before restoring only the operations used by packet RPCs.
revoke all privileges on table public.packet_activity_receipts
  from service_role;

grant select, insert on table public.packet_activity_receipts
  to service_role;

commit;
