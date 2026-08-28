import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "supabase", "migrations");

function migration() {
  const name = readdirSync(directory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_restrict_legacy_room_capabilities_to_demo.sql"),
    );
  expect(name).toBeDefined();
  return readFileSync(join(directory, name!), "utf8");
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

describe("legacy room capability demo boundary migration", () => {
  it("refuses every non-demo mode inside create_room_with_host", () => {
    const createRoom = functionDefinition(
      migration(),
      "create_room_with_host",
    );

    expect(createRoom).toMatch(/p_mode\s+is\s+distinct\s+from\s+'demo'/i);
    expect(createRoom).not.toMatch(/p_mode\s+not\s+in\s*\([^)]*standard/i);
  });

  it("binds the generic join token check to a demo room", () => {
    const joinRoom = functionDefinition(
      migration(),
      "join_room_as_participant",
    );

    expect(joinRoom).toMatch(/from\s+public\.rooms\s+room_row/i);
    expect(joinRoom).toMatch(/private\.room_join_capabilities/i);
    expect(joinRoom).toMatch(/room_row\.mode\s*=\s*'demo'/i);
    expect(joinRoom).toMatch(/message\s*=\s*'room_join_token_mismatch'/i);
  });

  it("creates a standard meeting without calling the legacy create function", () => {
    const standardCreate = functionDefinition(
      migration(),
      "create_standard_meeting_with_host",
    );

    expect(standardCreate).not.toMatch(/public\.create_room_with_host\s*\(/i);
    expect(standardCreate).toMatch(/insert into public\.rooms/i);
    expect(standardCreate).toMatch(/'standard'/i);
    expect(standardCreate).toMatch(/insert into public\.room_members/i);
    expect(standardCreate).not.toMatch(/private\.room_join_capabilities/i);
  });
});
