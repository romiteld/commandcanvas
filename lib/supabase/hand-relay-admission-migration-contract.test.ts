import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function handRelayAdmissionMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_bound_private_hand_relay_session_starts.sql"),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("private hand relay admission migration contract", () => {
  it("atomically bounds session starts globally, per actor, and per room across server instances", () => {
    const sql = handRelayAdmissionMigration();

    expect(sql).toMatch(/private\.hand_relay_session_admissions/i);
    expect(sql).toMatch(/pg_catalog\.pg_advisory_xact_lock\s*\(/i);
    expect(sql).toMatch(/hand_relay_global_burst_rate_limit/i);
    expect(sql).toMatch(/hand_relay_global_daily_rate_limit/i);
    expect(sql).toMatch(/hand_relay_actor_rate_limit/i);
    expect(sql).toMatch(/hand_relay_room_rate_limit/i);
    expect(sql).toMatch(/actor_user_id\s*=\s*p_actor_user_id/i);
    expect(sql).toMatch(/room_id\s*=\s*p_room_id/i);
    expect(sql).toMatch(/admitted_at\s*<\s*v_now\s*-\s*interval\s*'7 days'/i);
  });

  it("takes the fixed global lock before actor and room locks", () => {
    const sql = handRelayAdmissionMigration();
    const globalLock = sql.indexOf("commandcanvas:hand-relay:global");
    const actorLock = sql.indexOf("commandcanvas:hand-relay:actor:");
    const roomLock = sql.indexOf("commandcanvas:hand-relay:room:");

    expect(globalLock).toBeGreaterThan(-1);
    expect(actorLock).toBeGreaterThan(globalLock);
    expect(roomLock).toBeGreaterThan(actorLock);
  });

  it("requires current room membership while preserving anonymous authenticated users", () => {
    const sql = handRelayAdmissionMigration();

    expect(sql).toMatch(/public\.room_members/i);
    expect(sql).toMatch(/member\.user_id\s*=\s*p_actor_user_id/i);
    expect(sql).not.toMatch(/is_anonymous/i);
    expect(sql).not.toMatch(/room\.mode\s*<>\s*'demo'/i);
  });

  it("keeps both the durable ledger and admission RPC service-only", () => {
    const sql = handRelayAdmissionMigration();

    expect(sql).toMatch(/alter table private\.hand_relay_session_admissions enable row level security/i);
    expect(sql).toMatch(
      /revoke all privileges on table private\.hand_relay_session_admissions[\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /function public\.admit_private_hand_relay_session[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.admit_private_hand_relay_session\(uuid, uuid\)[\s\S]*?from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.admit_private_hand_relay_session\(uuid, uuid\)[\s\S]*?to service_role/i,
    );
  });
});
