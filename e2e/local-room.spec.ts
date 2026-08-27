import { expect, test } from "@playwright/test";

test("creates, pins, and undoes one semantic object with visible receipts", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");

  await expect(page).toHaveTitle(/CommandCanvas/);
  await expect(
    page.getByRole("heading", { name: "Spatial command surface" }),
  ).toBeVisible();
  await expect(page.getByText("WebMCP not exercised")).toBeVisible();
  await expect(page.getByText("Realtime not connected")).toBeVisible();

  await page.getByRole("button", { name: "Create note" }).click();
  await page.getByRole("button", { name: "Select New thought" }).click();
  await expect(page.getByText("Danny created “New thought”.")).toBeVisible();

  await page.getByRole("button", { name: "Pin object" }).click();
  await expect(page.getByText("Pinned to canvas")).toBeVisible();

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.getByText("Pinned to canvas")).toBeHidden();
  await expect(page.getByText(/Danny undid: Danny pinned/)).toBeVisible();

  if (testInfo.project.name === "chromium-desktop")
    await page.screenshot({
      path: "/tmp/commandcanvas-checkpoint-1-desktop.png",
      fullPage: true,
    });

  expect(browserErrors).toEqual([]);
});

test("keeps the canvas and primary action usable at a mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Infinite canvas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create note" })).toBeVisible();

  await page.getByRole("button", { name: "Create note" }).click();

  await expect(
    page.getByRole("button", { name: "Select New thought" }),
  ).toBeVisible();
  await expect(page.getByText("Danny created “New thought”.")).toBeVisible();
});

test("creates semantic project-board and schedule objects from the toolbar", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Create task board" }).click();
  await expect(
    page.getByRole("button", { name: "Select Launch board" }),
  ).toBeVisible();
  await expect(page.getByText("Confirm launch date")).toBeVisible();
  await expect(page.getByText("Polish the demo path")).toBeVisible();

  await page.getByRole("button", { name: "Create schedule" }).click();
  await expect(
    page.getByRole("button", { name: "Select Next week" }),
  ).toBeVisible();
  await expect(page.getByText("Review WebMCP flow")).toBeVisible();
  await expect(page.getByText("America/New_York")).toBeVisible();
  await expect(page.getByText("Revision 2")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(2);

  expect(browserErrors).toEqual([]);
});

test("commits exactly one canonical transform when a pointer drag ends", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/");
  await page.getByRole("button", { name: "Create note" }).click();
  const object = page.getByRole("button", { name: "Select New thought" });
  const before = await object.boundingBox();
  if (!before) throw new Error("object has no browser geometry");

  await page.mouse.move(before.x + 90, before.y + 45);
  await page.mouse.down();
  await page.mouse.move(before.x + 230, before.y + 125, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByText("Danny transformed “New thought” spatially.")).toBeVisible();
  await expect(page.getByText("Revision 2")).toBeVisible();
  const after = await object.boundingBox();
  expect(after?.x).toBeCloseTo(before.x + 140, 0);
  expect(after?.y).toBeCloseTo(before.y + 80, 0);

  await page.getByRole("button", { name: "Undo last change" }).click();
  const restored = await object.boundingBox();
  expect(restored?.x).toBeCloseTo(before.x, 0);
  expect(restored?.y).toBeCloseTo(before.y, 0);
});

test("resizes a selected object with a canonical pointer-up mutation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/");
  await page.getByRole("button", { name: "Create note" }).click();
  const object = page.getByRole("button", { name: "Select New thought" });
  await object.click();
  const before = await object.boundingBox();
  const handle = page.getByRole("button", { name: "Resize New thought" });
  const handleBox = await handle.boundingBox();
  if (!before || !handleBox) throw new Error("resize geometry is unavailable");

  await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 84, handleBox.y + 54, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => (await object.boundingBox())?.width)
    .toBeCloseTo(before.width + 80, 0);
  await expect
    .poll(async () => (await object.boundingBox())?.height)
    .toBeCloseTo(before.height + 50, 0);
  await expect(page.getByText("Danny transformed “New thought” spatially.")).toBeVisible();
  await expect(page.getByText("Revision 2")).toBeVisible();
});

test("pans and zooms the viewport without creating object receipts", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/");
  await page.getByRole("button", { name: "Create note" }).click();
  const object = page.getByRole("button", { name: "Select New thought" });
  const before = await object.boundingBox();
  const canvas = page.getByRole("region", { name: "Infinite canvas" });
  const canvasBox = await canvas.boundingBox();
  if (!before || !canvasBox) throw new Error("canvas geometry is unavailable");

  await page.mouse.move(canvasBox.x + canvasBox.width - 90, canvasBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 10, canvasBox.y + 180, {
    steps: 5,
  });
  await page.mouse.up();

  const panned = await object.boundingBox();
  expect(panned?.x).toBeCloseTo(before.x + 80, 0);
  expect(panned?.y).toBeCloseTo(before.y + 60, 0);
  await expect(page.getByText("Revision 1")).toBeVisible();

  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + 280);
  await page.mouse.wheel(0, -420);

  await expect(page.getByText(/Zoom (?!100%)[0-9]+%/)).toBeVisible();
  const zoomed = await object.boundingBox();
  expect(zoomed?.width).toBeGreaterThan(before.width);
  await expect(page.getByText("Revision 1")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

test("minimizes, restores, safely discards, and recovers the selected object", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/");
  await page.getByRole("button", { name: "Create note" }).click();
  const object = page.getByRole("button", { name: "Select New thought" });
  await object.click();

  await page.getByRole("button", { name: "Minimize object" }).click();
  await expect(
    page.getByText("Capture the decision while everyone can still see the context."),
  ).toBeHidden();
  await expect(page.getByText("Danny minimized “New thought”.")).toBeVisible();

  await page.getByRole("button", { name: "Restore object" }).click();
  await expect(
    page.getByText("Capture the decision while everyone can still see the context."),
  ).toBeVisible();
  await expect(page.getByText("Danny restored “New thought”.")).toBeVisible();

  await page.getByRole("button", { name: "Move object to trash" }).click();
  await expect(object).toBeHidden();
  await expect(
    page.getByText("Danny moved “New thought” to recoverable trash."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(object).toBeVisible();
  await expect(page.getByText(/Danny undid: Danny moved/)).toBeVisible();
});
