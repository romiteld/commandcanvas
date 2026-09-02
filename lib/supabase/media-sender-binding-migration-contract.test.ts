import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function migrationSql() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_bind_meeting_media_sender.sql"),
    );
  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("meeting-media sender-bound Realtime topics", () => {
  it("lets room members read only current-member sender topics", () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+private\.room_media_topic_allowed\(p_topic\s+text\)[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''[\s\S]*?from\s+public\.room_members\s+sender[\s\S]*?private\.room_access_allowed\(sender\.room_id,\s*null\)[\s\S]*?p_topic\s*=\s*'room-media:'\s*\|\|\s*sender\.room_id::text\s*\|\|\s*':'\s*\|\|\s*sender\.user_id::text/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+private\.room_media_topic_allowed\(text\)[\s\S]*?grant\s+execute\s+on\s+function\s+private\.room_media_topic_allowed\(text\)\s+to\s+authenticated/i,
    );
    expect(sql).toMatch(
      /create\s+policy\s+commandcanvas_room_realtime_read[\s\S]*?realtime\.messages\.extension\s*=\s*'broadcast'[\s\S]*?private\.room_media_topic_allowed\([\s\S]*?realtime\.topic\(\)[\s\S]*?\)/i,
    );
  });

  it("lets a publisher write only the topic ending in its authenticated user id", () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /create\s+policy\s+commandcanvas_room_realtime_write[\s\S]*?realtime\.topic\(\)\)\s*=\s*'room-media:'\s*\|\|\s*member\.room_id::text\s*\|\|\s*':'\s*\|\|\s*\(select\s+auth\.uid\(\)\)::text/i,
    );
    expect(sql).not.toMatch(
      /realtime\.topic\(\)\)\s*=\s*'room-media:'\s*\|\|\s*member\.room_id::text\s*(?:\n|\r|\s)*and/i,
    );
  });

  it("preserves collaboration Presence/Broadcast and active-room guards", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/private\.room_access_allowed\(member\.room_id,\s*null\)/i);
    expect(sql).toMatch(
      /realtime\.topic\(\)\)\s*=\s*'room:'\s*\|\|\s*member\.room_id::text[\s\S]*?extension\s+in\s*\(\s*'broadcast'\s*,\s*'presence'\s*\)/i,
    );
  });
});
