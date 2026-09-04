import { expect, test } from "@playwright/test";

type NativeTool = { name: string };

type NativeModelContext = {
  getTools(): Promise<NativeTool[]>;
  executeTool(
    tool: NativeTool,
    inputArguments: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
};

test("registers the stable catalog on Chrome's native WebMCP surface", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome-webmcp");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/local");
  await page.getByRole("button", { name: "Open system status" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "System status drawer" })
      .getByRole("region", { name: "Service status" })
      .getByText("12 WebMCP tools registered", { exact: true }),
  ).toBeVisible();

  const toolNames = await page.evaluate(async () => {
    const modelContext = (
      document as unknown as {
        modelContext: NativeModelContext;
      }
    ).modelContext;
    return (await modelContext.getTools()).map((tool) => tool.name).sort();
  });

  expect(toolNames).toEqual([
    "control_workspace",
    "create_object",
    "discard_object",
    "get_canvas_state",
    "history_action",
    "organize_objects",
    "prepare_meeting_packet",
    "request_packet_send",
    "set_object_state",
    "transform_object",
    "transform_sketch",
    "update_object_content",
  ]);

  const initialState = await invokeNativeTool(page, "get_canvas_state", {
    scope: "all",
    includeReceipts: true,
  });
  expect(initialState).toMatchObject({
    ok: true,
    status: "completed",
    data: { revision: 0 },
  });

  const mutation = await invokeNativeTool(page, "create_object", {
    type: "note",
    title: "Native Site Tool proof",
    text: "Created through the live document.modelContext surface.",
    tone: "sky",
  });
  expect(mutation).toMatchObject({
    ok: true,
    status: "completed",
    data: {
      revision: 1,
      affectedObjectIds: [expect.any(String)],
    },
  });
  await expect(
    page.getByRole("button", { name: "Select Native Site Tool proof" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open activity drawer", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Activity drawer" }),
  ).toContainText("R1 · webmcp");
  expect(browserErrors).toEqual([]);
});

async function invokeNativeTool(
  page: import("@playwright/test").Page,
  name: string,
  input: Record<string, unknown>,
) {
  const serialized = await page.evaluate(
    async ({ toolName, input }) => {
      const modelContext = (
        document as unknown as { modelContext: NativeModelContext }
      ).modelContext;
      const tool = (await modelContext.getTools()).find(
        (candidate) => candidate.name === toolName,
      );
      if (!tool) throw new Error(`Native tool ${toolName} is unavailable.`);
      return modelContext.executeTool(tool, JSON.stringify(input));
    },
    { toolName: name, input },
  );
  if (typeof serialized !== "string")
    throw new Error(`Native tool ${name} returned no serialized result.`);
  return JSON.parse(serialized) as unknown;
}
