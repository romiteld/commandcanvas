// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function migrationSql() {
  const directory = join(process.cwd(), "supabase", "migrations");
  const fileName = readdirSync(directory).find((candidate) =>
    candidate.endsWith("_user_profiles.sql"),
  );
  expect(fileName).toBeDefined();
  return readFileSync(join(directory, fileName!), "utf8");
}

describe("durable user profile migration", () => {
  it("stores one bounded private profile per auth user and denies browser table access", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create table private\.user_profiles/i);
    expect(sql).toMatch(
      /user_id uuid primary key references auth\.users\s*\(id\) on delete cascade/i,
    );
    expect(sql).toMatch(
      /display_name text not null[\s\S]*?char_length\(display_name\) between 1 and 64/i,
    );
    expect(sql).toMatch(/color text not null[\s\S]*?\^#\[0-9A-Fa-f\]\{6\}\$/i);
    expect(sql).toMatch(/alter table private\.user_profiles enable row level security/i);
    expect(sql).toMatch(
      /revoke all on table private\.user_profiles\s+from public\s*,\s*anon\s*,\s*authenticated/i,
    );
  });

  it("keeps profile reads and writes behind service-only locked wrappers", () => {
    const sql = migrationSql();

    // COALESCE is SQL syntax rather than a pg_catalog function. Qualifying it
    // parses as a nonexistent function and makes the migration fail at apply
    // time even though a regex-only contract otherwise looks valid.
    expect(sql).not.toMatch(/pg_catalog\.coalesce\s*\(/i);

    for (const name of ["get_user_profile", "upsert_user_profile"]) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+or\\s+replace\\s+function\\s+private\\._${name}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `create\\s+or\\s+replace\\s+function\\s+public\\.${name}[\\s\\S]*?security\\s+invoker[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[^;]+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]+to\\s+service_role`,
          "i",
        ),
      );
    }
  });

  it("atomically upserts the profile and returns an existing matching room on a lost-response retry", () => {
    const sql = migrationSql();
    const functionBody = sql.match(
      /create or replace function public\.create_standard_meeting_with_host\([\s\S]*?\n\$\$;/i,
    )?.[0];

    expect(functionBody).toBeDefined();
    expect(functionBody).toMatch(/insert into private\.user_profiles/i);
    expect(functionBody).toMatch(/on conflict \(user_id\) do update/i);
    expect(functionBody).toMatch(
      /from public\.rooms[\s\S]*?where[\s\S]*?id = p_room_id[\s\S]*?created_by = p_host_user_id/i,
    );
    expect(functionBody).toMatch(/'resumed', true/i);
  });
});
