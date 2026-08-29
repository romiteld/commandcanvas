import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "supabase", "migrations");

function forwardMigration(slug: string) {
  const name = readdirSync(directory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) => candidate.endsWith(`_${slug}.sql`));
  expect(name).toBeDefined();
  return readFileSync(join(directory, name!), "utf8");
}

function functionDefinition(sql: string, name: string) {
  const definition = sql.match(
    new RegExp(
      `create or replace function (?:public|private)\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0];
  expect(definition).toBeDefined();
  return definition!;
}

function grantedRoles(sql: string, name: string) {
  return [...sql.matchAll(
    new RegExp(
      `grant execute on function public\\.${name}\\([^;]+\\)\\s+to\\s+([^;]+);`,
      "gi",
    ),
  )].map((match) => match[1]!.trim());
}

describe("forward Resend delivery migrations", () => {
  it("makes invitation reservation idempotent without persisting raw recipient or token values", () => {
    const sql = forwardMigration("harden_invitation_delivery");
    expect(sql).toMatch(/request_id\s+uuid\s+not\s+null/i);
    expect(sql).toMatch(/unique\s*\(room_id,\s*created_by_user_id,\s*request_id\)/i);
    expect(sql).toMatch(/idempotency_key/i);
    expect(sql).toMatch(/provider_message_id/i);
    expect(sql).toMatch(/delivery_status/i);
    expect(sql).toMatch(/recipient_email_sha256/i);
    expect(sql).toMatch(/meeting_invite_recipient_cooldown/i);
    expect(sql).toMatch(/'roomName'/i);
    expect(sql).not.toMatch(/invited_email\s+text/i);
    expect(sql).not.toMatch(/raw_token/i);
  });

  it("does not schema-qualify PostgreSQL syntax constructs as functions", () => {
    const sql = forwardMigration("harden_invitation_delivery");
    expect(sql).toMatch(/extract\s*\(\s*epoch\s+from\s+invitation\.expires_at/i);
    expect(sql).not.toMatch(/pg_catalog\.extract\s*\(/i);
    expect(sql).not.toMatch(/pg_catalog\.(?:least|greatest)\s*\(/i);
  });

  it("keeps invitation mutation RPCs host checked, service-only, and safe-search-path", () => {
    const sql = forwardMigration("harden_invitation_delivery");
    expect(functionDefinition(sql, "assert_meeting_invitation_host")).toMatch(
      /stable[\s\S]+security definer[\s\S]+set search_path = ''/i,
    );
    for (const name of [
      "create_room_email_invitation",
      "reserve_room_invitation_delivery",
      "complete_room_invitation_delivery",
      "load_room_invitation_delivery",
    ]) {
      expect(functionDefinition(sql, name)).toMatch(
        /security definer[\s\S]+set search_path = ''/i,
      );
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${name}[\\s\\S]+authenticated`, "i"),
      );
      expect(grantedRoles(sql, name)).toEqual(["service_role"]);
    }
    expect(sql).not.toMatch(/auth\.role\s*\(/i);
    expect(sql).not.toMatch(/user_metadata|raw_user_meta_data/i);
  });

  it("normalizes packet submission truth and creates private webhook dedupe storage", () => {
    const sql = forwardMigration("normalize_resend_delivery_truth");
    expect(sql).toMatch(/update\s+public\.packet_send_requests[\s\S]+status\s*=\s*'submitted'[\s\S]+status\s*=\s*'sent'/i);
    expect(sql).toMatch(/update\s+public\.outbound_shares[\s\S]+status\s*=\s*'submitted'[\s\S]+status\s*=\s*'sent'/i);
    const completionBackfill = sql.match(
      /update\s+public\.packet_send_requests\s+set\s+completed_at\s*=\s*coalesce\([\s\S]*?\)\s+where\s+status\s+in\s*\(\s*'cancelled',\s*'expired'\s*\)\s+and\s+completed_at\s+is\s+null\s*;/i,
    );
    expect(completionBackfill?.[0]).toMatch(/authorized_at[\s\S]+requested_at/i);
    const lifecycle = sql.match(
      /add constraint packet_send_requests_lifecycle_valid[\s\S]*?(?=\n\n?alter table public\.outbound_shares)/i,
    )?.[0];
    expect(lifecycle).toMatch(
      /status in \('submitted', 'preview_only'\)[\s\S]+authorized_by_user_id is not null[\s\S]+authorized_at is not null[\s\S]+completed_at is not null[\s\S]+last_error_code is null/i,
    );
    expect(sql).toMatch(/create table private\.resend_webhook_events/i);
    expect(sql).toMatch(/payload_sha256\s+bytea/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/revoke all privileges[\s\S]+from public, anon, authenticated/i);
    expect(sql).not.toMatch(/payload\s+jsonb|raw_payload/i);
  });

  it("deduplicates and applies signed provider truth without state regression", () => {
    const sql = forwardMigration("normalize_resend_delivery_truth");
    expect(sql).toMatch(/function public\.apply_resend_delivery_event/i);
    expect(sql).toMatch(/on conflict \(provider_event_id\) do nothing/i);
    expect(sql).toMatch(/last_provider_event_at/i);
    expect(sql).toMatch(/resend_provider_match_ambiguous/i);
    expect(sql).toMatch(/packet_email_(?:delivered|bounced|complained|failed|suppressed)/i);
    expect(grantedRoles(sql, "apply_resend_delivery_event")).toEqual([
      "service_role",
    ]);
  });
});
