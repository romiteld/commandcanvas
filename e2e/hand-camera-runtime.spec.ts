import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { expect, test } from "@playwright/test";

import {
  MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
} from "../lib/gesture/spatial-vision-engine";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";

const fakeCameraPath = process.env.COMMANDCANVAS_FAKE_CAMERA_PATH;

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

test("starts the local hand detector from a real browser camera stream and releases it", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_CAMERA_E2E !== "true" ||
      !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name),
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

  const roomCapture = captureCreatedRoom(page);
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
      viewport.height * (testInfo.project.name === "chromium-mobile" ? 0.3 : 0.55),
    );
    if (testInfo.project.name === "chromium-mobile") {
      expect(calibrationBounds.height).toBeLessThanOrEqual(viewport.height * 0.5);
      expect(calibrationBounds.width).toBeLessThanOrEqual(viewport.width * 0.98);
      expect(Math.max(0, calibrationBounds.y - canvas.y)).toBeGreaterThan(
        viewport.height * 0.4,
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

    await page.getByRole("button", { name: "Skip hand calibration" }).click();
    await expect(
      page.getByRole("complementary", { name: "System status drawer" }),
    ).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Hand interaction controls" }),
    ).toBeVisible();

    await handInput
      .getByRole("button", { name: "Disable hand input" })
      .click();
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
