import { expect, test, type Page } from "@playwright/test";

import { requireProductionApiProxyOrigin } from "../lib/testing/live-probe-guards";
import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";

test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    ...(process.env.COMMANDCANVAS_CHROME_PATH
      ? { executablePath: process.env.COMMANDCANVAS_CHROME_PATH }
      : {}),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("suspends mobile room overlays during hand calibration", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      testInfo.project.name !== "chromium-mobile",
  );
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiProxyIfConfigured(page);
  const roomCapture = captureCreatedRoom(page);
  let roomId: string | null = null;

  try {
    await page.goto("/demo", { waitUntil: "domcontentloaded" });
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();

    await page
      .getByRole("button", { name: "Start camera and microphone" })
      .click();
    await expect(page.getByTestId("local-meeting-video")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Enable hand input" }).click();
    const calibration = page.locator(
      ".spatial-camera-control.is-calibrating-full-canvas",
    );
    await expect(calibration).toBeVisible({ timeout: 60_000 });

    await expect(
      page.locator(".meeting-media-slot"),
      "The calibration preview replaces the duplicate meeting-video surface.",
    ).toBeHidden();
    await expect(
      page.locator(".tool-dock"),
      "The modal calibration surface must not leave clickable tools behind it.",
    ).toBeHidden();
    await expect(
      page.locator(".persistent-system-drawer"),
      "The calibration surface replaces the system drawer while it is active.",
    ).toBeHidden();
    await expect(
      page.locator(".chatgpt-command-pill"),
      "Agent controls must not remain clickable behind calibration.",
    ).toBeHidden();
    await expect(page.locator(".room-header")).toBeVisible();

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 844, height: 390 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(calibration).toBeVisible();
      await expect(page.locator(".meeting-media-slot")).toBeHidden();
      await expect(page.locator(".tool-dock")).toBeHidden();
      await expect(page.locator(".chatgpt-command-pill")).toBeHidden();
      const bounds = await calibration.boundingBox();
      if (!bounds)
        throw new Error(
          `Calibration geometry is unavailable at ${viewport.width}x${viewport.height}.`,
        );
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Skip hand calibration" }).click();
    await expect(page.locator(".meeting-media-slot")).toBeVisible();
    await expect(page.locator(".tool-dock")).toBeVisible();
    await expect(page.locator(".chatgpt-command-pill")).toBeVisible();
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

async function installApiProxyIfConfigured(page: Page) {
  const proxyOrigin = process.env.COMMANDCANVAS_API_PROXY_ORIGIN;
  if (!proxyOrigin) return;
  const targetOrigin = requireProductionApiProxyOrigin(proxyOrigin);
  await page.route("**/api/**", async (route) => {
    const source = new URL(route.request().url());
    if (
      source.pathname !== "/api/rooms" &&
      !/^\/api\/rooms\/[0-9a-f-]{36}(?:\/commands|\/media\/(?:roster|turn))?$/.test(
        source.pathname,
      )
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    const response = await route.fetch({
      url: `${targetOrigin}${source.pathname}${source.search}`,
    });
    await route.fulfill({ response });
  });
}

test("uses a large mobile calibration surface then returns to a hideable PiP", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/local", { waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: "Infinite canvas" }).waitFor();

  const compactControl = await page.locator(".spatial-camera-control").boundingBox();
  if (!compactControl) throw new Error("The compact hand control is missing.");
  expect(compactControl.height).toBeLessThanOrEqual(64);

  await page.getByRole("button", { name: "Enable hand input" }).click();
  await expect(page.locator(".spatial-camera-control")).toHaveClass(
    /is-calibrating-full-canvas/,
    { timeout: 60_000 },
  );

  const viewport = page.viewportSize();
  const calibrationControl = await page
    .locator(".spatial-camera-control")
    .boundingBox();
  const canvas = await page.locator(".canvas-viewport").boundingBox();
  const camera = await page.locator(".camera-preview").boundingBox();
  const mediaFrame = await page.locator(".camera-media-frame").boundingBox();
  const overlay = await page.locator(".camera-keypoint-overlay").boundingBox();
  if (!viewport || !calibrationControl || !canvas || !camera || !mediaFrame || !overlay)
    throw new Error("The mobile calibration geometry is unavailable.");

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    videoObjectFit: getComputedStyle(
      document.querySelector<HTMLVideoElement>(".camera-media-frame video")!,
    ).objectFit,
    intrinsicVideoAspect: (() => {
      const video = document.querySelector<HTMLVideoElement>(
        ".camera-media-frame video",
      )!;
      return video.videoWidth / video.videoHeight;
    })(),
    boundaryCount: document.querySelectorAll(".camera-interaction-boundary").length,
  }));
  expect(calibrationControl.width).toBeLessThanOrEqual(viewport.width * 0.98);
  expect(calibrationControl.height).toBeGreaterThan(viewport.height * 0.65);
  expect(calibrationControl.height).toBeLessThanOrEqual(viewport.height * 0.8);
  expect(Math.max(0, calibrationControl.y - canvas.y)).toBeGreaterThan(
    viewport.height * 0.13,
  );
  expect(calibrationControl.y + calibrationControl.height).toBeLessThanOrEqual(
    canvas.y + canvas.height,
  );
  expect(camera.height).toBeGreaterThan(viewport.height * 0.35);
  expect(camera.height).toBeLessThanOrEqual(viewport.height * 0.52);
  expect(Math.abs(mediaFrame.width / mediaFrame.height - geometry.intrinsicVideoAspect)).toBeLessThan(0.03);
  expect(overlay).toEqual(mediaFrame);
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.videoObjectFit).toBe("contain");
  expect(geometry.boundaryCount).toBe(0);
  await expect(page.getByText(/1 of 5 · scanning open hand/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to reach mapping" }),
  ).toBeDisabled();
  await expect(page.getByRole("region", { name: "Hand interaction controls" })).toBeHidden();

  for (const size of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    const responsiveControl = await page
      .locator(".spatial-camera-control")
      .boundingBox();
    const responsiveCamera = await page.locator(".camera-preview").boundingBox();
    if (!responsiveControl || !responsiveCamera)
      throw new Error(`Calibration geometry missing at ${size.width}x${size.height}.`);
    const responsiveGeometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      responsiveGeometry.scrollWidth,
      `${size.width}x${size.height} horizontal overflow`,
    ).toBe(responsiveGeometry.clientWidth);
    expect(responsiveControl.x).toBeGreaterThanOrEqual(0);
    expect(responsiveControl.y).toBeGreaterThanOrEqual(0);
    expect(responsiveControl.x + responsiveControl.width).toBeLessThanOrEqual(
      size.width,
    );
    expect(responsiveControl.y + responsiveControl.height).toBeLessThanOrEqual(
      size.height,
    );
    expect(responsiveCamera.height).toBeGreaterThanOrEqual(
      Math.min(220, size.height * 0.42),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Skip hand calibration" }).click();
  await expect(
    page.getByText(
      "Default controls · calibration skipped · drawing clutch provisional",
    ),
  ).toHaveCount(1);
  await expect(
    page.getByText(/Calibrated for this camera session/),
  ).toHaveCount(0);
  const sensor = page.locator(".spatial-camera-control");
  await expect(sensor).toHaveClass(/is-sensor-pip/);
  await expect(sensor).not.toHaveClass(/is-sensor-pip-hidden/);
  const sensorBox = await sensor.boundingBox();
  if (!sensorBox) throw new Error("The hand sensor PiP geometry is unavailable.");
  expect(sensorBox.width).toBeLessThanOrEqual(300);
  expect(sensorBox.height).toBeLessThan(viewport.height * 0.55);
  await expect(page.getByRole("region", { name: "Hand interaction controls" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 568 });
  await page
    .getByRole("button", { name: "Draw with index finger" })
    .click();
  const drawToolbar = page.getByRole("region", {
    name: "Hand interaction controls",
  });
  await expect(
    page.getByText(
      "Index aims · touch thumb + middle to draw · separate to lift",
    ),
  ).toBeVisible();
  const drawToolbarBounds = await drawToolbar.boundingBox();
  const drawViewport = page.viewportSize();
  if (!drawToolbarBounds || !drawViewport)
    throw new Error("The compact Draw toolbar geometry is unavailable.");
  expect(drawToolbarBounds.x).toBeGreaterThanOrEqual(0);
  expect(drawToolbarBounds.y).toBeGreaterThanOrEqual(0);
  expect(drawToolbarBounds.x + drawToolbarBounds.width).toBeLessThanOrEqual(
    drawViewport.width,
  );
  expect(drawToolbarBounds.y + drawToolbarBounds.height).toBeLessThanOrEqual(
    drawViewport.height,
  );
  const drawGeometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(drawGeometry.scrollWidth).toBe(drawGeometry.clientWidth);
  await page.getByRole("button", { name: "Cancel hand sketch" }).click();

  const hideControl = await sensor
    .getByRole("button", { name: "Hide hand sensor preview" })
    .boundingBox();
  if (!hideControl) throw new Error("Hide hand sensor preview geometry is unavailable.");
  expect(hideControl.width).toBeGreaterThanOrEqual(44);
  expect(hideControl.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Hide hand sensor preview" }).click();
  await expect(sensor).toHaveClass(/is-sensor-pip-hidden/);
  const showControl = await sensor
    .getByRole("button", { name: "Show hand sensor preview" })
    .boundingBox();
  if (!showControl) throw new Error("Show hand sensor preview geometry is unavailable.");
  expect(showControl.width).toBeGreaterThanOrEqual(44);
  expect(showControl.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Show hand sensor preview" }).click();
  await expect(sensor).not.toHaveClass(/is-sensor-pip-hidden/);
  await expect(
    page.getByText(
      "Default controls · calibration skipped · drawing clutch provisional",
    ),
  ).toBeVisible();
  for (const accessibleName of [
    "Move hand sensor preview",
    "Hide hand sensor preview",
    "Open hand calibration",
    "Disable hand input",
  ]) {
    const target = await sensor
      .getByRole("button", { name: accessibleName })
      .boundingBox();
    if (!target) throw new Error(`${accessibleName} geometry is unavailable.`);
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "Hide hand sensor preview" }).click();
  await expect(sensor).toHaveClass(/is-sensor-pip-hidden/);
});

test("recovers active mobile hand input after the page returns to the foreground", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/local", { waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: "Infinite canvas" }).waitFor();

  const handInput = page.getByRole("region", {
    name: "Hand input",
    exact: true,
  });
  await handInput
    .getByRole("button", { name: "Enable hand input" })
    .click();
  await expect(
    handInput.getByText("Hand input ready · local only", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await handInput
    .getByRole("button", { name: "Skip hand calibration" })
    .click();
  await expect(handInput).toHaveClass(/is-sensor-pip/);
  await expect(handInput).not.toHaveClass(/is-sensor-pip-hidden/);

  await page.evaluate(() => {
    const state = { value: "visible" as DocumentVisibilityState };
    Object.defineProperty(window, "__commandCanvasTestVisibility", {
      configurable: true,
      value: state,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state.value,
    });
    state.value = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    handInput.getByRole("button", { name: "Enable hand input" }),
  ).toBeVisible();

  await page.evaluate(() => {
    const state = (
      window as typeof window & {
        __commandCanvasTestVisibility: { value: DocumentVisibilityState };
      }
    ).__commandCanvasTestVisibility;
    state.value = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });

  await expect(
    handInput.getByText("Hand input ready · local only", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    handInput.getByRole("button", { name: "Disable hand input" }),
  ).toBeVisible();
  await expect(handInput).not.toHaveClass(/is-sensor-pip-hidden/);
});

test("keeps desktop calibration bounded over a visible canvas", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/local", { waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: "Infinite canvas" }).waitFor();

  await page.getByRole("button", { name: "Enable hand input" }).click();
  const handControl = page.locator(".spatial-camera-control");
  await expect(handControl).toHaveClass(/is-calibrating-full-canvas/, {
    timeout: 60_000,
  });

  const viewport = page.viewportSize();
  const calibrationBounds = await handControl.boundingBox();
  const cameraBounds = await page.locator(".camera-preview").boundingBox();
  const canvasBounds = await page.locator(".canvas-viewport").boundingBox();
  if (!viewport || !calibrationBounds || !cameraBounds || !canvasBounds)
    throw new Error("The desktop calibration geometry is unavailable.");

  expect(calibrationBounds.width).toBeLessThanOrEqual(viewport.width * 0.68);
  expect(calibrationBounds.height).toBeLessThanOrEqual(viewport.height * 0.72);
  expect(Math.max(0, calibrationBounds.y - canvasBounds.y)).toBeGreaterThan(
    viewport.height * 0.18,
  );
  expect(cameraBounds.height).toBeGreaterThan(viewport.height * 0.35);
  expect(cameraBounds.height).toBeLessThanOrEqual(viewport.height * 0.55);

  await page.getByRole("button", { name: "Skip hand calibration" }).click();
  await expect(handControl).toHaveClass(/is-sensor-pip/);
  await expect(
    page.getByRole("region", { name: "Hand interaction controls" }),
  ).toBeVisible();
});
