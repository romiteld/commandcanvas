import { expect, test, type Page, type Route } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";
import { requireProductionApiProxyOrigin } from "../lib/testing/live-probe-guards";

type NativeTool = { name: string };

type NativeModelContext = {
  getTools(): Promise<NativeTool[]>;
  executeTool(
    tool: NativeTool,
    inputArguments: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
  addEventListener(type: "toolchange", listener: () => void): void;
};

type NativeInvocation =
  | { state: "fulfilled"; value: string | null }
  | { state: "rejected"; name: string; message: string };

declare global {
  interface Window {
    __commandCanvasCancellation?: AbortController;
    __commandCanvasInvocation?: Promise<NativeInvocation>;
    __commandCanvasToolChanges?: number;
  }
}

const expectedMode = process.env.WEBMCP_EXPECTED_MODE ?? "static";
const apiProxyOrigin = process.env.WEBMCP_API_PROXY_ORIGIN;
const expectedInitialTools =
  expectedMode === "dynamic"
    ? [
        "control_workspace",
        "create_object",
        "discard_object",
        "get_canvas_state",
        "history_action",
        "organize_objects",
        "prepare_meeting_packet",
        "set_object_state",
        "transform_object",
        "update_object_content",
      ]
    : [
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
      ];

test("exercises Chrome 153's native WebMCP lifecycle and client-side cancellation", async ({
  browser,
  page,
}) => {
  expect(
    browser.version(),
    "This release probe must run in an official Chrome 153 binary.",
  ).toMatch(/^153\./);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  let roomId: string | null = null;
  const roomCapture = captureCreatedRoom(page);
  try {
    if (apiProxyOrigin) await installApiProxy(page, apiProxyOrigin);
    await page.goto("/demo", { waitUntil: "domcontentloaded" });
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 30_000,
    });

    roomId = await roomCapture.resolveRoomId();
    expect(roomId).toMatch(/^[0-9a-f-]{36}$/);

    const surface = await page.evaluate(() => ({
      hasDocumentModelContext: "modelContext" in document,
      hasDeprecatedNavigatorSurface: "modelContext" in navigator,
    }));
    expect(surface).toEqual({
      hasDocumentModelContext: true,
      hasDeprecatedNavigatorSurface: false,
    });

    await expect.poll(() => nativeToolNames(page)).toEqual(expectedInitialTools);
    await page.evaluate(() => {
      const modelContext = (
        document as unknown as { modelContext: NativeModelContext }
      ).modelContext;
      window.__commandCanvasToolChanges = 0;
      modelContext.addEventListener("toolchange", () => {
        window.__commandCanvasToolChanges =
          (window.__commandCanvasToolChanges ?? 0) + 1;
      });
    });

    const initialState = await invokeNativeTool(page, "get_canvas_state", {
      scope: "all",
      includeReceipts: true,
    });
    expect(initialState).toMatchObject({
      ok: true,
      status: "completed",
      data: { revision: 3 },
    });

    const noteResult = await invokeNativeTool(page, "create_object", {
      type: "note",
      title: "Chrome 153 native proof",
      text: "Created through document.modelContext.executeTool.",
      tone: "sky",
    });
    expect(noteResult).toMatchObject({
      ok: true,
      status: "completed",
      data: {
        revision: 4,
        affectedObjectIds: [expect.any(String)],
      },
    });
    await expect(
      page.getByRole("button", { name: "Select Chrome 153 native proof" }),
    ).toBeVisible();
    const agentReceipt = page.getByRole("button", {
      name: "Open activity drawer: Daniel created “Chrome 153 native proof”.",
    });
    await expect(agentReceipt).toBeVisible();
    await expect(
      agentReceipt.getByText("R4 · webmcp", { exact: true }),
    ).toBeVisible();

    // Freehand strokes remain a human-input artifact. The WebMCP creation tool
    // deliberately accepts semantic objects rather than raw persistence data.
    await createArchitectureSketch(page);

    await verifyRegistrationLifecycle(page, expectedMode);
    await verifyClientSideCancellation(page);

    const finalState = await invokeNativeTool(page, "get_canvas_state", {
      scope: "all",
      includeReceipts: true,
    });
    expect(finalState).toMatchObject({
      ok: true,
      data: { revision: 5 },
    });

    expect(pageErrors).toEqual([]);
    expect(
      consoleErrors.filter(
        (message) => !isExpectedCancellationConsoleMessage(message),
      ),
    ).toEqual([]);
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

async function verifyRegistrationLifecycle(page: Page, mode: string) {
  await page.getByRole("button", { name: "Select Rough sketch" }).click();

  if (mode === "static") {
    await expect.poll(() => nativeToolNames(page)).toEqual(expectedInitialTools);
    expect(await toolChangeCount(page)).toBe(0);
    return;
  }

  await expect.poll(() => nativeToolNames(page)).toEqual(
    [...expectedInitialTools, "transform_sketch"].sort(),
  );
  expect(await toolChangeCount(page)).toBeGreaterThan(0);
  const selectedState = await invokeNativeTool(page, "get_canvas_state", {
    scope: "selected",
    includeReceipts: false,
  });
  const sketchId = (
    selectedState as { data?: { selectedObjectId?: unknown } }
  ).data?.selectedObjectId;
  expect(sketchId).toEqual(expect.any(String));
  if (typeof sketchId !== "string")
    throw new Error("The selected human sketch did not expose a stable ID.");

  // The current credential architecture has no deployment-owner provider key.
  // Supply a syntactically valid, non-secret session key so the request reaches
  // Playwright's deterministic route before any external provider boundary.
  await page
    .getByRole("button", { name: "Open WebMCP agent activity" })
    .click();
  await page
    .getByLabel("Your OpenAI API key")
    .fill(["s", "k", "-", "a".repeat(24)].join(""));
  await page
    .getByRole("button", { name: "Close WebMCP activity and CommandCanvas Live Voice drawer" })
    .click();

  let releaseResponse: (() => void) | undefined;
  let requestObserved: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    requestObserved = resolve;
  });

  const routeHandler = async (route: Route) => {
    requestObserved?.();
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        probe: "deterministic-lifecycle-response",
      }),
    });
  };
  await page.route("**/api/rooms/*/transform-sketch", routeHandler);

  await startNativeInvocation(page, "transform_sketch", {
    sketchId,
    instruction: "Verify lifecycle separation.",
    outputKind: "architecture",
  });
  await observed;

  // The selected sketch can legitimately overlap the launch board in world
  // space. Invoke the board's real selection control directly so this
  // lifecycle probe tests registration churn rather than pointer hit-testing.
  await page
    .getByRole("button", { name: "Select Launch readiness" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => nativeToolNames(page)).toEqual(expectedInitialTools);

  releaseResponse?.();
  const lifecycleResult = await finishNativeInvocation(page);
  expect(lifecycleResult.state).toBe("fulfilled");
  if (lifecycleResult.state === "fulfilled") {
    expect(JSON.parse(lifecycleResult.value ?? "null")).toMatchObject({
      ok: false,
      code: "execution_failed",
      message: "Sketch interpretation returned an invalid response.",
    });
  }
  await page.unroute("**/api/rooms/*/transform-sketch", routeHandler);
}

