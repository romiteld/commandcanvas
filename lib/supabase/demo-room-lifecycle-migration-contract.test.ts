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

function staleDemoRoomRecoveryMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_open_or_reclaim_demo_room.sql"),
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

describe("self-healing demo-room open contract", () => {
  it("serializes one actor, preserves the latest room, and prunes only older stale rooms", () => {
    const sql = staleDemoRoomRecoveryMigration();
    const lockIndex = sql.search(/pg_catalog\.pg_advisory_xact_lock\s*\(/i);
    const deleteIndex = sql.search(/delete\s+from\s+public\.rooms/i);
    const selectAfterLockOffset = sql
      .slice(lockIndex)
      .search(/select[\s\S]*?into\s+v_room_id/i);
    const selectIndex =
      selectAfterLockOffset < 0 ? -1 : lockIndex + selectAfterLockOffset;

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(lockIndex);
    expect(deleteIndex).toBeGreaterThan(selectIndex);
    expect(sql).toMatch(/room_row\.created_by\s*=\s*p_host_user_id/i);
    expect(sql).toMatch(/room_row\.mode\s*=\s*'demo'/i);
    expect(sql).toMatch(/limit\s+1\s+for\s+update/i);
    expect(sql).toMatch(
      /room_row\.updated_at\s*<\s*pg_catalog\.clock_timestamp\(\)\s*-\s*interval\s*'24 hours'/i,
    );
    expect(sql).toMatch(/room_row\.id\s*<>\s*v_room_id/i);
    expect(sql).not.toMatch(/delete\s+from\s+auth\.users/i);
  });

  it("resumes the latest room, rotates with bounded invite grace, or creates exactly one room", () => {
    const sql = staleDemoRoomRecoveryMigration();

    expect(sql).toMatch(
      /function\s+public\.open_demo_room_with_host\s*\([\s\S]*?\)\s*returns\s+jsonb/i,
    );
    expect(sql).toMatch(/order\s+by\s+room_row\.updated_at\s+desc/i);
    expect(sql).toMatch(
      /update\s+private\.room_join_capabilities[\s\S]*?join_token_sha256\s*=/i,
    );
    expect(sql).toMatch(/previous_join_token_sha256\s*=/i);
    expect(sql).toMatch(
      /previous_join_token_valid_until\s*=[\s\S]*?interval\s*'1 hour'/i,
    );
    expect(sql).toMatch(
      /capability\.previous_join_token_sha256[\s\S]*?capability\.previous_join_token_valid_until\s*>\s*pg_catalog\.clock_timestamp\(\)/i,
    );
    expect(sql).toMatch(/if\s+v_room_id\s+is\s+not\s+null\s+then/i);
    expect(sql).toMatch(/insert\s+into\s+public\.rooms/i);
    expect(sql).toMatch(/'resumed'\s*,\s*true/i);
    expect(sql).toMatch(/'resumed'\s*,\s*false/i);
  });

  it("keeps the open RPC security-definer, search-path empty, and service-role only", () => {
    const sql = staleDemoRoomRecoveryMigration();

    expect(sql).toMatch(
      /function\s+public\.open_demo_room_with_host[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.open_demo_room_with_host[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.open_demo_room_with_host[\s\S]*?to\s+service_role/i,
    );
  });

  it("serializes exact host deletion with the same actor lifecycle lock", () => {
    const sql = staleDemoRoomRecoveryMigration();
    const deleteFunction = sql.match(
      /create\s+or\s+replace\s+function\s+public\.delete_demo_room_as_host[\s\S]*?\n\$\$;/i,
    )?.[0];

    expect(deleteFunction).toBeDefined();
    expect(deleteFunction).toMatch(/pg_catalog\.pg_advisory_xact_lock\s*\(/i);
    expect(deleteFunction).toMatch(
      /pg_catalog\.hashtextextended\(p_actor_user_id::text,\s*1131372637\)/i,
    );
  });

  it("makes undo receipt cascades deferrable and indexes host activity", () => {
    const sql = staleDemoRoomRecoveryMigration();

    expect(sql).toMatch(
      /drop\s+constraint\s+receipts_undoes_receipt_id_fkey/i,
    );
    expect(sql).toMatch(
      /foreign\s+key\s*\(undoes_receipt_id\)[\s\S]*?on\s+delete\s+no\s+action[\s\S]*?deferrable\s+initially\s+deferred/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+rooms_demo_host_activity_idx[\s\S]*?on\s+public\.rooms\s*\([\s\S]*?created_by[\s\S]*?updated_at\s+desc[\s\S]*?where\s+mode\s*=\s*'demo'/i,
    );
  });
});
