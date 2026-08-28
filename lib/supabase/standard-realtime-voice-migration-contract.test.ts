import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function standardRoomVoiceMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_allow_verified_standard_realtime_voice.sql"),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("verified standard-room Realtime voice migration contract", () => {
  it("admits demo members and only permanent confirmed standard-room members", () => {
    const sql = standardRoomVoiceMigration();

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.admit_realtime_voice_session/i);
    expect(sql).toMatch(/public\.room_members/i);
    expect(sql).toMatch(/auth\.users/i);
    expect(sql).toMatch(/v_room_mode\s+not\s+in\s*\(\s*'demo',\s*'standard'\s*\)/i);
    expect(sql).toMatch(/v_room_mode\s*=\s*'standard'/i);
    expect(sql).toMatch(/v_is_anonymous\s+is\s+distinct\s+from\s+false/i);
    expect(sql).toMatch(/v_email_confirmed_at\s+is\s+null/i);
    expect(sql).toMatch(/realtime_voice_permanent_member_required/i);
    expect(sql).not.toMatch(/voice_demo_room_required/i);
  });

  it("preserves atomic durable actor, room, and global limits", () => {
    const sql = standardRoomVoiceMigration();

    expect(sql).toMatch(/private\.realtime_voice_admissions/i);
    expect(sql).toMatch(/pg_catalog\.pg_advisory_xact_lock\s*\(/i);
    expect(sql).toMatch(/voice_actor_rate_limit/i);
    expect(sql).toMatch(/voice_actor_daily_limit/i);
    expect(sql).toMatch(/voice_room_daily_limit/i);
    expect(sql).toMatch(/voice_global_daily_limit/i);
    expect(sql).toMatch(/room_mode/i);
  });

  it("keeps the replaced admission function service-only", () => {
    const sql = standardRoomVoiceMigration();

    expect(sql).toMatch(/security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.admit_realtime_voice_session\(uuid,\s*uuid\)[\s\S]*?from\s+public,\s*anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.admit_realtime_voice_session\(uuid,\s*uuid\)[\s\S]*?to\s+service_role/i,
    );
  });
});
