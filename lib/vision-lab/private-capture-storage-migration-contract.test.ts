import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function privateCaptureMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_vision_lab_private_capture_inbox.sql"),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("Vision Lab private capture storage migration", () => {
  it("creates a private 250 MB WebM and JSON-only capture bucket", () => {
    const sql = privateCaptureMigration();

    expect(sql).toMatch(/insert\s+into\s+storage\.buckets/i);
    expect(sql).toMatch(/'vision-lab-captures'/i);
    expect(sql).toMatch(/262144000/i);
    expect(sql).toMatch(/video\/webm/i);
    expect(sql).toMatch(/application\/json/i);
    expect(sql).toMatch(/\bfalse\b/i);
  });

  it("limits object access to a permanent user's own canonical session paths", () => {
    const sql = privateCaptureMigration();

    expect(sql).toMatch(
      /function\s+public\.is_confirmed_permanent_vision_lab_owner[\s\S]*?security\s+definer[\s\S]*?from\s+auth\.users[\s\S]*?email_confirmed_at\s+is\s+not\s+null/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.is_confirmed_permanent_vision_lab_owner\(\)[\s\S]*?to\s+authenticated/i,
    );
    expect(sql).toMatch(/for\s+insert\s+to\s+authenticated/i);
    expect(sql).toMatch(/for\s+select\s+to\s+authenticated/i);
    expect(sql).toMatch(/for\s+delete\s+to\s+authenticated/i);
    expect(sql).not.toMatch(/for\s+update\s+to\s+authenticated/i);
    expect(sql).toMatch(/\(select\s+auth\.uid\(\)\)::text/i);
    expect(sql).toMatch(
      /\(select\s+auth\.jwt\(\)\)\s*->>\s*'is_anonymous'\)?\s*=\s*'false'/i,
    );
    expect(sql).not.toMatch(/coalesce[\s\S]{0,100}is_anonymous/i);
    expect(sql).toMatch(
      /with\s+check\s*\([\s\S]*?is_confirmed_permanent_vision_lab_owner\(\)/i,
    );
    expect(sql).toMatch(/capture\.webm/i);
    expect(sql).toMatch(/manifest\.json/i);
    expect(sql).toMatch(/vision-lab-/i);
  });

  it("creates immutable owner-readable uploaded-unverified receipts", () => {
    const sql = privateCaptureMigration();

    expect(sql).toMatch(/create\s+table\s+public\.vision_lab_capture_submissions/i);
    expect(sql).toMatch(/uploaded_unverified/i);
    expect(sql).toMatch(/video_sha256/i);
    expect(sql).toMatch(/manifest_sha256/i);
    expect(sql).toMatch(/video_bytes/i);
    expect(sql).toMatch(/manifest_bytes/i);
    expect(sql).toMatch(/consent_version/i);
    expect(sql).toMatch(/protocol_id/i);
    expect(sql).toMatch(/protocol_version/i);
    expect(sql).toMatch(/alter\s+table\s+public\.vision_lab_capture_submissions\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/grant\s+select\s+on\s+table\s+public\.vision_lab_capture_submissions\s+to\s+authenticated/i);
    expect(sql).not.toMatch(/grant\s+[^;]*insert[^;]*vision_lab_capture_submissions/i);
    expect(sql).not.toMatch(
      /grant\s+[^;]*(?:update|delete)[^;]*on\s+table\s+public\.vision_lab_capture_submissions/i,
    );
  });

  it("binds each receipt path, actor, and session under RLS", () => {
    const sql = privateCaptureMigration();

    expect(sql).toMatch(/actor_user_id\s*=\s*\(select\s+auth\.uid\(\)\)/i);
    expect(sql).toMatch(/video_object_path\s*=\s*actor_user_id::text\s*\|\|\s*'\/'\s*\|\|\s*vision_lab_session_id\s*\|\|\s*'\/capture\.webm'/i);
    expect(sql).toMatch(/manifest_object_path\s*=\s*actor_user_id::text\s*\|\|\s*'\/'\s*\|\|\s*vision_lab_session_id\s*\|\|\s*'\/manifest\.json'/i);
    expect(sql).toMatch(/unique\s*\(\s*actor_user_id\s*,\s*vision_lab_session_id\s*\)/i);
    expect(sql).toMatch(/append-only audit/i);
    expect(sql).toMatch(/re-hash/i);
  });

  it("finalizes receipts idempotently only after both owner objects exist", () => {
    const sql = privateCaptureMigration();

    expect(sql).toMatch(
      /function\s+public\.finalize_vision_lab_capture_submission[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''/i,
    );
    expect(sql).toMatch(/from\s+auth\.users[\s\S]*?email_confirmed_at\s+is\s+not\s+null/i);
    expect(sql).toMatch(/is_anonymous\s+is\s+false/i);
    expect(sql).toMatch(
      /from\s+storage\.objects[\s\S]*?object_row\.name\s*=\s*p_video_object_path[\s\S]*?object_row\.owner_id\s*=\s*v_actor_user_id::text[\s\S]*?metadata[\s\S]*?p_video_bytes/i,
    );
    expect(sql).toMatch(
      /from\s+storage\.objects[\s\S]*?object_row\.name\s*=\s*p_manifest_object_path[\s\S]*?object_row\.owner_id\s*=\s*v_actor_user_id::text[\s\S]*?metadata[\s\S]*?p_manifest_bytes/i,
    );
    expect(sql).toMatch(/p_video_object_path[\s\S]*?capture\.webm/i);
    expect(sql).toMatch(/p_manifest_object_path[\s\S]*?manifest\.json/i);
    expect(sql).toMatch(/on\s+conflict\s*\(\s*actor_user_id\s*,\s*vision_lab_session_id\s*\)\s+do\s+nothing/i);
    expect(sql).toMatch(/vision_lab_submission_conflict/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.finalize_vision_lab_capture_submission[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.finalize_vision_lab_capture_submission[\s\S]*?to\s+authenticated/i,
    );
  });
});
