import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "supabase", "migrations");

function migration() {
  const name = readdirSync(directory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) => candidate.endsWith("_extend_semantic_canvas_objects.sql"));
  expect(name).toBeDefined();
  return readFileSync(join(directory, name!), "utf8");
}

function functionDefinition(sql: string, qualifiedName: string) {
  const definition = sql.match(
    new RegExp(
      `create or replace function ${qualifiedName.replace(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0];
  expect(definition).toBeDefined();
  return definition!;
}

const semanticTypes = [
  "note",
  "task_board",
  "schedule",
  "sketch",
  "diagram",
  "frame",
  "data_table",
  "reference_card",
  "meeting_card",
] as const;

describe("semantic canvas object forward migration", () => {
  it("extends persisted object and canonical mutation allowlists together", () => {
    const sql = migration();
    expect(sql).toMatch(
      /alter table public\.canvas_objects[\s\S]*drop constraint canvas_objects_object_type_check[\s\S]*add constraint canvas_objects_object_type_check/i,
    );

    const validator = functionDefinition(
      sql,
      "private.validate_canvas_mutable_state",
    );
    expect(validator).toMatch(/set search_path = ''/i);
    for (const type of semanticTypes) {
      expect(sql).toContain(`'${type}'`);
      expect(validator).toContain(`'${type}'`);
    }
    expect(sql).toMatch(
      /revoke execute on function private\.validate_canvas_mutable_state\(jsonb\)[\s\S]*from public, anon, authenticated, service_role;/i,
    );
  });

  it("includes all packet-safe semantic objects while continuing to omit rough sketches and frames", () => {
    const sql = migration();
    const packet = functionDefinition(
      sql,
      "private.prepare_meeting_packet_draft_base",
    );
    expect(packet).toMatch(/security definer[\s\S]*set search_path = ''/i);
    for (const type of [
      "note",
      "task_board",
      "schedule",
      "diagram",
      "data_table",
      "reference_card",
      "meeting_card",
    ])
      expect(packet).toContain(`'${type}'`);
    expect(packet).not.toMatch(/object_type in \([^)]*'sketch'/i);
    expect(packet).not.toMatch(/object_type in \([^)]*'frame'/i);
    expect(sql).toMatch(
      /revoke execute on function private\.prepare_meeting_packet_draft_base\([\s\S]*from public, anon, authenticated, service_role;/i,
    );
  });

  it("does not modify Supabase Realtime internals or weaken public grants", () => {
    const sql = migration();
    expect(sql).not.toMatch(/(?:alter|create|drop)\s+(?:table|function|policy)\s+realtime\./i);
    expect(sql).not.toMatch(/grant execute[\s\S]+to (?:public|anon|authenticated)/i);
    expect(sql).not.toMatch(/auth\.role\s*\(|raw_user_meta_data|user_metadata/i);
  });
});
