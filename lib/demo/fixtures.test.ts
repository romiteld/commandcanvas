import { describe, expect, it } from "vitest";

import { canvasCommandSchema } from "@/lib/canvas/object-model";
import { createDemoSeedCommands } from "@/lib/demo/fixtures";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ROOM_ID = "22222222-2222-4222-8222-222222222222";

describe("createDemoSeedCommands", () => {
  it("creates a deterministic, non-empty semantic room fixture", () => {
    const commands = createDemoSeedCommands(ROOM_ID);

    expect(commands).toHaveLength(3);
    expect(commands.map((command) => command.type)).toEqual([
      "object.create",
      "object.create",
      "object.create",
    ]);
    expect(
      commands.map((command) =>
        command.type === "object.create" ? command.object.type : "unknown",
      ),
    ).toEqual(["task_board", "schedule", "note"]);
    expect(commands.every((command) => canvasCommandSchema.safeParse(command).success))
      .toBe(true);
  });

  it("contains believable meeting context without recipients or fake presence", () => {
    const serialized = JSON.stringify(createDemoSeedCommands(ROOM_ID));

    expect(serialized).toContain("Confirm launch narrative");
    expect(serialized).toContain("WebMCP dry run");
    expect(serialized).toContain("Decision");
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/presence|online/i);
  });

  it("returns fresh payload graphs so one room cannot mutate another fixture", () => {
    const first = createDemoSeedCommands(ROOM_ID);
    const second = createDemoSeedCommands(ROOM_ID);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it("names persisted fixture objects uniquely for each room", () => {
    const firstRoomObjectIds = createDemoSeedCommands(ROOM_ID).map((command) =>
      command.type === "object.create" ? command.object.id : "",
    );
    const secondRoomObjectIds = createDemoSeedCommands(SECOND_ROOM_ID).map(
      (command) => (command.type === "object.create" ? command.object.id : ""),
    );

    expect(new Set(firstRoomObjectIds).size).toBe(firstRoomObjectIds.length);
    expect(new Set(secondRoomObjectIds).size).toBe(secondRoomObjectIds.length);
    expect(
      firstRoomObjectIds.some((objectId) => secondRoomObjectIds.includes(objectId)),
    ).toBe(false);
  });
});
