import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
} from "../lib/gesture/spatial-vision-engine";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";
import { requireProductionApiProxyOrigin } from "../lib/testing/live-probe-guards";

const fakeCameraPath = process.env.COMMANDCANVAS_FAKE_CAMERA_PATH;
const assertRecordedHandDetection =
  process.env.ASSERT_RECORDED_HAND_DETECTION === "true";
const assertRecordedHandGestures =
  process.env.ASSERT_RECORDED_HAND_GESTURES === "true";
const assertRecordedHandCalibration =
  process.env.ASSERT_RECORDED_HAND_CALIBRATION === "true";
const expectedFakeCameraSha256 =
  process.env.COMMANDCANVAS_FAKE_CAMERA_SHA256?.toLowerCase();

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

test.use({
  permissions: ["camera"],
  launchOptions: fakeCameraPath
    ? {
        args: [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-video-capture=${fakeCameraPath}`,
        ],
      }
    : undefined,
});

test("processes a recorded human-hand MediaStream with the local detector and releases it", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_CAMERA_E2E !== "true" ||
      !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name),
  );
  test.setTimeout(150_000);
  if (
    !fakeCameraPath ||
    !isAbsolute(fakeCameraPath) ||
    !fakeCameraPath.endsWith(".y4m") ||
    !existsSync(fakeCameraPath)
  )
    throw new Error(
      "COMMANDCANVAS_FAKE_CAMERA_PATH must name an existing absolute .y4m fixture.",
    );
  if (
    (assertRecordedHandDetection ||
      assertRecordedHandGestures ||
      assertRecordedHandCalibration) &&
    !expectedFakeCameraSha256
  )
    throw new Error(
      "COMMANDCANVAS_FAKE_CAMERA_SHA256 is required for recorded-hand acceptance.",
    );
  if (expectedFakeCameraSha256) {
    const actualSha256 = await sha256File(fakeCameraPath);
    if (actualSha256 !== expectedFakeCameraSha256)
      throw new Error(
        `Recorded-hand fixture SHA-256 mismatch: expected ${expectedFakeCameraSha256}, received ${actualSha256}.`,
      );
  }

  const roomCapture = captureCreatedRoom(page);
  await installApiProxyIfConfigured(page);
  const pageErrors: string[] = [];
  const cameraResponses: Array<{ url: string; status: number }> = [];
  let roomId: string | null = null;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = response.url();
    if (isMediaPipeHandEngineAsset(url))
      cameraResponses.push({ url, status: response.status() });
  });

  try {
    await page.goto("/demo");
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();
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
    if (!assertRecordedHandDetection)
      await expect(page.getByText("READY · show one hand")).toBeVisible();
    await expect(
      page.getByLabel("Hand runtime diagnostics"),
    ).toContainText("MediaPipe Hand Landmarker");

    await expect(
      page.getByRole("complementary", { name: "System status drawer" }),
    ).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Hand interaction controls" }),
    ).toBeHidden();
    if (!(await page.locator(".camera-preview").isVisible()))
      await page.getByRole("button", { name: "Open hand calibration" }).click();

    const calibrationSurface = page.locator(
      ".spatial-camera-control.is-calibrating-full-canvas",
    );
    await expect(calibrationSurface).toBeVisible();
    const viewport = page.viewportSize();
    const calibration = await page.locator(".camera-preview").boundingBox();
    const calibrationBounds = await calibrationSurface.boundingBox();
    const canvas = await page.locator(".canvas-viewport").boundingBox();
    if (!viewport || !calibration || !calibrationBounds || !canvas)
      throw new Error("Spatial calibration geometry is unavailable.");
    expect(calibration.height).toBeLessThanOrEqual(
      viewport.height * (testInfo.project.name === "chromium-mobile" ? 0.52 : 0.55),
    );
    if (testInfo.project.name === "chromium-mobile") {
      expect(calibrationBounds.height).toBeGreaterThan(viewport.height * 0.65);
      expect(calibrationBounds.height).toBeLessThanOrEqual(viewport.height * 0.8);
      expect(calibrationBounds.width).toBeLessThanOrEqual(viewport.width * 0.98);
      expect(Math.max(0, calibrationBounds.y - canvas.y)).toBeGreaterThan(
        viewport.height * 0.13,
      );
    } else {
      expect(calibrationBounds.height).toBeLessThanOrEqual(
        viewport.height * 0.72,
      );
      expect(calibrationBounds.width).toBeLessThanOrEqual(
        viewport.width * 0.68,
      );
      expect(Math.max(0, calibrationBounds.y - canvas.y)).toBeGreaterThan(
        viewport.height * 0.18,
      );
    }
    expect(
      await page
        .getByLabel("Local hand tracking preview")
        .evaluate((video) => getComputedStyle(video).objectFit),
    ).toBe("contain");

    const liveTrack = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>(
        'video[aria-label="Local hand tracking preview"]',
      );
      const stream = video?.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks()[0];
      if (!video || !stream || !track) return null;
      Object.defineProperty(window, "__commandCanvasCameraTrack", {
        configurable: true,
        value: track,
      });
      return {
        attached: video.srcObject === stream,
        kind: track.kind,
        readyState: track.readyState,
      };
    });
    expect(liveTrack).toEqual({
      attached: true,
      kind: "video",
      readyState: "live",
    });
    expect(
      cameraResponses.some(
        ({ url, status }) =>
          new URL(url).pathname === "/workers/hand-landmarker.js" &&
          status === 200,
      ),
    ).toBe(true);
    expect(
      cameraResponses.some(({ url, status }) => url.endsWith(".wasm") && status === 200),
    ).toBe(true);
    expect(
      cameraResponses.some(
        ({ url, status }) =>
          url.startsWith(MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL) &&
          status >= 200 &&
          status < 400,
      ),
    ).toBe(true);

    if (assertRecordedHandDetection) {
      await expect(page.locator("[data-hand-skeleton]")).toHaveCount(1, {
        timeout: 30_000,
      });
      await expect(page.locator("[data-hand-keypoint]")).toHaveCount(21);
      await expect(page.locator("[data-tracked-hand-pointer]")).toHaveCount(1);
      await expect(page.locator(".camera-preview-label")).toContainText(
        "TRACKED",
      );
      const calibrationProgress = page.locator(
        "[data-calibration-baseline-count]",
      );
      await expect
        .poll(
          async () =>
            Number(
              await calibrationProgress.getAttribute(
                "data-calibration-baseline-count",
              ),
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    }

    if (assertRecordedHandCalibration) {
      const continueToReach = page.getByRole("button", {
        name: "Continue to reach mapping",
      });
      await expect(continueToReach).toBeEnabled({ timeout: 30_000 });
      await continueToReach.click();
      const continueToOpen = page.getByRole("button", {
        name: "Continue to open hand",
      });
      await expect(continueToOpen).toBeEnabled({ timeout: 30_000 });
      await continueToOpen.click();
      const continueToClosed = page.getByRole("button", {
        name: "Continue to closed pinch",
      });
      await expect(continueToClosed).toBeEnabled({ timeout: 30_000 });
      await continueToClosed.click();
      const reviewCalibration = page.getByRole("button", {
        name: "Review hand calibration",
      });
      await expect(reviewCalibration).toBeEnabled({ timeout: 30_000 });
      await reviewCalibration.click();
      await page
        .getByRole("button", { name: "Use hand calibration" })
        .click();
      await expect(
        handInput.getByText("Calibrated for this camera session", {
          exact: true,
        }),
      ).toHaveText("Calibrated for this camera session");
      await expect(handInput.getByRole("alert")).toHaveCount(0);
    } else {
      await page.getByRole("button", { name: "Skip hand calibration" }).click();
    }
    await expect(
      page.getByRole("complementary", { name: "System status drawer" }),
    ).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Hand interaction controls" }),
    ).toBeVisible();

    if (assertRecordedHandGestures) {
      if (!(await page.locator(".camera-preview").isVisible()))
        await handInput
          .getByRole("button", { name: "Show hand sensor preview" })
          .click();
      const observedLabels = await page.evaluate(async () => {
        const maximumConsecutive: Record<string, number> = {};
        let previousKind = "";
        let consecutive = 0;
        const deadline = performance.now() + 20_000;
        while (performance.now() < deadline) {
          const label = document
            .querySelector(".camera-preview-label")
            ?.textContent?.trim();
          const kind = label?.split(" ·", 1)[0] ?? "";
          if (kind && kind === previousKind) consecutive += 1;
          else {
            previousKind = kind;
            consecutive = kind ? 1 : 0;
          }
          if (kind)
            maximumConsecutive[kind] = Math.max(
              maximumConsecutive[kind] ?? 0,
              consecutive,
            );
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return maximumConsecutive;
      });
      expect(observedLabels.OPEN ?? 0).toBeGreaterThanOrEqual(3);
      expect(observedLabels.POINT ?? 0).toBeGreaterThanOrEqual(3);
      expect(observedLabels.PINCH ?? 0).toBeGreaterThanOrEqual(3);
    }

    const disableHandInput = handInput.getByRole("button", {
      name: "Disable hand input",
    });
    if (!(await disableHandInput.isVisible())) {
      await handInput
        .getByRole("button", { name: "Show hand sensor preview" })
        .click();
    }
    await disableHandInput.click();
    await expect(
      handInput.getByRole("button", { name: "Enable hand input" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>(
          'video[aria-label="Local hand tracking preview"]',
        );
        const track = (
          window as typeof window & {
            __commandCanvasCameraTrack?: MediaStreamTrack;
          }
        ).__commandCanvasCameraTrack;
        return {
          detached: video?.srcObject === null,
          readyState: track?.readyState,
        };
      }),
    ).toEqual({ detached: true, readyState: "ended" });
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

test("starts the in-page MediaPipe recovery with classic WASM assets", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_CAMERA_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );
  test.setTimeout(90_000);
  if (
    !fakeCameraPath ||
    !isAbsolute(fakeCameraPath) ||
    !fakeCameraPath.endsWith(".y4m") ||
    !existsSync(fakeCameraPath)
  )
    throw new Error(
      "COMMANDCANVAS_FAKE_CAMERA_PATH must name an existing absolute .y4m fixture.",
    );

  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "OffscreenCanvas", {
      configurable: true,
      value: undefined,
    });
  });
  const roomCapture = captureCreatedRoom(page);
  await installApiProxyIfConfigured(page);
  const pageErrors: string[] = [];
  const wasmScripts: string[] = [];
  let roomId: string | null = null;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.includes("/mediapipe/wasm/") && path.endsWith(".js"))
      wasmScripts.push(path);
  });

  try {
    await page.goto("/demo");
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();
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

    expect(
      wasmScripts.some((path) =>
        /vision_wasm_(?:nosimd_)?internal\.js$/.test(path),
      ),
    ).toBe(true);
    expect(
      wasmScripts.some((path) => path.endsWith("vision_wasm_module_internal.js")),
    ).toBe(false);
    expect(pageErrors).toEqual([]);

    await handInput
      .getByRole("button", { name: "Disable hand input" })
      .click();
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

function isMediaPipeHandEngineAsset(url: string) {
  return (
    url.includes("/workers/hand-landmarker.js") ||
    url.includes("/mediapipe/wasm/") ||
    url.startsWith(MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL)
  );
}

async function installApiProxyIfConfigured(page: Page) {
  const proxyOrigin = process.env.COMMANDCANVAS_API_PROXY_ORIGIN;
  if (!proxyOrigin) return;
  const targetOrigin = requireProductionApiProxyOrigin(proxyOrigin);
  await page.route("**/api/**", async (route) => {
    const source = new URL(route.request().url());
    if (!isCameraProbeApiPath(source.pathname)) {
      await route.abort("blockedbyclient");
      return;
    }
    const response = await route.fetch({
      url: `${targetOrigin}${source.pathname}${source.search}`,
    });
    await route.fulfill({ response });
  });
}

function isCameraProbeApiPath(pathname: string) {
  return (
    pathname === "/api/rooms" ||
    /^\/api\/rooms\/[0-9a-f-]{36}(?:\/commands)?$/.test(pathname)
  );
}
