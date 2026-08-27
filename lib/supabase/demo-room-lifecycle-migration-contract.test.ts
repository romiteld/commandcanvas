import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function demoRoomLifecycleMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_bound_demo_room_lifecycle.sql"),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("bounded demo-room lifecycle migration contract", () => {
  it("serializes demo creation per actor and rejects the fourth live room", () => {
    const sql = demoRoomLifecycleMigration();

    expect(sql).toMatch(/pg_catalog\.pg_advisory_xact_lock\s*\(/i);
    expect(sql).toMatch(/created_by\s*=\s*p_host_user_id/i);
    expect(sql).toMatch(/mode\s*=\s*'demo'/i);
    expect(sql).toMatch(/count\s*\(\s*\*\s*\)[\s\S]*?\)\s*>?=\s*3/i);
    expect(sql).toMatch(/demo_room_limit_reached/i);
  });

  it("deletes only an exact demo room hosted by the authenticated actor", () => {
    const sql = demoRoomLifecycleMigration();

    expect(sql).toMatch(
      /function\s+public\.delete_demo_room_as_host\s*\(\s*p_room_id\s+uuid\s*,\s*p_actor_user_id\s+uuid\s*\)/i,
    );
    expect(sql).toMatch(/room_row\.id\s*=\s*p_room_id/i);
    expect(sql).toMatch(/room_row\.mode\s*=\s*'demo'/i);
    expect(sql).toMatch(/member\.user_id\s*=\s*p_actor_user_id/i);
    expect(sql).toMatch(/member\.role\s*=\s*'host'/i);
    expect(sql).toMatch(/demo_room_delete_forbidden/i);
  });

  it("keeps lifecycle RPCs security-definer and service-only", () => {
    const sql = demoRoomLifecycleMigration();

    expect(sql).toMatch(
      /function\s+public\.delete_demo_room_as_host[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i,
    );
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.delete_demo_room_as_host\s*\(\s*uuid\s*,\s*uuid\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.delete_demo_room_as_host\s*\(\s*uuid\s*,\s*uuid\s*\)\s+to\s+service_role/i,
    );
  });
});
