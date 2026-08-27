import { describe, expect, it } from "vitest";

import { canvasCommandSchema } from "@/lib/canvas/object-model";
import { createDemoSeedCommands } from "@/lib/demo/fixtures";

describe("createDemoSeedCommands", () => {
  it("creates a deterministic, non-empty semantic room fixture", () => {
    const commands = createDemoSeedCommands();

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
    const serialized = JSON.stringify(createDemoSeedCommands());

    expect(serialized).toContain("Confirm launch narrative");
    expect(serialized).toContain("WebMCP dry run");
    expect(serialized).toContain("Decision");
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/presence|online/i);
  });

  it("returns fresh payload graphs so one room cannot mutate another fixture", () => {
    const first = createDemoSeedCommands();
    const second = createDemoSeedCommands();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });
});
