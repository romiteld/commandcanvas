import { expect, test } from "@playwright/test";

test("keeps mobile calibration as a bounded sensor sheet above a visible canvas", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");
  await page.goto("/local", { waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: "Infinite canvas" }).waitFor();
  await page.getByRole("button", { name: "Open system status" }).waitFor();

  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".command-canvas-shell");
    const drawer = document.querySelector<HTMLElement>(".persistent-system-drawer");
    const camera = document.querySelector<HTMLElement>(".spatial-camera-control");
    if (!shell || !drawer || !camera)
      throw new Error("The hand calibration surface is missing.");
    shell.classList.add("is-system-open");
    drawer.classList.add("is-open");
    drawer.removeAttribute("inert");
    drawer.removeAttribute("aria-hidden");
    camera.classList.add("is-expanded");
  });

  const viewport = page.viewportSize();
  const canvas = await page.locator(".canvas-viewport").boundingBox();
  const drawer = await page.locator(".persistent-system-drawer").boundingBox();
  const camera = await page.locator(".camera-preview").boundingBox();
  if (!viewport || !canvas || !drawer || !camera)
    throw new Error("The mobile calibration geometry is unavailable.");

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    videoObjectFit: getComputedStyle(
      document.querySelector<HTMLVideoElement>(".camera-media-frame video")!,
    ).objectFit,
    boundaryCount: document.querySelectorAll(".camera-interaction-boundary").length,
  }));
  const uncoveredCanvasHeight = Math.max(0, drawer.y - canvas.y);

  expect(canvas.height).toBeGreaterThan(viewport.height * 0.55);
  expect(uncoveredCanvasHeight).toBeGreaterThan(viewport.height * 0.4);
  expect(drawer.height).toBeLessThanOrEqual(viewport.height * 0.5);
  expect(drawer.y).toBeGreaterThanOrEqual(viewport.height * 0.48);
  expect(camera.height).toBeLessThanOrEqual(viewport.height * 0.3);
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.videoObjectFit).toBe("contain");
  expect(geometry.boundaryCount).toBe(0);
  await expect(page.getByRole("region", { name: "Hand interaction controls" })).toBeHidden();
});
