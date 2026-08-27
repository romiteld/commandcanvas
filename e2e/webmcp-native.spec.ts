import { expect, test } from "@playwright/test";

test("registers the stable catalog on Chrome's native WebMCP surface", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome-webmcp");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByText("8 Site Tools registered")).toBeVisible();

  const toolNames = await page.evaluate(async () => {
    const modelContext = (
      document as unknown as {
        modelContext: {
          getTools: () => Promise<Array<{ name: string }>>;
        };
      }
    ).modelContext;
    return (await modelContext.getTools()).map((tool) => tool.name).sort();
  });

  expect(toolNames).toEqual([
    "create_object",
    "discard_object",
    "get_canvas_state",
    "prepare_meeting_packet",
    "request_packet_send",
    "set_object_state",
    "transform_object",
    "transform_sketch",
  ]);
  expect(browserErrors).toEqual([]);
});
