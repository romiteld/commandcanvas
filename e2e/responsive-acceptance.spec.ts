import { expect, test, type Locator, type Page } from "@playwright/test";

const supportedViewports = [
  { width: 320, height: 568, label: "320x568" },
  { width: 390, height: 844, label: "390x844" },
  { width: 430, height: 932, label: "430x932" },
  { width: 768, height: 1024, label: "768x1024" },
  { width: 844, height: 390, label: "844x390 landscape" },
  { width: 1024, height: 768, label: "1024x768" },
  { width: 1280, height: 720, label: "1280x720" },
  { width: 1440, height: 900, label: "1440x900" },
] as const;

for (const viewport of supportedViewports) {
  test(`${viewport.label} keeps the public entry and canvas controls usable`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop");
    await page.setViewportSize(viewport);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const workspaceCta = page
      .getByRole("link", { name: "Open CommandCanvas" })
      .first();
    await expect(workspaceCta).toBeVisible();
    await expectInViewport(workspaceCta, viewport);
    await expectNoHorizontalOverflow(page, viewport.label);

    await page.goto("/local", { waitUntil: "domcontentloaded" });
    const shell = page.getByRole("main", { name: "Spatial command surface" });
    const canvas = page.getByRole("region", { name: "Infinite canvas" });
    await expect(shell).toBeVisible();
    await expect(canvas).toBeVisible();
    await expectViewportShell(page, shell, viewport);

    const dock = page.getByRole("complementary", { name: "Object tools" });
    const commandTrigger = page.getByRole("button", {
      name: "Open ChatGPT Site Tools and activity drawer",
    });
    const systemTrigger = page.getByRole("button", { name: "Open system status" });
    const activityTrigger = page.getByRole("button", {
      name: "Open activity drawer",
      exact: true,
    });
    for (const control of [dock, commandTrigger, systemTrigger, activityTrigger])
      await expectInViewport(control, viewport);
    await expectNoOverlap(dock, commandTrigger, `${viewport.label} dock/ChatGPT`);

    const primaryDockButtons = dock.locator(".tool-dock-primary > button");
    await expect(primaryDockButtons).toHaveCount(5);
    for (let index = 0; index < 5; index += 1)
      await expectMinimumTarget(primaryDockButtons.nth(index), 44, viewport.label);
    await expectMinimumTarget(commandTrigger, 44, viewport.label);

    await page.getByRole("button", { name: "Open create menu" }).click();
    const createNote = page.getByRole("button", { name: "Create note" });
    await expect(createNote).toBeVisible();
    await expectInViewport(createNote, viewport);
    await createNote.click();
    await expect(page.getByRole("button", { name: "Select New thought" })).toBeVisible();

    const canvasBefore = await requiredBox(canvas, `${viewport.label} canvas`);
    await commandTrigger.click();
    await expect(
      page.getByRole("complementary", { name: "ChatGPT command drawer" }),
    ).toBeVisible();
    expectBoxClose(
      await requiredBox(canvas, `${viewport.label} command-drawer canvas`),
      canvasBefore,
      `${viewport.label} command drawer`,
    );
    await page.getByRole("button", { name: "Close ChatGPT command drawer" }).click();

    await systemTrigger.click();
    await expect(
      page.getByRole("complementary", { name: "System status drawer" }),
    ).toBeVisible();
    expectBoxClose(
      await requiredBox(canvas, `${viewport.label} system-drawer canvas`),
      canvasBefore,
      `${viewport.label} system drawer`,
    );
    await expectViewportShell(page, shell, viewport);

    if (viewport.width === 844 && viewport.height === 390) {
      const canvasBox = await requiredBox(canvas, "844x390 landscape canvas");
      expect(canvasBox.height, "844x390 landscape canvas height").toBeGreaterThan(220);
      await expectInViewport(
        page.getByRole("button", { name: "Close system status drawer" }),
        viewport,
      );
    }
  });
}

test("covers the compact-control breakpoint edges", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  for (const width of [481, 568, 767]) {
    const viewport = { width, height: 844 };
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectNoHorizontalOverflow(page, `${width}px landing probe`);
    await expectInViewport(
      page.getByRole("link", { name: "Open CommandCanvas" }).first(),
      viewport,
    );

    await page.goto("/local", { waitUntil: "domcontentloaded" });
    await expectViewportShell(
      page,
      page.getByRole("main", { name: "Spatial command surface" }),
      viewport,
    );
    await expectInViewport(
      page.getByRole("complementary", { name: "Object tools" }),
      viewport,
    );
  }
});

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth, `${label} horizontal overflow`).toBeLessThanOrEqual(
    geometry.clientWidth + 1,
  );
}

async function expectViewportShell(
  page: Page,
  shell: Locator,
  viewport: { width: number; height: number },
) {
  const geometry = await page.evaluate(() => ({
    bodyScrollHeight: document.body.scrollHeight,
    documentScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));
  const shellBox = await requiredBox(shell, "workspace shell");
  expect(Math.abs(shellBox.height - viewport.height), "workspace shell height").toBeLessThanOrEqual(1);
  expect(shellBox.x, "workspace shell left edge").toBeGreaterThanOrEqual(0);
  expect(shellBox.x + shellBox.width, "workspace shell right edge").toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(geometry.documentScrollHeight, "document height").toBeLessThanOrEqual(
    geometry.innerHeight + 1,
  );
  expect(geometry.bodyScrollHeight, "body height").toBeLessThanOrEqual(
    geometry.innerHeight + 1,
  );
  expect({ x: geometry.scrollX, y: geometry.scrollY }).toEqual({ x: 0, y: 0 });
  await expectNoHorizontalOverflow(page, `${viewport.width}x${viewport.height} workspace`);
}

async function expectInViewport(
  locator: Locator,
  viewport: { width: number; height: number },
) {
  await expect(locator).toBeVisible();
  const box = await requiredBox(locator, "persistent control");
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectMinimumTarget(locator: Locator, minimum: number, label: string) {
  const box = await requiredBox(locator, `${label} touch target`);
  expect(box.width, `${label} touch target width`).toBeGreaterThanOrEqual(minimum);
  expect(box.height, `${label} touch target height`).toBeGreaterThanOrEqual(minimum);
}

async function expectNoOverlap(first: Locator, second: Locator, label: string) {
  const a = await requiredBox(first, `${label} first control`);
  const b = await requiredBox(second, `${label} second control`);
  const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  expect(overlapWidth * overlapHeight, `${label} overlap area`).toBe(0);
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} has no browser geometry.`);
  return box;
}

function expectBoxClose(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
  label: string,
) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key}`).toBeLessThanOrEqual(1);
}
