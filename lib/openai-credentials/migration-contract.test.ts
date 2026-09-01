// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function migrationSql() {
  const directory = join(process.cwd(), "supabase", "migrations");
  const fileName = readdirSync(directory).find((candidate) =>
    candidate.endsWith("_secure_user_openai_credentials.sql"),
  );
  expect(fileName).toBeDefined();
  return readFileSync(join(directory, fileName!), "utf8");
}

describe("saved OpenAI credential Vault migration", () => {
  it("stores only per-user Vault references in a private cascading table", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/create extension if not exists supabase_vault/i);
    expect(sql).not.toMatch(/create extension[^;]+version/i);
    expect(sql).toMatch(/create schema if not exists private/i);
    expect(sql).toMatch(/create table private\.user_openai_credentials/i);
    expect(sql).toMatch(/user_id uuid primary key references auth\.users\s*\(id\) on delete cascade/i);
    expect(sql).toMatch(/vault_secret_id uuid not null unique/i);
    expect(sql).toMatch(/key_fingerprint text not null/i);
    const tableDefinition = sql.match(
      /create table private\.user_openai_credentials\s*\(([\s\S]*?)\n\);/i,
    )?.[1];
    expect(tableDefinition).toBeDefined();
    expect(tableDefinition).not.toMatch(/api_key\s+text/i);
  });

  it("keeps Vault access behind private definer functions and service-only wrappers", () => {
    const sql = migrationSql();

    for (const functionName of [
      "get_user_openai_credential_status",
      "upsert_user_openai_credential",
      "delete_user_openai_credential",
      "resolve_user_openai_credential",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+or\\s+replace\\s+function\\s+private\\._${functionName}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}[\\s\\S]*?security\\s+invoker[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}[^;]+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}[^;]+to\\s+service_role`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+private\\._${functionName}[^;]+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+private\\._${functionName}[^;]+to\\s+service_role`,
          "i",
        ),
      );
    }

    expect(sql).toMatch(/vault\.create_secret\s*\(/i);
    expect(sql).toMatch(/vault\.update_secret\s*\(/i);
    expect(sql).toMatch(/vault\.decrypted_secrets/i);
  });

  it("removes the owned Vault secret when the mapping or auth user cascades", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+private\._delete_user_openai_vault_secret\(\)[\s\S]*?security\s+definer[\s\S]*?set\s+search_path\s*=\s*''[\s\S]*?delete\s+from\s+vault\.secrets[\s\S]*?old\.vault_secret_id/i,
    );
    expect(sql).toMatch(
      /create\s+trigger\s+delete_user_openai_vault_secret[\s\S]*?after\s+delete\s+on\s+private\.user_openai_credentials[\s\S]*?for\s+each\s+row\s+execute\s+function\s+private\._delete_user_openai_vault_secret\(\)/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+private\._delete_user_openai_vault_secret\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    );
  });

  it("denies browser roles direct access to mappings and decrypted Vault data", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/revoke all on table private\.user_openai_credentials\s+from public\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/revoke all on table vault\.decrypted_secrets\s+from public\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/revoke all on table vault\.secrets\s+from public\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/revoke all on schema private from public\s*,\s*anon\s*,\s*authenticated/i);
  });
});
