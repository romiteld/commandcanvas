// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function ownerGateMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith(
        "_restrict_vision_lab_capture_to_designated_owners.sql",
      ),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

describe("Vision Lab designated-owner authorization migration", () => {
  it("requires the server-controlled boolean capture flag in the owner predicate", () => {
    const sql = ownerGateMigration();
    const ownerPredicate = sql.match(
      /create\s+or\s+replace\s+function\s+public\.is_confirmed_permanent_vision_lab_owner\(\)[\s\S]*?\$\$;[\s\S]*?revoke\s+all\s+on\s+function/i,
    )?.[0];

    expect(ownerPredicate).toBeDefined();
    expect(ownerPredicate).toMatch(/actor\.raw_app_meta_data/i);
    expect(ownerPredicate).toMatch(
      /actor\.raw_app_meta_data\s*@>\s*'\{"vision_lab_capture":\s*true\}'::jsonb/i,
    );
    expect(ownerPredicate).not.toMatch(
      /auth\.jwt\(\)[\s\S]{0,160}app_metadata[\s\S]{0,160}vision_lab_capture/i,
    );
  });

  it("makes finalization call the same designated-owner predicate before submission validation", () => {
    const sql = ownerGateMigration();
    const finalizer = sql.match(
      /create\s+or\s+replace\s+function\s+public\.finalize_vision_lab_capture_submission\([\s\S]*?\$\$;[\s\S]*?revoke\s+all\s+on\s+function/i,
    )?.[0];

    expect(finalizer).toBeDefined();
    expect(finalizer).toMatch(
      /if\s+not\s+public\.is_confirmed_permanent_vision_lab_owner\(\)[\s\S]*?message\s*=\s*'permanent_owner_required'/i,
    );

    const ownerGuard = finalizer!.indexOf(
      "public.is_confirmed_permanent_vision_lab_owner()",
    );
    const submissionValidation = finalizer!.indexOf(
      "invalid_vision_lab_submission",
    );

    expect(ownerGuard).toBeGreaterThan(-1);
    expect(submissionValidation).toBeGreaterThan(ownerGuard);
  });

  it("preserves least-privilege execution grants on both replaced functions", () => {
    const sql = ownerGateMigration();

    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.is_confirmed_permanent_vision_lab_owner\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.is_confirmed_permanent_vision_lab_owner\(\)\s+to\s+authenticated/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.finalize_vision_lab_capture_submission\([\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.finalize_vision_lab_capture_submission\([\s\S]*?to\s+authenticated/i,
    );
  });
});
