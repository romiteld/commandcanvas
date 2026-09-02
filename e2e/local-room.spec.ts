import { expect, test } from "@playwright/test";

test("creates, pins, and undoes one semantic object with visible receipts", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/local");

  await expect(page).toHaveTitle(/CommandCanvas/);
  await expect(
    page.getByRole("main", { name: "Spatial command surface" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open system status" }).click();
  const systemStatus = page.getByRole("complementary", {
    name: "System status drawer",
  });
  const serviceStatus = systemStatus.getByRole("region", {
    name: "Service status",
  });
  await expect(
    serviceStatus.getByText("Site Tools unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    serviceStatus.getByText("Realtime not connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close system status drawer" })
    .click();

  await page.getByRole("button", { name: "Open create menu" }).click();
  await page.getByRole("button", { name: "Create note" }).click();
  await page.getByRole("button", { name: "Select New thought" }).click();
  await expect(
    page.getByRole("button", {
      name: "Open activity drawer: Danny created “New thought”.",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Pin object" }).click();
  await expect(page.getByText("Pinned to canvas")).toBeVisible();

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.getByText("Pinned to canvas")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: /Open activity drawer: Danny undid: Danny pinned/,
    }),
  ).toBeVisible();

  if (testInfo.project.name === "chromium-desktop")
    await page.screenshot({
      path: "/tmp/commandcanvas-checkpoint-1-desktop.png",
      fullPage: true,
    });

  expect(browserErrors).toEqual([]);
});

test("bridges a document.modelContext invocation into the live canvas", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await page.addInitScript(() => {
    const registrations: Array<{
      tool: {
        name: string;
        execute: (
          input: unknown,
          options: { signal: AbortSignal },
        ) => Promise<unknown>;
      };
      signal: AbortSignal;
    }> = [];
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (
          tool: (typeof registrations)[number]["tool"],
          options: { signal: AbortSignal },
        ) => {
          registrations.push({ tool, signal: options.signal });
        },
      },
    });
    Object.defineProperty(window, "__commandCanvasRegistrations", {
      value: registrations,
    });
  });

  await page.goto("/local");
  await page.getByRole("button", { name: "Open system status" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "System status drawer" })
      .getByRole("region", { name: "Service status" })
      .getByText("12 Site Tools registered", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close system status drawer" })
    .click();

  const result = await page.evaluate(async () => {
    const registrations = (
      window as unknown as {
        __commandCanvasRegistrations: Array<{
          tool: {
            name: string;
            execute: (
              input: unknown,
              options: { signal: AbortSignal },
            ) => Promise<unknown>;
          };
        }>;
      }
    ).__commandCanvasRegistrations;
    const registration = registrations.find(
      ({ tool }) => tool.name === "create_object",
    );
    if (!registration) throw new Error("create_object is not registered");
    return registration.tool.execute(
      {
        type: "note",
        title: "Browser agent action",
        text: "The registered tool changed this exact page.",
        tone: "sky",
      },
      { signal: new AbortController().signal },
    );
  });

  expect(result).toMatchObject({ ok: true, status: "completed" });
  await expect(
    page.getByRole("button", { name: "Select Browser agent action" }),
  ).toBeVisible();
  const agentReceipt = page.getByRole("button", {
    name: "Open activity drawer: Site Tools agent created “Browser agent action”.",
  });
  await expect(agentReceipt).toBeVisible();
  await expect(agentReceipt.getByText("R1 · webmcp", { exact: true })).toBeVisible();
});

test("keeps the canvas and primary action usable at a mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/local");
  await expect(page.getByRole("region", { name: "Infinite canvas" })).toBeVisible();
  const dock = page.getByRole("complementary", { name: "Object tools" });
  await expect(dock.locator(".tool-dock-primary > button")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Open create menu" })).toBeVisible();
  const dockBox = await dock.boundingBox();
  if (!dockBox) throw new Error("mobile dock geometry unavailable");
  expect(dockBox.x).toBeGreaterThanOrEqual(0);
  expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(320);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        documentOverflow:
          document.documentElement.scrollHeight - window.innerHeight,
        shellDelta: Math.round(
          (document.querySelector("main")?.getBoundingClientRect().height ?? 0) -
            window.innerHeight,
        ),
      })),
    )
    .toEqual({ documentOverflow: 0, shellDelta: 0 });

  await page.getByRole("button", { name: "Open create menu" }).click();
  await expect(page.getByRole("button", { name: "Create task board" })).toBeVisible();
  await page.getByRole("button", { name: "Create task board" }).click();

  await expect(
    page.getByRole("button", { name: "Select Project board" }),
  ).toBeVisible();
  const boardBox = await page
    .getByRole("button", { name: "Select Project board" })
    .boundingBox();
  const canvasBox = await page
    .getByRole("region", { name: "Infinite canvas" })
    .boundingBox();
  if (!boardBox || !canvasBox) throw new Error("mobile canvas geometry unavailable");
  expect(boardBox.x).toBeGreaterThanOrEqual(canvasBox.x);
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(
    canvasBox.x + canvasBox.width + 1,
  );
  await expect(
    page.getByRole("button", {
      name: "Open activity drawer: Danny created “Project board”.",
    }),
  ).toBeVisible();
});

