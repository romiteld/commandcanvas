import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function participantWebMcpMigration() {
  const fileName = readdirSync(migrationsDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()
    .find((candidate) =>
      candidate.endsWith("_allow_participant_webmcp_canvas_mutations.sql"),
    );

  expect(fileName).toBeDefined();
  return readFileSync(join(migrationsDirectory, fileName!), "utf8");
}

function canonicalMutationCore(sql: string) {
  const definition = sql.match(
    /create or replace function private\.commit_canvas_mutation_core\([\s\S]*?\n\$\$;/i,
  )?.[0];
  expect(definition).toBeDefined();
  return definition!;
}

describe("participant WebMCP canvas-mutation forward migration", () => {
  it("allows an agent actor for either room-member role while preserving actor attribution", () => {
    const core = canonicalMutationCore(participantWebMcpMigration());

    expect(core).toMatch(
      /from public\.room_members rm[\s\S]*rm\.room_id = p_room_id[\s\S]*rm\.user_id = p_actor_user_id[\s\S]*for key share/i,
    );
    expect(core).toMatch(
      /if p_actor_type = 'agent' then\s+v_actor_display_name := 'CommandCanvas agent';\s+elsif p_actor_type = 'human' and v_member_role <> 'host'/i,
    );
    expect(core).not.toContain("canvas_agent_requires_host");
  });

  it("keeps human and participant actor-role checks and the private service boundary", () => {
    const sql = participantWebMcpMigration();
    const core = canonicalMutationCore(sql);

    expect(core).toMatch(
      /p_actor_type = 'human' and v_member_role <> 'host'[\s\S]*canvas_actor_type_mismatch/i,
    );
    expect(core).toMatch(
      /p_actor_type = 'participant' and v_member_role <> 'participant'[\s\S]*canvas_actor_type_mismatch/i,
    );
    expect(core).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(
      /revoke all on function private\.commit_canvas_mutation_core\([\s\S]*from public, anon, authenticated, service_role;/i,
    );
    expect(sql).not.toMatch(/grant execute[\s\S]+to (?:public|anon|authenticated)/i);
  });

  it("does not alter packet, invitation, room-lifecycle, or Realtime authority", () => {
    const sql = participantWebMcpMigration();

    expect(sql).not.toMatch(
      /prepare_meeting_packet|approve_meeting_packet|request_meeting_packet_send|recipient|invitation|join_room|create_room/i,
    );
    expect(sql).not.toMatch(
      /(?:alter|create|drop)\s+(?:table|function|policy)\s+realtime\./i,
    );
  });
});
