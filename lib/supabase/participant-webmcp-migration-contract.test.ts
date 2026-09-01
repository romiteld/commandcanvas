import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function migrationFileNames() {
  return readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort();
}

function migrationWithSuffix(suffix: string) {
  const fileName = migrationFileNames().find((candidate) =>
    candidate.endsWith(suffix),
  );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

function webMcpAttributionMigration() {
  return migrationWithSuffix("_bind_webmcp_receipts_to_room_members.sql");
}

function receiptConstraintValidationMigration() {
  return migrationWithSuffix("_validate_webmcp_receipt_actor_constraint.sql");
}

describe("WebMCP receipt-attribution forward migration", () => {
  it("allows WebMCP as a channel for accountable room-member actors", () => {
    const sql = webMcpAttributionMigration();

    expect(sql).toMatch(
      /actor_type = 'human' and source in \([\s\S]*?'webmcp'[\s\S]*?\)/i,
    );
    expect(sql).toMatch(
      /actor_type = 'participant' and source in \([\s\S]*?'webmcp'[\s\S]*?\)/i,
    );
    expect(sql).toMatch(
      /actor_type = 'agent' and source in \('webmcp', 'system'\)/i,
    );
    expect(sql).toMatch(
      /add constraint receipts_actor_source_consistent[\s\S]*not valid;/i,
    );
  });

  it("canonicalizes both legacy and current WebMCP callers to the room member", () => {
    const sql = webMcpAttributionMigration();

    expect(sql).toMatch(
      /v_effective_actor_type text := p_actor_type/i,
    );
    expect(sql).toMatch(
      /if p_source = 'webmcp' then[\s\S]*select member\.role[\s\S]*from public\.room_members member[\s\S]*member\.user_id = p_actor_user_id/i,
    );
    expect(sql).toMatch(
      /v_effective_actor_type := case v_member_role[\s\S]*when 'host' then 'human'[\s\S]*when 'participant' then 'participant'/i,
    );
    expect(sql).toMatch(
      /validate_canvas_actor_source\([\s\S]*?v_effective_actor_type,[\s\S]*?p_source[\s\S]*?\)/i,
    );
    expect(sql).toMatch(
      /commit_canvas_mutation_core\([\s\S]*p_actor_type => v_effective_actor_type/i,
    );
  });

  it("prevents new agent/WebMCP receipts while retaining historical rows", () => {
    const sql = webMcpAttributionMigration();

    expect(sql).toMatch(
      /p_actor_type = 'human' and p_source not in \([\s\S]*?'webmcp'[\s\S]*?\)/i,
    );
    expect(sql).toMatch(
      /p_actor_type = 'participant' and p_source not in \([\s\S]*?'webmcp'[\s\S]*?\)/i,
    );
    expect(sql).toMatch(
      /p_actor_type = 'agent' and p_source <> 'system'[\s\S]*canvas_actor_source_mismatch/i,
    );
    expect(sql).toMatch(
      /revoke execute on function private\.validate_canvas_actor_source\(text, text\)[\s\S]*from public, anon, authenticated, service_role;/i,
    );
  });

  it("validates the expanded check constraint in a later online migration", () => {
    const migrations = migrationFileNames();
    const expandIndex = migrations.findIndex((candidate) =>
      candidate.endsWith("_bind_webmcp_receipts_to_room_members.sql"),
    );
    const validateIndex = migrations.findIndex((candidate) =>
      candidate.endsWith("_validate_webmcp_receipt_actor_constraint.sql"),
    );
    const sql = receiptConstraintValidationMigration();

    expect(expandIndex).toBeGreaterThanOrEqual(0);
    expect(validateIndex).toBeGreaterThan(expandIndex);
    expect(sql).toMatch(
      /alter table public\.receipts[\s\S]*validate constraint receipts_actor_source_consistent;/i,
    );
    expect(sql).not.toMatch(/create or replace function/i);
  });

  it("does not alter packet, invitation, room-lifecycle, or Realtime authority", () => {
    const sql = `${webMcpAttributionMigration()}\n${receiptConstraintValidationMigration()}`;

    expect(sql).not.toMatch(
      /prepare_meeting_packet|approve_meeting_packet|request_meeting_packet_send|recipient|invitation|join_room|create_room/i,
    );
    expect(sql).not.toMatch(
      /(?:alter|create|drop)\s+(?:table|function|policy)\s+realtime\./i,
    );
  });
});