test("keeps the off-state hand sensor compact and out of mobile object hit testing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/local");

  const handControl = page.getByRole("region", { name: "Hand input" });
  const handControlBox = await handControl.boundingBox();
  if (!handControlBox) throw new Error("Hand input geometry is unavailable.");
  expect(handControlBox.height).toBeLessThanOrEqual(64);
  await expect(page.getByLabel("Local hand tracking preview")).toBeHidden();

  await page.getByRole("button", { name: "Open create menu" }).click();
  await page.getByRole("button", { name: "Create note" }).click();
  const note = page.getByRole("button", { name: "Select New thought" });
  const noteBox = await note.boundingBox();
  if (!noteBox) throw new Error("New thought geometry is unavailable.");

  const hitTarget = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return Boolean(target?.closest('[aria-label="Select New thought"]'));
    },
    {
      x: noteBox.x + noteBox.width / 2,
      y: noteBox.y + noteBox.height / 2,
    },
  );
  expect(hitTarget).toBe(true);

  await note.click();
  await expect(page.getByRole("button", { name: "Resize New thought" })).toBeVisible();
});

test("opens command and system controls over the workspace without resizing the canvas", async ({
  page,
}, testInfo) => {
  test.skip(
    !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name),
  );

  await page.goto("/local");
  const canvas = page.getByRole("region", { name: "Infinite canvas" });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        documentOverflow:
          document.documentElement.scrollHeight - window.innerHeight,
        shellDelta: Math.round(
          (document.querySelector("main")?.getBoundingClientRect().height ?? 0) -
            window.innerHeight,
        ),
      })),
    )
    .toEqual({ documentOverflow: 0, shellDelta: 0 });
  const before = await canvas.boundingBox();
  if (!before) throw new Error("canvas geometry is unavailable");

  await expect(
    page.getByRole("complementary", { name: "ChatGPT command drawer" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open ChatGPT Site Tools and activity drawer" })
    .click();
  await expect(
    page.getByRole("complementary", { name: "ChatGPT command drawer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Direct canvas command" }),
  ).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(before);

  await page
    .getByRole("button", { name: "Close ChatGPT command drawer" })
    .click();
  await page.getByRole("button", { name: "Open system status" }).click();
  await expect(
    page.getByRole("complementary", { name: "System status drawer" }),
  ).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(before);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const workspace = document.querySelector<HTMLElement>(".workspace-grid");
        const canvasElement = document.querySelector<HTMLElement>(
          '[aria-label="Infinite canvas"]',
        );
        return {
          scrollLeft: workspace?.scrollLeft,
          scrollWidth: workspace?.scrollWidth,
          clientWidth: workspace?.clientWidth,
          canvasX: canvasElement?.getBoundingClientRect().x,
        };
      }),
    )
    .toEqual({
      scrollLeft: 0,
      scrollWidth: before.width,
      clientWidth: before.width,
      canvasX: 0,
    });
});

test("creates semantic project-board and schedule objects from the toolbar", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/local");
  await page.getByRole("button", { name: "Create task board" }).click();
  await expect(
    page.getByRole("button", { name: "Select Project board" }),
  ).toBeVisible();
  await expect(page.getByText("Confirm launch date")).toHaveCount(0);
  await expect(page.getByText("Polish the demo path")).toHaveCount(0);

  await page.getByRole("button", { name: "Create schedule" }).click();
  await expect(
    page.getByRole("button", { name: "Select Schedule" }),
  ).toBeVisible();
  await expect(page.getByText("Review WebMCP flow")).toHaveCount(0);
  await expect(
    page
      .getByLabel("Canvas coordinates")
      .getByText("Revision 2", { exact: true }),
  ).toBeVisible();
  const board = await page
    .getByRole("button", { name: "Select Project board" })
    .boundingBox();
  const schedule = await page
    .getByRole("button", { name: "Select Schedule" })
    .boundingBox();
  if (!board || !schedule) throw new Error("semantic object geometry unavailable");
  expect(schedule.x).toBeGreaterThanOrEqual(board.x + board.width + 80);
  await page
    .getByRole("button", { name: "Open activity drawer", exact: true })
    .click();
  await expect(page.locator(".receipt-list > li")).toHaveCount(2);

  expect(browserErrors).toEqual([]);
});