async function verifyClientSideCancellation(page: Page) {
  let releaseRequest: (() => void) | undefined;
  let requestObserved: (() => void) | undefined;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    requestObserved = resolve;
  });

  const routeHandler = async (route: Route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes("Client abort probe")) {
      await route.continue();
      return;
    }
    // The matching mutation is deliberately intercepted before the server
    // boundary. This proves AbortSignal propagation from executeTool to the
    // browser fetch, not cancellation of work already received by the server.
    requestObserved?.();
    await requestGate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "probe_should_not_complete",
          message: "Client-side cancellation probe response must not complete.",
        },
      }),
    });
  };
  await page.route("**/api/rooms/*/commands", routeHandler);

  await startNativeInvocation(
    page,
    "create_object",
    {
      type: "note",
      title: "Client abort probe",
      text: "Client-side cancellation probe",
      tone: "coral",
    },
    true,
  );
  await observed;
  await page.evaluate(() => window.__commandCanvasCancellation?.abort());
  releaseRequest?.();

  const cancelled = await finishNativeInvocation(page);
  expect(cancelled).toMatchObject({
    state: "rejected",
    name: "AbortError",
  });
  await page.unroute("**/api/rooms/*/commands", routeHandler);
}

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
      .getByText("Revision 5", { exact: true }),
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

