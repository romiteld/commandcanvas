import { expect, test, type Page } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";

const providerOpenAiKey = process.env.COMMANDCANVAS_PROVIDER_OPENAI_KEY;

test.use({ trace: "off", screenshot: "off", video: "off" });

test("rasterizes a pointer sketch for real vision and preserves it beside the structured diagram", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_OPENAI_PROVIDER_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop" ||
      !providerOpenAiKey,
  );
  test.setTimeout(150_000);

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const roomCapture = captureCreatedRoom(page);
  let roomId: string | null = null;

  try {
    await page.addInitScript(() => {
      const registrations: Array<{
        tool: {
          name: string;
          execute: (
            input: unknown,
            options: { signal: AbortSignal },
          ) => Promise<unknown>;
        };
        signal: AbortSignal;
      }> = [];
      Object.defineProperty(document, "modelContext", {
        configurable: true,
        value: {
          registerTool: async (
            tool: (typeof registrations)[number]["tool"],
            options: { signal: AbortSignal },
          ) => {
            registrations.push({ tool, signal: options.signal });
          },
        },
      });
      Object.defineProperty(window, "__commandCanvasRegistrations", {
        configurable: true,
        value: registrations,
      });
    });
    await page.goto("/demo");
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();
    await page
      .getByRole("button", { name: "Open ChatGPT Site Tools and activity drawer" })
      .click();
    await page
      .getByLabel("Your OpenAI API key")
      .fill(providerOpenAiKey!);
    await page
      .getByRole("button", { name: "Close ChatGPT command drawer" })
      .click();
    await createArchitectureSketch(page);

    const sourceSketch = page.getByRole("button", {
      name: "Select Rough sketch",
    });
    await expect(sourceSketch).toBeVisible();
    await sourceSketch.click();

    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/rooms/${roomId}/transform-sketch`,
      { timeout: 120_000 },
    );
    const toolResult = await page.evaluate(async () => {
      const registrations = (
        window as typeof window & {
          __commandCanvasRegistrations: Array<{
            tool: {
              name: string;
              execute: (
                input: unknown,
                options: { signal: AbortSignal },
              ) => Promise<unknown>;
            };
            signal: AbortSignal;
          }>;
        }
      ).__commandCanvasRegistrations;
      const active = (name: string) =>
        [...registrations]
          .reverse()
          .find(({ tool, signal }) => tool.name === name && !signal.aborted)
          ?.tool;
      const stateTool = active("get_canvas_state");
      const transformTool = active("transform_sketch");
      if (!stateTool || !transformTool)
        throw new Error("The active sketch tools were not registered.");
      const stateResult = (await stateTool.execute(
        { scope: "selected", includeReceipts: false },
        { signal: new AbortController().signal },
      )) as { data?: { selectedObjectId?: unknown } };
      if (typeof stateResult.data?.selectedObjectId !== "string")
        throw new Error("The selected sketch ID was unavailable.");
      return transformTool.execute(
        {
          sketchId: stateResult.data.selectedObjectId,
          instruction: "Make that usable as a clean architecture diagram.",
          outputKind: "architecture",
        },
        { signal: new AbortController().signal },
      );
    });
    expect(toolResult).toMatchObject({
      ok: true,
      status: "completed",
      data: { revision: 5 },
    });
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      transform: {
        provider: "openai",
        model: expect.stringMatching(/^gpt-5\.6-(terra|sol)$/),
        responseId: expect.any(String),
        sourceSketchId: expect.any(String),
        payload: {
          kind: "architecture",
          sourceSketchId: expect.any(String),
          nodes: expect.any(Array),
          edges: expect.any(Array),
        },
      },
    });

    await expect(sourceSketch).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Select Structured architecture" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .getByLabel("Canvas coordinates")
        .getByText("Revision 5", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", {
          name: "Open activity drawer: Daniel created “Structured architecture”.",
        })
        .getByText("R5 · webmcp", { exact: true }),
    ).toBeVisible();
    expect(browserErrors).toEqual([]);
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

async function createArchitectureSketch(page: Page) {
  await page.getByRole("button", { name: "Create sketch" }).click();
  const surface = page.getByRole("img", { name: "Sketch draft surface" });
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Sketch surface geometry is unavailable.");

  await drawStroke(page, bounds, [
    [0.13, 0.2],
    [0.39, 0.2],
    [0.39, 0.55],
    [0.13, 0.55],
    [0.13, 0.2],
  ]);
  await drawStroke(page, bounds, [
    [0.61, 0.2],
    [0.87, 0.2],
    [0.87, 0.55],
    [0.61, 0.55],
    [0.61, 0.2],
  ]);
  await drawStroke(page, bounds, [
    [0.39, 0.37],
    [0.61, 0.37],
  ]);
  await drawStroke(page, bounds, [
    [0.55, 0.3],
    [0.61, 0.37],
    [0.55, 0.44],
  ]);

  await expect(page.getByText("4 draft strokes")).toBeVisible();
  await page.getByRole("button", { name: "Finish sketch" }).click();
  await expect(
    page
      .getByLabel("Canvas coordinates")
      .getByText("Revision 4", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

async function drawStroke(
  page: Page,
  bounds: { x: number; y: number; width: number; height: number },
  points: ReadonlyArray<readonly [number, number]>,
) {
  const [first, ...rest] = points;
  if (!first) throw new Error("A sketch stroke requires at least one point.");
  await page.mouse.move(
    bounds.x + bounds.width * first[0],
    bounds.y + bounds.height * first[1],
  );
  await page.mouse.down();
  for (const [x, y] of rest)
    await page.mouse.move(
      bounds.x + bounds.width * x,
      bounds.y + bounds.height * y,
      { steps: 3 },
    );
  await page.mouse.up();
}
