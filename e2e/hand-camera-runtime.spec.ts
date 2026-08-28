import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { expect, test } from "@playwright/test";

import { YOLO_HAND_POSE_MODEL_URL } from "../lib/gesture/yolo-hand-pose-detector";

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
    if (
      url.includes("/workers/yolo-hand-pose.js") ||
      url.includes("/onnxruntime/") ||
      new URL(url).pathname === YOLO_HAND_POSE_MODEL_URL
    )
      cameraResponses.push({ url, status: response.status() });
  });

  try {
    await page.goto("/demo");
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();
    await page.getByRole("button", { name: "Open system status" }).click();
    await page.getByRole("button", { name: "Enable hand input" }).click();
    await expect(
      page.getByText("Hand input ready · local only").last(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("READY · show one hand")).toBeVisible();
    await expect(page.getByText("Engine YOLO26 Hand Pose")).toBeVisible();

    const viewport = page.viewportSize();
    const calibration = await page.locator(".camera-preview").boundingBox();
    if (!viewport || !calibration)
      throw new Error("Spatial calibration geometry is unavailable.");
    expect(calibration.height).toBeGreaterThanOrEqual(
      viewport.height * (testInfo.project.name === "chromium-mobile" ? 0.5 : 0.45),
    );
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
          new URL(url).pathname === "/workers/yolo-hand-pose.js" &&
          status === 200,
      ),
    ).toBe(true);
    expect(
      cameraResponses.some(({ url, status }) => url.endsWith(".wasm") && status === 200),
    ).toBe(true);
    expect(
      cameraResponses.some(
        ({ url, status }) =>
          new URL(url).pathname === YOLO_HAND_POSE_MODEL_URL &&
          status >= 200 &&
          status < 400,
      ),
    ).toBe(true);

    await page.getByRole("button", { name: "Start spatial mode" }).click();
    await expect(
      page.getByRole("complementary", { name: "System status drawer" }),
    ).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Hand interaction controls" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open system status" }).click();

    await page.getByRole("button", { name: "Disable hand input" }).click();
    await expect(page.getByText("Camera off · pointer active").last()).toBeVisible();
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