async function nativeToolNames(page: Page) {
  return page.evaluate(async () => {
    const modelContext = (
      document as unknown as { modelContext: NativeModelContext }
    ).modelContext;
    return (await modelContext.getTools()).map((tool) => tool.name).sort();
  });
}

async function toolChangeCount(page: Page) {
  return page.evaluate(() => window.__commandCanvasToolChanges ?? 0);
}

async function invokeNativeTool(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const raw = await page.evaluate(
    async ({ toolName, toolInput }) => {
      const modelContext = (
        document as unknown as { modelContext: NativeModelContext }
      ).modelContext;
      const tool = (await modelContext.getTools()).find(
        (candidate) => candidate.name === toolName,
      );
      if (!tool) throw new Error(`Native WebMCP tool unavailable: ${toolName}`);
      return modelContext.executeTool(tool, JSON.stringify(toolInput), {});
    },
    { toolName: name, toolInput: input },
  );
  return JSON.parse(raw ?? "null") as unknown;
}

async function startNativeInvocation(
  page: Page,
  name: string,
  input: Record<string, unknown>,
  cancellable = false,
) {
  await page.evaluate(
    async ({ toolName, toolInput, useCancellation }) => {
      const modelContext = (
        document as unknown as { modelContext: NativeModelContext }
      ).modelContext;
      const tool = (await modelContext.getTools()).find(
        (candidate) => candidate.name === toolName,
      );
      if (!tool) throw new Error(`Native WebMCP tool unavailable: ${toolName}`);
      const controller = new AbortController();
      if (useCancellation) window.__commandCanvasCancellation = controller;
      window.__commandCanvasInvocation = modelContext
        .executeTool(tool, JSON.stringify(toolInput), {
          signal: controller.signal,
        })
        .then(
          (value) => ({ state: "fulfilled", value }) as const,
          (error: unknown) => ({
            state: "rejected",
            name:
              typeof error === "object" && error && "name" in error
                ? String(error.name)
                : "Error",
            message:
              typeof error === "object" && error && "message" in error
                ? String(error.message)
                : String(error),
          }),
        );
    },
    { toolName: name, toolInput: input, useCancellation: cancellable },
  );
}

async function finishNativeInvocation(page: Page) {
  return page.evaluate(async () => {
    if (!window.__commandCanvasInvocation)
      throw new Error("No native WebMCP invocation is in flight.");
    return window.__commandCanvasInvocation;
  });
}

async function installApiProxy(page: Page, proxyOrigin: string) {
  const targetOrigin = requireProductionApiProxyOrigin(proxyOrigin);
  await page.route("**/api/**", async (route) => {
    const source = new URL(route.request().url());
    if (!isWebMcpProbeApiPath(source.pathname)) {
      await route.abort("blockedbyclient");
      return;
    }
    const response = await route.fetch({
      url: `${targetOrigin}${source.pathname}${source.search}`,
    });
    await route.fulfill({ response });
  });
}

function isWebMcpProbeApiPath(pathname: string) {
  return (
    pathname === "/api/rooms" ||
    /^\/api\/rooms\/[0-9a-f-]{36}(?:\/(?:commands|transform-sketch))?$/.test(
      pathname,
    )
  );
}

function isExpectedCancellationConsoleMessage(message: string) {
  return (
    message.includes("Failed to load resource") &&
    (message.includes("net::ERR_ABORTED") ||
      message.includes("net::ERR_BLOCKED_BY_CLIENT.Inspector"))
  );
}
