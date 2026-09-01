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
  await expect(page.getByText(/1 of 4 · scanning open hand/i)).toBeVisible();
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
  await expect(page.getByText("Default controls · calibration skipped")).toHaveCount(1);
  await expect(page.getByText("Calibrated for this camera session")).toHaveCount(0);
  const sensor = page.locator(".spatial-camera-control");
  await expect(sensor).toHaveClass(/is-sensor-pip/);
  await expect(sensor).toHaveClass(/is-sensor-pip-hidden/);
  const sensorBox = await sensor.boundingBox();
  if (!sensorBox) throw new Error("The hand sensor PiP geometry is unavailable.");
  expect(sensorBox.width).toBeLessThanOrEqual(300);
  expect(sensorBox.height).toBeLessThan(viewport.height * 0.55);
  await expect(page.getByRole("region", { name: "Hand interaction controls" })).toBeVisible();

  const showControl = await sensor
    .getByRole("button", { name: "Show hand sensor preview" })
    .boundingBox();
  if (!showControl) throw new Error("Show hand sensor preview geometry is unavailable.");
  expect(showControl.width).toBeGreaterThanOrEqual(44);
  expect(showControl.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Show hand sensor preview" }).click();
  await expect(sensor).not.toHaveClass(/is-sensor-pip-hidden/);
  await expect(page.getByText("Default controls · calibration skipped")).toBeVisible();
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
