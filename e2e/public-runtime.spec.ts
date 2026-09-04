import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  assertLiveProbeTarget,
  requireProductionApiProxyOrigin,
} from "../lib/testing/live-probe-guards";
import {
  MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
  MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
} from "../lib/gesture/spatial-vision-engine";
import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";

const fakeCameraPath = process.env.COMMANDCANVAS_FAKE_CAMERA_PATH;
test.use({
  launchOptions: {
    args: fakeCameraPath
      ? [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-video-capture=${fakeCameraPath}`,
        ]
      : [],
  },
});

test("closes the final public vision, packet, and fake-camera runtime boundaries", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_PUBLIC_RUNTIME_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );
  test.setTimeout(240_000);

  const baseUrl = String(testInfo.project.use.baseURL ?? "");
  assertLiveProbeTarget(
    baseUrl,
    process.env.WEBMCP_LIVE_PROBE === "true",
  );
  const origin = requireProductionApiProxyOrigin(new URL(baseUrl).origin);
  if (
    !fakeCameraPath ||
    !isAbsolute(fakeCameraPath) ||
    !fakeCameraPath.endsWith(".y4m") ||
    !existsSync(fakeCameraPath)
  )
    throw new Error(
      "COMMANDCANVAS_FAKE_CAMERA_PATH must name an existing absolute .y4m fixture.",
    );

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.grantPermissions(["camera"], { origin });
  const page = await context.newPage();
  const roomCapture = captureCreatedRoom(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const cameraResponses: Array<{ url: string; status: number }> = [];
  let roomId: string | null = null;

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text() !==
        "INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
    )
      consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    );
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isHandEngineAsset(url))
      cameraResponses.push({ url, status: response.status() });
  });

  try {
    await page.goto("/demo", { waitUntil: "domcontentloaded" });
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page
        .getByLabel("Canvas coordinates")
        .getByText("Revision 3", { exact: true }),
    ).toBeVisible();
    roomId = await roomCapture.resolveRoomId();
    expect(roomId).toMatch(/^[0-9a-f-]{36}$/);

    await createArchitectureSketch(page);
    const sourceSketch = page.getByRole("button", {
      name: "Select Rough sketch",
    });
    await expect(sourceSketch).toBeVisible();
    await sourceSketch.click();

    const visionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/rooms/${roomId}/transform-sketch`,
      { timeout: 120_000 },
    );
    await page.getByRole("button", { name: "Make usable" }).click();
    const visionResponse = await visionResponsePromise;
    expect(visionResponse.status()).toBe(200);
    const visionBody = (await visionResponse.json()) as {
      ok?: unknown;
      transform?: {
        provider?: unknown;
        model?: unknown;
        responseId?: unknown;
        sourceSketchId?: unknown;
        payload?: {
          kind?: unknown;
          sourceSketchId?: unknown;
          nodes?: unknown[];
          edges?: unknown[];
        };
      };
    };
    expect(visionBody.ok).toBe(true);
    expect(visionBody.transform).toMatchObject({
      provider: "openai",
      model: expect.stringMatching(/^gpt-5\.6-(terra|sol)$/),
      responseId: expect.any(String),
      sourceSketchId: expect.any(String),
      payload: {
        kind: expect.stringMatching(/^(architecture|flowchart|diagram)$/),
        sourceSketchId: expect.any(String),
        nodes: expect.any(Array),
        edges: expect.any(Array),
      },
    });
    expect(visionBody.transform?.payload?.sourceSketchId).toBe(
      visionBody.transform?.sourceSketchId,
    );
    expect(visionBody.transform?.payload?.nodes?.length).toBeGreaterThanOrEqual(2);
    const outputKind = visionBody.transform?.payload?.kind;
    if (
      outputKind !== "architecture" &&
      outputKind !== "flowchart" &&
      outputKind !== "diagram"
    )
      throw new Error("The box-and-arrow sketch returned an unsupported visual kind.");
    const structuredTitle = `Structured ${outputKind}`;
    await expect(sourceSketch).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Select ${structuredTitle}` }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .getByLabel("Canvas coordinates")
        .getByText("Revision 5", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", {
          name: `Open activity drawer: Daniel created “${structuredTitle}”.`,
        })
        .getByText("R5 · typed", { exact: true }),
    ).toBeVisible();

    await exercisePreviewOnlyPacketWorkflow(page, roomId!);
    await exerciseFakeCameraLifecycle(page, cameraResponses);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    let cleanupError: unknown;
    try {
      if (roomId) await deleteHostedRoom(page, roomId);
    } catch (error) {
      cleanupError = error;
    } finally {
      await context.close();
    }
    if (cleanupError) throw cleanupError;
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

async function exercisePreviewOnlyPacketWorkflow(page: Page, roomId: string) {
  await openDrawer(
    page,
    "Open WebMCP agent activity",
    "WebMCP activity and CommandCanvas Live Voice drawer",
  );
  const prepareResponsePromise = waitForPacketResponse(
    page,
    `/api/rooms/${roomId}/packets/prepare`,
    "POST",
  );
  await page.getByRole("button", { name: "Prepare meeting packet" }).click();
  expect((await prepareResponsePromise).status()).toBe(201);
  await expect(page.getByText("Draft v1")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Recipient 1 name" })).toHaveValue(
    "Demo reviewer",
  );
  await expect(
    page.getByRole("textbox", { name: "Recipient 1 email" }),
  ).toHaveValue("reviewer@example.com");

  const approveResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/approve"),
  );
  await page.getByRole("button", { name: "Approve packet" }).click();
  expect((await approveResponsePromise).status()).toBe(200);
  await expect(page.getByText("Approved packet v1").first()).toBeVisible();

  const firstStageResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/stage-send"),
  );
  await page.getByRole("button", { name: "Request email send" }).click();
  expect((await firstStageResponse).status()).toBe(200);
  const sendDialog = page.getByRole("alertdialog", { name: "Send packet?" });
  await expect(sendDialog).toBeVisible();
  await expect(sendDialog.getByText("Approved packet v1")).toBeVisible();
  await expect(
    sendDialog.getByText("Demo reviewer <reviewer@example.com>"),
  ).toBeVisible();

  const cancelResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/cancel"),
  );
  await sendDialog.getByRole("button", { name: "Cancel packet send" }).click();
  const cancelled = await cancelResponse;
  expect(cancelled.status()).toBe(200);
  expect(await cancelled.json()).toMatchObject({
    ok: true,
    send: { status: "cancelled" },
  });
  await expect(
    page.getByText("Send request cancelled: no email was sent"),
  ).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
  await openDrawer(
    page,
    "Open WebMCP agent activity",
    "WebMCP activity and CommandCanvas Live Voice drawer",
  );
  await expect(page.getByText("Approved packet v1").first()).toBeVisible();
  await expect(
    page.getByText("Send request cancelled: no email was sent"),
  ).toBeVisible();

  const secondStageResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/stage-send"),
  );
  await page.getByRole("button", { name: "Request email send" }).click();
  expect((await secondStageResponse).status()).toBe(200);
  const restagedDialog = page.getByRole("alertdialog", {
    name: "Send packet?",
  });
  await expect(restagedDialog).toBeVisible();

  const executeResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/execute"),
  );
  await restagedDialog
    .getByRole("button", { name: "SEND", exact: true })
    .click();
  const executeResponse = await executeResponsePromise;
  expect(executeResponse.status()).toBe(200);
  expect(await executeResponse.json()).toMatchObject({
    ok: true,
    send: {
      mode: "preview_only",
      status: "preview_only",
      reason: "demo_room_preview_only",
      message: "Preview only: no email was sent.",
    },
  });
  await expect(page.getByText("Preview only: not sent")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
  await openDrawer(
    page,
    "Open WebMCP agent activity",
    "WebMCP activity and CommandCanvas Live Voice drawer",
  );
  await expect(page.getByText("Preview only: not sent")).toBeVisible();
  await expect(
    page
      .getByLabel("Canvas coordinates")
      .getByText("Revision 5", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Rough sketch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Select Structured (architecture|flowchart|diagram)$/ }),
  ).toBeVisible();
}

async function exerciseFakeCameraLifecycle(
  page: Page,
  cameraResponses: Array<{ url: string; status: number }>,
) {
  const commandDrawer = page.getByRole("complementary", {
    name: "WebMCP activity and CommandCanvas Live Voice drawer",
  });
  if (await commandDrawer.isVisible()) {
    await page
      .getByRole("button", { name: "Close WebMCP activity and CommandCanvas Live Voice drawer" })
      .click();
    await expect(commandDrawer).toBeHidden();
  }

  const handInputRegion = page.getByRole("region", {
    name: "Hand input",
    exact: true,
  });
  await handInputRegion
    .getByRole("button", { name: "Enable hand input" })
    .click();
  await expect(
    handInputRegion.getByText("Hand input ready · local only", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("READY · show one hand")).toBeVisible();
  await expect(page.getByLabel("Hand runtime diagnostics")).toContainText(
    "MediaPipe Hand Landmarker",
  );
  await page
    .getByRole("button", { name: "Show hand tracking details" })
    .click();
  await expect(
    page.locator(
      `[data-vision-engine="${MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID}"]`,
    ),
  ).toHaveText("Engine MediaPipe Hand Landmarker");
  await expect(
    page.getByText("Fallback MediaPipe Hand Landmarker (in-page recovery)"),
  ).toHaveCount(0);

  const liveTrack = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>(
      'video[aria-label="Local hand tracking preview"]',
    );
    const stream = video?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    if (!video || !stream || !track) return null;
    Object.defineProperty(window, "__commandCanvasFakeCameraTrack", {
      configurable: true,
      value: track,
    });
    return {
      srcAttached: video.srcObject === stream,
      kind: track.kind,
      readyState: track.readyState,
    };
  });
  expect(liveTrack).toEqual({
    srcAttached: true,
    kind: "video",
    readyState: "live",
  });

  expect(
    cameraResponses.some(
      ({ url, status }) =>
        new URL(url).pathname === "/workers/hand-landmarker.js" && status === 200,
    ),
  ).toBe(true);
  expect(
    cameraResponses.some(
      ({ url, status }) =>
        new URL(url).pathname.startsWith("/mediapipe/wasm/") &&
        url.endsWith(".wasm") &&
        status === 200,
    ),
  ).toBe(true);
  expect(
    cameraResponses.some(
      ({ url, status }) =>
        url.startsWith(MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL) && status === 200,
    ),
  ).toBe(true);

  await handInputRegion
    .getByRole("button", { name: "Disable hand input" })
    .click();
  await expect(
    handInputRegion.getByRole("button", { name: "Enable hand input" }),
  ).toBeVisible();
  const stoppedTrack = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>(
      'video[aria-label="Local hand tracking preview"]',
    );
    const track = (
      window as typeof window & {
        __commandCanvasFakeCameraTrack?: MediaStreamTrack;
      }
    ).__commandCanvasFakeCameraTrack;
    return {
      srcDetached: video?.srcObject === null,
      readyState: track?.readyState,
    };
  });
  expect(stoppedTrack).toEqual({
    srcDetached: true,
    readyState: "ended",
  });
}

function waitForPacketResponse(page: Page, pathname: string, method: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === pathname,
  );
}

function isHandEngineAsset(url: string) {
  return (
    url.includes("/workers/hand-landmarker.js") ||
    url.includes("/mediapipe/wasm/") ||
    url.startsWith(MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL)
  );
}

async function openDrawer(page: Page, triggerName: string, drawerName: string) {
  const trigger = page.getByRole("button", { name: triggerName });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await expect(
    page.getByRole("complementary", { name: drawerName }),
  ).toBeVisible();
}

declare global {
  interface Window {
    __commandCanvasFakeCameraTrack?: MediaStreamTrack;
  }
}
