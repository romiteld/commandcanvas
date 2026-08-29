import { expect, test } from "@playwright/test";

test.use({
  permissions: ["camera"],
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

test("uses full-canvas mobile calibration then returns to a bounded hideable PiP", async ({
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
  if (!viewport || !calibrationControl || !canvas || !camera)
    throw new Error("The mobile calibration geometry is unavailable.");

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    videoObjectFit: getComputedStyle(
      document.querySelector<HTMLVideoElement>(".camera-media-frame video")!,
    ).objectFit,
    boundaryCount: document.querySelectorAll(".camera-interaction-boundary").length,
  }));
  expect(calibrationControl.x).toBeCloseTo(canvas.x, 0);
  expect(calibrationControl.y).toBeCloseTo(canvas.y, 0);
  expect(calibrationControl.width).toBeCloseTo(canvas.width, 0);
  expect(calibrationControl.height).toBeCloseTo(canvas.height, 0);
  expect(camera.height).toBeGreaterThan(viewport.height * 0.45);
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.videoObjectFit).toBe("contain");
  expect(geometry.boundaryCount).toBe(0);
  await expect(page.getByRole("region", { name: "Hand interaction controls" })).toBeHidden();

  await page.getByRole("button", { name: "Skip hand calibration" }).click();
  const sensor = page.locator(".spatial-camera-control");
  await expect(sensor).toHaveClass(/is-sensor-pip/);
  const sensorBox = await sensor.boundingBox();
  if (!sensorBox) throw new Error("The hand sensor PiP geometry is unavailable.");
  expect(sensorBox.width).toBeLessThanOrEqual(300);
  expect(sensorBox.height).toBeLessThan(viewport.height * 0.55);
  await expect(page.getByRole("region", { name: "Hand interaction controls" })).toBeVisible();

  await page.getByRole("button", { name: "Hide hand sensor preview" }).click();
  await expect(sensor).toHaveClass(/is-sensor-pip-hidden/);
  await expect(page.getByLabel("Local hand tracking preview")).toBeHidden();
});