test("reviews a deterministic browser speech transcript before a canonical voice command", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await page.addInitScript(() => {
    class DeterministicSpeechRecognition {
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 0;
      onstart: ((event: Event) => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: ((event: Event) => void) | null = null;

      start() {
        this.onstart?.(new Event("start"));
        queueMicrotask(() => {
          this.onresult?.({
            resultIndex: 0,
            results: {
              length: 1,
              0: {
                isFinal: true,
                length: 1,
                0: {
                  transcript: "Bring in our project board",
                  confidence: 1,
                },
              },
            },
          });
          this.onend?.(new Event("end"));
        });
      }

      stop() {}

      abort() {}
    }

    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"])
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: DeterministicSpeechRecognition,
      });
  });

  await page.goto("/local");
  await page
    .getByRole("button", { name: "Open ChatGPT Site Tools and activity drawer" })
    .click();
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            webkitSpeechRecognition?: { name?: string };
          }
        ).webkitSpeechRecognition?.name,
    ),
  ).toBe("DeterministicSpeechRecognition");
  await expect(
    page.getByText(
      "Direct shortcuts use the human command path. Agent actions arrive through WebMCP.",
    ),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Start voice transcription" })
    .click();
  const input = page.getByRole("textbox", { name: "Direct canvas command" });
  await expect(input).toHaveValue("Bring in our project board");
  await expect(
    page.getByText("Transcript ready. Review it, then run the direct command."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Project board" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Run direct command" }).click();
  await expect(
    page.getByRole("button", { name: "Select Project board" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", {
        name: "Open activity drawer: Danny created “Project board”.",
      })
      .getByText("R1 · voice", { exact: true }),
  ).toBeVisible();
});

test("commits exactly one canonical transform when a pointer drag ends", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/local");
  await page.getByRole("button", { name: "Create note" }).click();
  const object = page.getByRole("button", { name: "Select New thought" });
  const before = await object.boundingBox();
  if (!before) throw new Error("object has no browser geometry");

  await page.mouse.move(before.x + 90, before.y + 45);
  await page.mouse.down();
  await page.mouse.move(before.x + 230, before.y + 125, { steps: 5 });
  await page.mouse.up();

  await expect(
    page.getByRole("button", {
      name: "Open activity drawer: Danny transformed “New thought” spatially.",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Canvas coordinates")
      .getByText("Revision 2", { exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await object.boundingBox())?.x).toBeCloseTo(
    before.x + 140,
    0,
  );
  await expect.poll(async () => (await object.boundingBox())?.y).toBeCloseTo(
    before.y + 80,
    0,
  );

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect.poll(async () => (await object.boundingBox())?.x).toBeCloseTo(
    before.x,
    0,
  );
  await expect.poll(async () => (await object.boundingBox())?.y).toBeCloseTo(
    before.y,
    0,
  );
});

test("resizes a selected object with a canonical pointer-up mutation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/local");
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
  await expect(
    page.getByRole("button", {
      name: "Open activity drawer: Danny transformed “New thought” spatially.",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Canvas coordinates")
      .getByText("Revision 2", { exact: true }),
  ).toBeVisible();
});

test("pans and zooms the viewport without creating object receipts", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/local");
  await page.getByRole("button", { name: "Create note" }).click();
  const object = page.getByRole("button", { name: "Select New thought" });
  const before = await object.boundingBox();
  const canvas = page.getByRole("region", { name: "Infinite canvas" });
  const viewport = canvas.locator(".canvas-viewport");
  const viewportBox = await viewport.boundingBox();
  if (!before || !viewportBox) throw new Error("canvas geometry is unavailable");

  const panStart = {
    x: viewportBox.x + viewportBox.width * 0.65,
    y: viewportBox.y + viewportBox.height * 0.55,
  };
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest(".canvas-viewport")),
        { x: panStart.x, y: panStart.y },
      ),
    )
    .toBe(true);
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 80, panStart.y + 60, {
    steps: 5,
  });
  await page.mouse.up();

  const panned = await object.boundingBox();
  expect(panned?.x).toBeCloseTo(before.x + 80, 0);
  expect(panned?.y).toBeCloseTo(before.y + 60, 0);
  const canvasStatus = page.getByLabel("Canvas coordinates");
  await expect(canvasStatus.getByText("Revision 1", { exact: true })).toBeVisible();

  await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + 280);
  await page.mouse.wheel(0, -420);

  await expect(page.getByText(/Zoom (?!100%)[0-9]+%/)).toBeVisible();
  const zoomed = await object.boundingBox();
  expect(zoomed?.width).toBeGreaterThan(before.width);
  await expect(canvasStatus.getByText("Revision 1", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Open activity drawer", exact: true })
    .click();
  await expect(page.locator(".receipt-list > li")).toHaveCount(1);
});

test("minimizes, restores, safely discards, and recovers the selected object", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.goto("/local");
  await page.getByRole("button", { name: "Create note" }).click();
  const object = page.getByRole("button", { name: "Select New thought" });
  await object.click();

  await page.getByRole("button", { name: "Minimize object" }).click();
  await expect(
    page.getByText("Capture the decision while everyone can still see the context."),
  ).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Open activity drawer: Danny minimized “New thought”.",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Restore object" }).click();
  await expect(
    page.getByText("Capture the decision while everyone can still see the context."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Open activity drawer: Danny restored “New thought”.",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Move object to trash" }).click();
  await expect(object).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Open activity drawer: Danny moved “New thought” to recoverable trash.",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(object).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Open activity drawer: Danny undid: Danny moved/,
    }),
  ).toBeVisible();
});
