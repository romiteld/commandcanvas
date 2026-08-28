import { expect, test } from "@playwright/test";

test("renders a fluid, scrollable landing page with real destinations", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    );
  });

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Where meetings become the deliverable",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try the demo" }).first()).toHaveAttribute(
    "href",
    "/demo",
  );
  await expect(page.getByRole("link", { name: "Start a meeting" })).toHaveAttribute(
    "href",
    "/meet",
  );
  await expect(page.locator("h1")).toHaveCount(1);

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.viewportHeight * 1.8);

  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByText("Step into the canvas")).toBeVisible();

  if (testInfo.project.name === "chromium-desktop") {
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("heading", {
        name: "Everything happens on one living canvas",
      }),
    ).toBeVisible();
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("keeps the landing page usable at tablet width and with reduced motion", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("figure")).toBeVisible();
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);

  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

test("stays fluid, branded, readable, and touchable across narrow widths", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  for (const width of [320, 360, 390, 393, 768, 1024]) {
    await page.setViewportSize({ width, height: width < 600 ? 800 : 1024 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const measurements = await page.evaluate(() => {
      const fontSize = (text: string) => {
        const element = Array.from(document.querySelectorAll<HTMLElement>("*"))
          .find((candidate) => candidate.textContent?.trim() === text);
        if (!element) throw new Error(`Missing landing text: ${text}`);
        return Number.parseFloat(getComputedStyle(element).fontSize);
      };
      const demo = Array.from(
        document.querySelectorAll<HTMLElement>('nav a[href="/demo"]'),
      ).find((element) => element.textContent?.includes("Try the demo"));
      const wordmark = Array.from(document.querySelectorAll<HTMLElement>("nav span"))
        .find((element) => element.textContent === "CommandCanvas");
      if (!demo || !wordmark) throw new Error("Landing navigation is incomplete.");
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        demoHeight: demo.getBoundingClientRect().height,
        wordmarkVisible: getComputedStyle(wordmark).display !== "none",
        capabilityCopy: fontSize(
          "Speak naturally. Objects, tasks, and content appear on the canvas.",
        ),
        workflowCopy: fontSize(
          "Speak what you need and watch it take shape on the canvas.",
        ),
        receiptCopy: fontSize("Added timeline"),
      };
    });

    expect(measurements.scrollWidth, `${width}px document width`).toBe(
      measurements.clientWidth,
    );
    expect(measurements.demoHeight, `${width}px primary touch target`).toBeGreaterThanOrEqual(44);
    expect(measurements.wordmarkVisible, `${width}px wordmark`).toBe(true);
    expect(measurements.capabilityCopy, `${width}px capability copy`).toBeGreaterThanOrEqual(13);
    expect(measurements.workflowCopy, `${width}px workflow copy`).toBeGreaterThanOrEqual(13);
    expect(measurements.receiptCopy, `${width}px receipt copy`).toBeGreaterThanOrEqual(12);
  }
});

test("preserves the full-viewport local workspace after document scrolling is restored", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await page.goto("/local", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "Infinite canvas" })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".command-canvas-shell");
    if (!shell) throw new Error("CommandCanvas shell is missing.");
    const bounds = shell.getBoundingClientRect();
    return {
      shellHeight: bounds.height,
      viewportHeight: window.innerHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
    };
  });
  expect(Math.abs(geometry.shellHeight - geometry.viewportHeight)).toBeLessThanOrEqual(1);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
});
