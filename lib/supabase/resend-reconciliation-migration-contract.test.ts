import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "supabase", "migrations");

function migration() {
  const fileName = readdirSync(directory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_reconcile_resend_and_bound_packet_delivery.sql"),
    );
  expect(fileName).toBeDefined();
  return readFileSync(join(directory, fileName!), "utf8");
}

function functionDefinition(sql: string, name: string) {
  const definition = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0];
  expect(definition).toBeDefined();
  return definition!;
}

describe("Resend reconciliation and packet delivery admission migration", () => {
  it("reprocesses exact unmatched events while preserving immutable provider identity", () => {
    const sql = migration();
    const apply = functionDefinition(sql, "apply_resend_delivery_event");
    expect(apply).toMatch(/resend_webhook_events[\s\S]+for update/i);
    expect(apply).toMatch(/processing_result\s*=\s*'unmatched'/i);
    expect(apply).toMatch(/payload_sha256[\s\S]+is distinct from/i);
    expect(apply).toMatch(/resend_delivery_event_conflict/i);
    expect(apply).toMatch(/interval\s+'15 minutes'/i);
    expect(apply).toMatch(/resend_provider_match_timeout/i);
    expect(apply).toMatch(/security definer[\s\S]+set search_path\s*=\s*''/i);
  });

  it("locks packet requests before outbound shares on both webhook and completion paths", () => {
    const sql = migration();
    const apply = functionDefinition(sql, "apply_resend_delivery_event");
    const completion = functionDefinition(sql, "complete_meeting_packet_send");
    const applyRequestLock = apply.search(
      /from public\.packet_send_requests[\s\S]{0,500}?for update/i,
    );
    const applyShareLock = apply.search(
      /from public\.outbound_shares[\s\S]{0,500}?for update/i,
    );
    expect(applyRequestLock).toBeGreaterThanOrEqual(0);
    expect(applyShareLock).toBeGreaterThan(applyRequestLock);
    const completionRequestLock = completion.search(
      /from public\.packet_send_requests[\s\S]{0,500}?for update/i,
    );
    const completionShareLock = completion.search(
      /from public\.outbound_shares[\s\S]{0,500}?for update/i,
    );
    expect(completionRequestLock).toBeGreaterThanOrEqual(0);
    expect(completionShareLock).toBeGreaterThan(completionRequestLock);
  });

  it("keeps packet provider admission private, idempotent, bounded, and service-only", () => {
    const sql = migration();
    const admission = functionDefinition(sql, "reserve_packet_resend_admission");
    const admissionTable = sql.match(
      /create table private\.packet_resend_admissions[\s\S]*?\n\);/i,
    )?.[0];
    expect(admissionTable).toBeDefined();
    expect(sql).toMatch(/create table private\.packet_resend_admissions/i);
    expect(sql).toMatch(/send_request_id\s+uuid\s+not null[\s\S]+unique/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(
      /revoke all privileges on table private\.packet_resend_admissions[\s\S]+public, anon, authenticated, service_role/i,
    );
    expect(admission).toMatch(/security definer[\s\S]+set search_path\s*=\s*''/i);
    expect(admission).toMatch(/room_mode[\s\S]+demo_room_preview_only/i);
    expect(admission).toMatch(/pg_advisory_xact_lock/i);
    expect(admission).toMatch(/packet_resend_rate_limited/i);
    expect(admission).toMatch(/5[\s\S]+20[\s\S]+50[\s\S]+200/i);
    expect(sql).toMatch(
      /revoke all on function public\.reserve_packet_resend_admission[\s\S]+public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.reserve_packet_resend_admission[\s\S]+service_role/i,
    );
    expect(admissionTable).not.toMatch(
      /recipient_email|recipient_snapshot|content_snapshot|api_key/i,
    );
  });
});
