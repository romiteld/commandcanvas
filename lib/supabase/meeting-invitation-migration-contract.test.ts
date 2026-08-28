import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "supabase", "migrations");

function migration() {
  const name = readdirSync(directory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_passwordless_meeting_invitations.sql"),
    );
  expect(name).toBeDefined();
  return readFileSync(join(directory, name!), "utf8");
}

describe("passwordless meeting invitation migration", () => {
  it("stores only token and email hashes in a service-only private table", () => {
    const sql = migration();
    const tableDefinition = sql.match(
      /create table private\.room_email_invitations \([\s\S]*?\n\);/i,
    )?.[0];
    expect(tableDefinition).toBeDefined();
    expect(sql).toMatch(/private\.room_email_invitations/i);
    expect(sql).toMatch(/invited_email_sha256\s+bytea/i);
    expect(sql).toMatch(/token_sha256\s+bytea/i);
    expect(tableDefinition).not.toMatch(/invited_email\s+text/i);
    expect(tableDefinition).not.toMatch(/raw_token/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/revoke all privileges[\s\S]+service_role/i);
  });

  it("authorizes standard hosts and invitees from auth.users, never user metadata", () => {
    const sql = migration();
    expect(sql).toMatch(/auth\.users/i);
    expect(sql).toMatch(/is_anonymous/i);
    expect(sql).toMatch(/email_confirmed_at/i);
    expect(sql).toMatch(/public\.room_members/i);
    expect(sql).not.toMatch(/user_metadata/i);
    expect(sql).not.toMatch(/raw_user_meta_data/i);
  });

  it("locks, rate limits, verifies the canonical email, and atomically consumes", () => {
    const sql = migration();
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/meeting_invite_actor_rate_limit/i);
    expect(sql).toMatch(/meeting_invite_room_rate_limit/i);
    expect(sql).toMatch(/meeting_invite_accept_rate_limit/i);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/consumed_at\s*=\s*clock_timestamp\(\)/i);
    expect(sql).toMatch(/insert into public\.room_members/i);
  });

  it("commits failed acceptance attempts instead of rolling them back with an exception", () => {
    const sql = migration();
    const functionDefinition = sql.match(
      /create or replace function public\.accept_room_email_invitation\([\s\S]*?\n\$\$;/i,
    )?.[0];
    expect(functionDefinition).toBeDefined();
    const afterAttemptInsert = functionDefinition!.split(
      /insert into private\.room_invitation_acceptance_attempts[\s\S]*?values\s*\([^;]+;/i,
    )[1];
    expect(afterAttemptInsert).toBeDefined();
    expect(afterAttemptInsert).toMatch(
      /return pg_catalog\.jsonb_build_object\(\s*'outcome',\s*'unavailable'\s*\)/i,
    );
    expect(afterAttemptInsert).not.toMatch(
      /raise exception[\s\S]*?message\s*=\s*'meeting_invitation_unavailable'/i,
    );
  });

  it("keeps invite issuance limits durable across room deletion and globally bounded", () => {
    const sql = migration();
    expect(sql).toMatch(/private\.room_invitation_issuance_admissions/i);
    const ledger = sql.match(
      /create table private\.room_invitation_issuance_admissions \([\s\S]*?\n\);/i,
    )?.[0];
    expect(ledger).toBeDefined();
    expect(ledger).not.toMatch(/references\s+(public\.)?rooms/i);
    expect(ledger).not.toMatch(/references\s+auth\.users/i);
    expect(sql).toMatch(/commandcanvas:invite:global/i);
    expect(sql).toMatch(/meeting_invite_global_rate_limit/i);
    expect(sql).toMatch(/interval '7 days'/i);
  });

  it("keeps all invitation RPCs service-role only", () => {
    const sql = migration();
    for (const name of [
      "create_standard_meeting_with_host",
      "create_room_email_invitation",
      "accept_room_email_invitation",
    ]) {
      expect(sql).toMatch(
        new RegExp(`function public\\.${name}[\\s\\S]+security definer`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name}[\\s\\S]+authenticated`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${name}[\\s\\S]+service_role`, "i"),
      );
    }
  });
});
