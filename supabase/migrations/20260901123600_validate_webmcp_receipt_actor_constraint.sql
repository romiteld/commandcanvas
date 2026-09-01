begin;

-- NOT VALID already enforces the constraint for new writes. Validate the
-- historical rows separately so the expansion migration keeps its exclusive
-- table-lock interval short.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.receipts
  validate constraint receipts_actor_source_consistent;

commit;
