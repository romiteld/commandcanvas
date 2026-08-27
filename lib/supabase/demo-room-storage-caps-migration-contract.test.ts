import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function demoRoomStorageCapsMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_cap_demo_room_canvas_storage.sql"),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("demo-room canvas storage cap migration contract", () => {
  it("serializes the canonical commit and caps only demo revisions at 400", () => {
    const sql = demoRoomStorageCapsMigration();

    expect(sql).toMatch(
      /select\s+room_row\.revision\s*,\s*room_row\.mode[\s\S]*?from\s+public\.rooms\s+room_row[\s\S]*?for\s+update/i,
    );
    expect(sql).toMatch(
      /v_room_mode\s*=\s*'demo'[\s\S]*?v_room_revision\s*>?=\s*400[\s\S]*?demo_room_storage_limit_reached/i,
    );
    expect(sql).not.toMatch(/v_room_mode\s*=\s*'standard'[\s\S]*?400/i);
  });

  it("rolls back a canonical demo commit whose resulting live-object count exceeds 160", () => {
    const sql = demoRoomStorageCapsMigration();

    expect(sql).toMatch(
      /v_result\s*:=\s*public\.commit_canvas_mutation\s*\(/i,
    );
    expect(sql).toMatch(
      /from\s+public\.canvas_objects\s+object_row[\s\S]*?object_row\.room_id\s*=\s*p_room_id[\s\S]*?object_row\.deleted_at\s+is\s+null/i,
    );
    expect(sql).toMatch(
      /v_room_mode\s*=\s*'demo'[\s\S]*?v_live_object_count\s*>\s*160[\s\S]*?demo_room_storage_limit_reached/i,
    );
    expect(sql).toMatch(/return\s+v_result/i);
  });

  it("preserves the service-only security-definer boundary", () => {
    const sql = demoRoomStorageCapsMigration();

    expect(sql).toMatch(
      /function\s+public\.commit_canvas_mutation_at_revision[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i,
    );
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.commit_canvas_mutation_at_revision[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.commit_canvas_mutation_at_revision[\s\S]*?to\s+service_role/i,
    );
  });
});
