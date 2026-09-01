import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function publicDemoAdmissionMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_bound_public_demo_admission.sql"),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

function functionBody(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match?.[0]).toBeDefined();
  return match![0];
}

describe("bounded public demo admission migration", () => {
  it("adds a non-refreshable hard expiry and durable, browser-inaccessible ledgers", () => {
    const sql = publicDemoAdmissionMigration();

    expect(sql).toMatch(
      /alter\s+table\s+public\.rooms[\s\S]*?add\s+column\s+if\s+not\s+exists\s+demo_hard_expires_at\s+timestamptz/i,
    );
    expect(sql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+private\.demo_room_creation_admissions/i,
    );
    expect(sql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+private\.demo_room_join_admissions/i,
    );
    expect(sql).toMatch(
      /create\s+sequence\s+if\s+not\s+exists\s+private\.demo_room_join_attempt_counter/i,
    );
    expect(sql).toMatch(
      /alter\s+table\s+private\.demo_room_creation_admissions\s+enable\s+row\s+level\s+security/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+privileges\s+on\s+table\s+private\.demo_room_creation_admissions[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    );
    expect(sql).not.toMatch(/pg_catalog\.coalesce/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/pg_cron|cron\.schedule/i);
  });

  it("serializes and bounds global demo creation before inserting a fixed-lifetime room", () => {
    const sql = publicDemoAdmissionMigration();
    const body = functionBody(sql, "open_demo_room_with_host");

    expect(body).toMatch(
      /pg_catalog\.hashtextextended\(\s*'commandcanvas:demo-room:global'/i,
    );
    expect(body).toMatch(
      /pg_catalog\.hashtextextended\(\s*'commandcanvas:demo-room:actor:'\s*\|\|\s*p_host_user_id::text/i,
    );
    expect(body).toMatch(
      /room_row\.demo_hard_expires_at\s*>\s*v_now/i,
    );
    expect(body).toMatch(
      /from\s+public\.rooms[\s\S]*?mode\s*=\s*'demo'[\s\S]*?coalesce\([\s\S]*?demo_hard_expires_at[\s\S]*?\)\s*>\s*v_now[\s\S]*?\)\s*>?=\s*64/i,
    );
    expect(body).toMatch(
      /from\s+private\.demo_room_creation_admissions[\s\S]*?admitted_at\s*>?=\s*v_day_start[\s\S]*?\)\s*>?=\s*100/i,
    );
    expect(body).toMatch(/message\s*=\s*'demo_room_global_capacity_reached'/i);
    expect(body).toMatch(/message\s*=\s*'demo_room_daily_limit_reached'/i);
    expect(body).toMatch(
      /insert\s+into\s+public\.rooms[\s\S]*?demo_hard_expires_at[\s\S]*?v_hard_expires_at/i,
    );
    expect(body).toMatch(
      /insert\s+into\s+private\.demo_room_creation_admissions/i,
    );
    expect(body).not.toMatch(/set[\s\S]*?demo_hard_expires_at\s*=/i);
  });

  it("keeps the existing open signature and browser privilege boundary", () => {
    const sql = publicDemoAdmissionMigration();

    expect(sql).toMatch(
      /function\s+public\.open_demo_room_with_host\s*\(\s*p_room_id\s+uuid\s*,\s*p_slug\s+text\s*,\s*p_name\s+text\s*,\s*p_host_user_id\s+uuid\s*,\s*p_display_name\s+text\s*,\s*p_color\s+text\s*,\s*p_join_token\s+text\s*\)/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.open_demo_room_with_host\s*\(\s*uuid\s*,\s*text\s*,\s*text\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.open_demo_room_with_host\s*\(\s*uuid\s*,\s*text\s*,\s*text\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+to\s+service_role/i,
    );
  });

  it("caps all join attempts before token lookup and bounds valid-link admissions", () => {
    const sql = publicDemoAdmissionMigration();
    const body = functionBody(sql, "join_room_as_participant");

    expect(body).toMatch(
      /pg_catalog\.hashtextextended\(\s*'commandcanvas:demo-join:global'/i,
    );
    expect(body).toMatch(
      /pg_catalog\.hashtextextended\(\s*'commandcanvas:demo-join:room:'\s*\|\|\s*p_room_id::text/i,
    );
    expect(body).toMatch(
      /private\.demo_room_join_attempt_counter[\s\S]*?setval[\s\S]*?demo_join_rate_limited/i,
    );
    expect(body.indexOf("private.demo_room_join_attempt_counter")).toBeLessThan(
      body.indexOf("from public.rooms room_row"),
    );
    expect(body).toMatch(
      /from\s+public\.room_members[\s\S]*?room_id\s*=\s*p_room_id[\s\S]*?\)\s*>?=\s*8/i,
    );
    expect(body).toMatch(/message\s*=\s*'demo_room_full'/i);
    expect(body).toMatch(
      /from\s+private\.demo_room_join_admissions[\s\S]*?admitted_at\s*>\s*v_now\s*-\s*interval\s*'10 minutes'[\s\S]*?\)\s*>?=\s*80/i,
    );
    expect(body).toMatch(
      /from\s+private\.demo_room_join_admissions[\s\S]*?admitted_at\s*>?=\s*v_day_start[\s\S]*?\)\s*>?=\s*400/i,
    );
    expect(body).toMatch(/message\s*=\s*'demo_join_rate_limited'/i);
    expect(body).toMatch(
      /insert\s+into\s+private\.demo_room_join_admissions/i,
    );
    expect(body).toMatch(
      /coalesce\([\s\S]*?room_row\.demo_hard_expires_at[\s\S]*?\)\s*>\s*v_now/i,
    );
  });

  it("keeps the existing participant join signature and output keys", () => {
    const sql = publicDemoAdmissionMigration();
    const body = functionBody(sql, "join_room_as_participant");

    expect(sql).toMatch(
      /function\s+public\.join_room_as_participant\s*\(\s*p_room_id\s+uuid\s*,\s*p_user_id\s+uuid\s*,\s*p_display_name\s+text\s*,\s*p_color\s+text\s*,\s*p_join_token\s+text\s*,\s*p_requested_role\s+text\s+default\s+'participant'\s*\)/i,
    );
    expect(body).toMatch(/'roomId'\s*,\s*p_room_id/i);
    expect(body).toMatch(/'role'\s*,\s*v_existing_role/i);
    expect(body).toMatch(/'joined'\s*,\s*v_joined/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.join_room_as_participant\s*\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.join_room_as_participant\s*\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s+to\s+service_role/i,
    );
  });

  it("removes expired demo memberships from every browser and Realtime policy", () => {
    const sql = publicDemoAdmissionMigration();

    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+private\.room_access_allowed\s*\(\s*p_room_id\s+uuid\s*,\s*p_required_role\s+text\s*\)/i,
    );
    expect(sql).toMatch(
      /function\s+private\.room_access_allowed[\s\S]*?demo_hard_expires_at[\s\S]*?created_at\s*\+\s*interval\s*'24 hours'/i,
    );
    for (const policy of [
      "room_members_select_self",
      "rooms_select_member",
      "canvas_objects_select_member",
      "receipts_select_member",
      "meeting_packets_select_host",
      "packet_send_requests_select_host",
      "outbound_shares_select_host",
      "packet_activity_receipts_select_host",
      "commandcanvas_room_realtime_read",
      "commandcanvas_room_realtime_write",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+policy\\s+${policy}[\\s\\S]*?private\\.room_access_allowed`,
          "i",
        ),
      );
    }
  });

  it("guards existing-member mutation and paid service RPCs after hard expiry", () => {
    const sql = publicDemoAdmissionMigration();

    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+private\.assert_room_active\s*\(\s*p_room_id\s+uuid\s*\)/i,
    );
    expect(functionBody(sql, "commit_canvas_mutation")).toMatch(
      /perform\s+private\.assert_room_active\(p_room_id\)/i,
    );
    for (const baseName of [
      "admit_realtime_voice_session_without_expiry_guard",
      "admit_private_hand_relay_session_without_expiry_guard",
      "admit_sketch_transform_without_expiry_guard",
      "complete_sketch_transform_without_expiry_guard",
    ]) {
      expect(sql).toMatch(new RegExp(`private\\.${baseName}`, "i"));
    }
    for (const wrapper of [
      "admit_realtime_voice_session",
      "admit_private_hand_relay_session",
      "admit_sketch_transform",
      "complete_sketch_transform",
    ]) {
      expect(functionBody(sql, wrapper)).toMatch(
        /private\.assert_room_active/i,
      );
    }
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+private\.assert_packet_host[\s\S]*?private\.assert_room_active\(p_room_id\)/i,
    );
  });
});
