import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();
const migrationSql = migrationFiles
  .map((fileName) => readFileSync(join(migrationsDirectory, fileName), "utf8"))
  .join("\n");

function packetMigration(): string {
  const fileName = migrationFiles.find((candidate) =>
    candidate.endsWith("_meeting_packet_workflow.sql"),
  );

  expect(fileName).toBeDefined();
  expect(fileName?.localeCompare("20260827150849_persist_receipt_source.sql")).toBe(
    1,
  );

  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

function packetActivityPrivilegeMigration(): string {
  const fileName = migrationFiles.find((candidate) =>
    candidate.endsWith("_lock_packet_activity_service_privileges.sql"),
  );

  expect(fileName).toBeDefined();
  expect(fileName?.localeCompare("20260827160000_meeting_packet_workflow.sql")).toBe(
    1,
  );

  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

function packetStoragePrivilegeMigration(): string {
  const fileName = migrationFiles.find((candidate) =>
    candidate.endsWith("_lock_packet_storage_service_privileges.sql"),
  );

  expect(fileName).toBeDefined();
  expect(fileName?.localeCompare("20260827160000_meeting_packet_workflow.sql")).toBe(
    1,
  );

  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

function packetAuthorizationHardeningMigration(): string {
  const fileName = migrationFiles.find((candidate) =>
    candidate.endsWith("_harden_packet_authorization_snapshots.sql"),
  );

  expect(fileName).toBeDefined();
  expect(
    fileName?.localeCompare(
      "20260827170000_lock_packet_activity_service_privileges.sql",
    ),
  ).toBe(1);

  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

function packetTerminalRestageMigration(): string {
  const fileName = migrationFiles.find((candidate) =>
    candidate.endsWith("_allow_packet_terminal_restage.sql"),
  );

  expect(fileName).toBeDefined();
  expect(
    fileName?.localeCompare(
      "20260827170100_harden_packet_authorization_snapshots.sql",
    ),
  ).toBe(1);

  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("meeting packet migration contract", () => {
  it("stores exact approved and staged content snapshots with canonical hashes", () => {
    expect(migrationSql).toMatch(
      /meeting_packets[\s\S]*approved_content_snapshot\s+jsonb/i,
    );
    expect(migrationSql).toMatch(
      /packet_send_requests[\s\S]*content_snapshot\s+jsonb/i,
    );
    expect(migrationSql).toMatch(
      /canonical_jsonb_sha256[\s\S]*sha256[\s\S]*convert_to/i,
    );
    expect(migrationSql).toMatch(
      /approved_content_hash\s*=\s*private\.canonical_jsonb_sha256\s*\(\s*approved_content_snapshot\s*\)/i,
    );
    expect(migrationSql).toMatch(
      /packet_content_hash\s*=\s*private\.canonical_jsonb_sha256\s*\(\s*content_snapshot\s*\)/i,
    );
  });

  it("normalizes exact name and email recipient objects before approval", () => {
    expect(migrationSql).toMatch(
      /function\s+private\.normalize_packet_recipients\s*\(\s*p_recipients\s+jsonb\s*\)/i,
    );
    expect(migrationSql).toMatch(/jsonb_object_keys/i);
    expect(migrationSql).toMatch(/pg_catalog\.lower\s*\(/i);
    expect(migrationSql).toMatch(/order\s+by\s+normalized\.email/i);
    expect(migrationSql).toMatch(/packet_recipient_duplicate_email/i);
  });

  it("keeps packet activity separate from the gap-free canvas revision stream", () => {
    const sql = packetMigration();

    expect(sql).toMatch(/create\s+table\s+public\.packet_activity_receipts/i);
    expect(sql).toMatch(/unique\s*\(room_id,\s*activity_revision\)/i);
    expect(sql).not.toMatch(/update\s+public\.rooms\s+set\s+revision/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.receipts/i);
    expect(sql).not.toMatch(/commit_canvas_mutation/i);
  });

  it("derives packet drafts from active persisted semantic objects only", () => {
    const sql = packetMigration();

    expect(sql).toMatch(
      /prepare_meeting_packet_draft\s*\([\s\S]*?p_title\s+text[\s\S]*?p_selected_object_ids\s+text\[\]/i,
    );
    expect(sql).toMatch(/from\s+public\.canvas_objects/i);
    expect(sql).toMatch(/deleted_at\s+is\s+null/i);
    expect(sql).toMatch(
      /object_type\s+in\s*\(\s*'note',\s*'task_board',\s*'schedule',\s*'diagram'\s*\)/i,
    );
    expect(sql).toMatch(/order\s+by\s+object_row\.object_type/i);
    expect(sql).not.toMatch(/jsonb_build_object\s*\([^;]*'x'\s*,/i);
    expect(sql).not.toMatch(/jsonb_build_object\s*\([^;]*'pinned'\s*,/i);
    expect(sql).toMatch(/packet_selected_object_invalid/i);
    expect(sql).toMatch(/packet_content_required/i);
  });

  it("exposes only service-role secure host-checked workflow RPCs", () => {
    const sql = packetMigration();
    const functionNames = [
      "prepare_meeting_packet_draft",
      "update_meeting_packet_draft",
      "approve_meeting_packet",
      "stage_meeting_packet_send",
      "authorize_meeting_packet_send",
      "complete_meeting_packet_send",
    ];

    for (const functionName of functionNames) {
      expect(sql).toMatch(
        new RegExp(
          `function\\s+public\\.${functionName}\\s*\\([\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke\\s+execute\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?from\\s+public,\\s*anon,\\s*authenticated`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?to\\s+service_role`,
          "i",
        ),
      );
    }

    expect(sql).toMatch(/private\.assert_packet_host/i);
  });

  it("invalidates stale approval and stages rather than sends", () => {
    const sql = packetMigration();

    expect(sql).toMatch(/meeting_packets_invalidate_approval/i);
    expect(sql).toMatch(/new\.approved_content_snapshot\s*:=\s*null/i);
    expect(sql).toMatch(/status\s*=\s*'expired'/i);
    expect(sql).toMatch(/packet_send_stale/i);
    expect(sql).toMatch(/awaiting_human_approval/i);
    expect(sql).not.toMatch(/https?:\/\//i);
  });

  it("reserves preview or Resend delivery and completes provider results idempotently", () => {
    const sql = packetMigration();

    expect(sql).toMatch(/p_delivery_mode\s+text/i);
    expect(sql).toMatch(/p_delivery_mode\s+not\s+in\s*\(\s*'preview',\s*'resend'\s*\)/i);
    expect(sql).toMatch(
      /on\s+conflict\s*\(idempotency_key\)\s+do\s+nothing/i,
    );
    expect(sql).toMatch(/packet_send_completion_conflict/i);
    expect(sql).toMatch(/provider_message_id/i);
    expect(sql).toMatch(/idempotency_key/i);
  });

  it("restages terminal non-send outcomes while preserving active and submitted boundaries", () => {
    const sql = packetTerminalRestageMigration();
    const idempotencyDerivation = sql.match(
      /v_idempotency_key\s*:=([\s\S]*?);/i,
    )?.[1];

    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.stage_meeting_packet_send/i,
    );
    expect(sql).toMatch(
      /status\s*=\s*'awaiting_human_approval'[\s\S]*?return\s+pg_catalog\.jsonb_build_object/i,
    );
    expect(sql).toMatch(
      /status\s*=\s*'sent'[\s\S]*?packet_send_new_approval_required/i,
    );
    expect(sql).toMatch(
      /status\s*=\s*'sending'[\s\S]*?packet_send_already_authorized/i,
    );
    expect(sql).toMatch(
      /status\s+in\s*\(\s*'cancelled',\s*'failed',\s*'preview_only',\s*'expired'\s*\)/i,
    );
    expect(idempotencyDerivation).toBeDefined();
    expect(idempotencyDerivation).toMatch(/p_send_request_id/i);
    expect(sql).toMatch(/commandcanvas:packet-send:/i);
    expect(sql).not.toMatch(
      /update\s+public\.packet_send_requests[\s\S]*?status\s*=\s*'awaiting_human_approval'/i,
    );
  });

  it("makes packet activity immutable, host-readable, and room-cascade-safe", () => {
    const sql = packetMigration();

    expect(sql).toMatch(/packet_activity_receipts[\s\S]*on\s+delete\s+cascade/i);
    expect(sql).toMatch(/packet_activity_receipts_are_immutable/i);
    expect(sql).toMatch(/pg_catalog\.pg_trigger_depth\(\)\s*>\s*1/i);
    expect(sql).toMatch(/packet_activity_receipts_select_host/i);
    expect(sql).toMatch(
      /alter\s+table\s+public\.packet_activity_receipts\s+enable\s+row\s+level\s+security/i,
    );
  });

  it("removes service-role packet activity mutation privileges in a forward migration", () => {
    const sql = packetActivityPrivilegeMigration();

    expect(sql).toMatch(
      /revoke\s+all(?:\s+privileges)?\s+on\s+table\s+public\.packet_activity_receipts\s+from\s+service_role/i,
    );
    expect(sql).toMatch(
      /grant\s+select\s*,\s*insert\s+on\s+table\s+public\.packet_activity_receipts\s+to\s+service_role/i,
    );
    expect(sql).not.toMatch(
      /grant[\s\S]*?(?:update|delete)[\s\S]*?packet_activity_receipts[\s\S]*?service_role/i,
    );
  });

  it("limits service-role stable packet tables to reads while preserving packet RPC execution", () => {
    const sql = packetStoragePrivilegeMigration();
    const tableNames = [
      "meeting_packets",
      "packet_send_requests",
      "outbound_shares",
    ];
    const functionNames = [
      "prepare_meeting_packet_draft",
      "update_meeting_packet_draft",
      "approve_meeting_packet",
      "stage_meeting_packet_send",
      "authorize_meeting_packet_send",
      "complete_meeting_packet_send",
    ];

    for (const tableName of tableNames) {
      expect(sql).toMatch(
        new RegExp(
          `revoke\\s+all(?:\\s+privileges)?\\s+on\\s+table[\\s\\S]*?public\\.${tableName}[\\s\\S]*?from\\s+service_role`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+select\\s+on\\s+table[\\s\\S]*?public\\.${tableName}[\\s\\S]*?to\\s+service_role`,
          "i",
        ),
      );
    }

    for (const functionName of functionNames) {
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?to\\s+service_role`,
          "i",
        ),
      );
    }

    expect(sql).not.toMatch(
      /grant[\s\S]*?(?:insert|update|delete|truncate|references|trigger)[\s\S]*?(?:meeting_packets|packet_send_requests|outbound_shares)[\s\S]*?service_role/i,
    );
  });

  it("allows a room cascade to remove the complete packet send graph", () => {
    const sql = packetMigration();

    expect(sql).toMatch(
      /drop\s+constraint\s+outbound_shares_room_id_packet_id_fkey/i,
    );
    expect(sql).toMatch(
      /foreign\s+key\s*\(room_id,\s*packet_id\)[\s\S]*?references\s+public\.meeting_packets\s*\(room_id,\s*id\)[\s\S]*?on\s+delete\s+cascade/i,
    );
    expect(sql).toMatch(
      /drop\s+constraint\s+outbound_shares_room_id_packet_id_send_request_id_fkey/i,
    );
    expect(sql).toMatch(
      /foreign\s+key\s*\(room_id,\s*packet_id,\s*send_request_id\)[\s\S]*?references\s+public\.packet_send_requests\s*\(room_id,\s*packet_id,\s*id\)[\s\S]*?on\s+delete\s+cascade/i,
    );
  });

  it("adds a host-only durable cancellation RPC with an immutable activity receipt", () => {
    const sql = packetAuthorizationHardeningMigration();

    expect(sql).toMatch(
      /function\s+public\.cancel_meeting_packet_send\s*\(\s*p_room_id\s+uuid,\s*p_send_request_id\s+uuid,\s*p_host_user_id\s+uuid\s*\)/i,
    );
    expect(sql).toMatch(/private\.assert_packet_host/i);
    expect(sql).toMatch(/status\s*=\s*'cancelled'/i);
    expect(sql).toMatch(/'packet_send_cancelled'/i);
    expect(sql).toMatch(/private\.append_packet_activity/i);
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.cancel_meeting_packet_send[\s\S]*?from\s+public,\s*anon,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.cancel_meeting_packet_send[\s\S]*?to\s+service_role/i,
    );
  });

  it("returns exact content and recipient snapshots from packet workflow RPCs", () => {
    const sql = packetAuthorizationHardeningMigration();

    expect(sql).toMatch(
      /function\s+public\.prepare_meeting_packet_draft[\s\S]*?jsonb_build_object\s*\(\s*'title'\s*,\s*packet\.title,\s*'content'\s*,\s*packet\.content[\s\S]*?'contentSnapshot'\s*,\s*v_content_snapshot/i,
    );
    expect(sql).toMatch(
      /function\s+public\.approve_meeting_packet[\s\S]*?'packetVersion'[\s\S]*?'contentSnapshot'[\s\S]*?'recipientSnapshot'/i,
    );
    expect(sql).toMatch(
      /function\s+public\.stage_meeting_packet_send[\s\S]*?'packetVersion'[\s\S]*?'contentHash'[\s\S]*?'recipientHash'[\s\S]*?'recipientSnapshot'/i,
    );
  });
});
