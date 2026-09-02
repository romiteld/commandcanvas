import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function migrationSql() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_bound_turn_credential_issuance.sql"),
    );
  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("durable TURN credential issuance admission", () => {
  it("keeps an RLS-closed idempotent ledger outside browser schemas", () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /create\s+table\s+private\.turn_credential_issuance_admissions[\s\S]*?request_id\s+uuid\s+not\s+null\s+unique[\s\S]*?room_id\s+uuid\s+not\s+null[\s\S]*?actor_user_id\s+uuid\s+not\s+null[\s\S]*?issued_at\s+timestamptz\s+not\s+null/i,
    );
    expect(sql).toMatch(
      /alter\s+table\s+private\.turn_credential_issuance_admissions\s+enable\s+row\s+level\s+security/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+privileges\s+on\s+table\s+private\.turn_credential_issuance_admissions\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    );
  });

  it("atomically replays one request and admits only a permanent active room member", () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.admit_turn_credential_issuance\(\s*p_room_id\s+uuid\s*,\s*p_actor_user_id\s+uuid\s*,\s*p_request_id\s+uuid\s*\)[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i,
    );
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(
      /from\s+auth\.users\s+user_row[\s\S]*?user_row\.is_anonymous\s+is\s+not\s+true[\s\S]*?user_row\.email_confirmed_at\s+is\s+not\s+null/i,
    );
    expect(sql).toMatch(
      /from\s+public\.room_members\s+member[\s\S]*?member\.room_id\s*=\s*p_room_id[\s\S]*?member\.user_id\s*=\s*p_actor_user_id/i,
    );
    expect(sql).toMatch(/perform\s+private\.assert_room_active\(p_room_id\)/i);
    expect(sql).toMatch(
      /where\s+admission\.request_id\s*=\s*p_request_id[\s\S]*?'replayed'\s*,\s*true/i,
    );
  });

  it("enforces actor, room, and global rolling limits and service-role-only execution", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/turn_actor_rate_limit/i);
    expect(sql).toMatch(/turn_room_rate_limit/i);
    expect(sql).toMatch(/turn_global_rate_limit/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.admit_turn_credential_issuance\(uuid\s*,\s*uuid\s*,\s*uuid\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.admit_turn_credential_issuance\(uuid\s*,\s*uuid\s*,\s*uuid\)\s+to\s+service_role/i,
    );
  });
});
