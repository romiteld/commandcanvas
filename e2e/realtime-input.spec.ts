import path from "node:path";

import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let realtimeControllerBundle = "";

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [
      path.resolve(process.cwd(), "lib/realtime/room-channel.ts"),
    ],
    bundle: true,
    format: "iife",
    globalName: "CommandCanvasRealtime",
    platform: "browser",
    target: ["es2022"],
    write: false,
  });
  realtimeControllerBundle = result.outputFiles[0]?.text ?? "";
  if (!realtimeControllerBundle)
    throw new Error("Realtime browser harness bundle was not produced.");
});

test("deterministic Supabase transport recovers offline to online without a reload", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    !["chromium-desktop", "webkit-mobile-safari"].includes(
      testInfo.project.name,
    ),
  );

  await page.setContent(
    '<main><p data-testid="realtime-status">not-started</p></main>',
  );
  await page.addScriptTag({ content: realtimeControllerBundle });

  const initialPageToken = await page.evaluate(async () => {
    interface BrowserChannel {
      on: (
        type: "presence" | "broadcast",
        filter: { event: string },
        callback: (message?: unknown) => void,
      ) => BrowserChannel;
      subscribe: (callback: (status: string) => void) => BrowserChannel;
      track: () => Promise<string>;
      untrack: () => Promise<string>;
      send: () => Promise<string>;
      presenceState: () => Record<string, never>;
      emitStatus: (status: string) => void;
      trackCount: number;
      untrackCount: number;
    }

    interface RealtimeController {
      connect: () => Promise<void>;
      dispose: () => Promise<void>;
    }

    interface RealtimeApi {
      createRoomRealtime: (options: Record<string, unknown>) => RealtimeController;
    }

    const api = (
      window as unknown as { CommandCanvasRealtime: RealtimeApi }
    ).CommandCanvasRealtime;
    const channels: BrowserChannel[] = [];
    const topics: string[] = [];
    const statuses: string[] = [];
    const removedChannels: BrowserChannel[] = [];
    let authRefreshCount = 0;

    function createChannel(): BrowserChannel {
      let subscriber: ((status: string) => void) | null = null;
      const channel: BrowserChannel = {
        on: () => channel,
        subscribe: (callback) => {
          subscriber = callback;
          return channel;
        },
        track: async () => {
          channel.trackCount += 1;
          return "ok";
        },
        untrack: async () => {
          channel.untrackCount += 1;
          return "ok";
        },
        send: async () => "ok",
        presenceState: () => ({}),
        emitStatus: (status) => subscriber?.(status),
        trackCount: 0,
        untrackCount: 0,
      };
      return channel;
    }

    const client = {
      realtime: {
        setAuth: async () => {
          authRefreshCount += 1;
        },
      },
      channel: (topic: string) => {
        topics.push(topic);
        const channel = createChannel();
        channels.push(channel);
        return channel;
      },
      removeChannel: async (channel: BrowserChannel) => {
        removedChannels.push(channel);
        return "ok";
      },
    };
    const pageToken = "page-instance-before-recovery";
    const controller = api.createRoomRealtime({
      client,
      roomId: "19895c17-7365-4c03-a1cc-c15b85179ee4",
      accessToken: "verified-access-token",
      participant: {
        participantId: "8ddf3cce-8e92-4b04-bbde-765061563d3e",
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: () => undefined,
      onCursor: () => undefined,
      onRevision: () => undefined,
      onStatus: (status: string) => {
        statuses.push(status);
        const target = document.querySelector(
          '[data-testid="realtime-status"]',
        );
        if (target) target.textContent = status;
      },
      now: () => 1_000,
    });
    Object.defineProperty(window, "__commandCanvasRecoveryHarness", {
      configurable: true,
      value: {
        authRefreshCount: () => authRefreshCount,
        channels,
        controller,
        pageToken,
        removedChannels,
        statuses,
        topics,
      },
    });

    await controller.connect();
    channels[0]?.emitStatus("SUBSCRIBED");
    return pageToken;
  });

  await expect(page.getByTestId("realtime-status")).toHaveText("connected");

  if (testInfo.project.name === "chromium-desktop")
    await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByTestId("realtime-status")).toHaveText(
    "channel_error",
  );

  if (testInfo.project.name === "chromium-desktop")
    await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __commandCanvasRecoveryHarness: { channels: unknown[] };
            }
          ).__commandCanvasRecoveryHarness.channels.length,
      ),
    )
    .toBe(2);

  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __commandCanvasRecoveryHarness: {
          channels: Array<{ emitStatus: (status: string) => void }>;
        };
      }
    ).__commandCanvasRecoveryHarness;
    harness.channels[1]?.emitStatus("SUBSCRIBED");
  });
  await expect(page.getByTestId("realtime-status")).toHaveText("connected");

  const evidence = await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __commandCanvasRecoveryHarness: {
          authRefreshCount: () => number;
          channels: Array<{ trackCount: number; untrackCount: number }>;
          controller: { dispose: () => Promise<void> };
          pageToken: string;
          removedChannels: unknown[];
          topics: string[];
        };
      }
    ).__commandCanvasRecoveryHarness;
    return {
      authRefreshCount: harness.authRefreshCount(),
      channelCount: harness.channels.length,
      firstUntrackCount: harness.channels[0]?.untrackCount,
      pageToken: harness.pageToken,
      removedChannelCount: harness.removedChannels.length,
      secondTrackCount: harness.channels[1]?.trackCount,
      topics: harness.topics,
    };
  });
  expect(evidence).toEqual({
    authRefreshCount: 2,
    channelCount: 2,
    firstUntrackCount: 1,
    pageToken: initialPageToken,
    removedChannelCount: 1,
    secondTrackCount: 1,
    topics: [
      "room:19895c17-7365-4c03-a1cc-c15b85179ee4",
      "room:19895c17-7365-4c03-a1cc-c15b85179ee4",
    ],
  });

  await page.evaluate(async () => {
    const harness = (
      window as unknown as {
        __commandCanvasRecoveryHarness: {
          controller: { dispose: () => Promise<void> };
        };
      }
    ).__commandCanvasRecoveryHarness;
    await harness.controller.dispose();
  });
});

test("routes trusted touch and pen pointer sequences into canonical sketch receipts", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await page.evaluate(() => {
    const pointerEvidence: Array<{
      isTrusted: boolean;
      pointerType: string;
    }> = [];
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "touch" || event.pointerType === "pen")
          pointerEvidence.push({
            isTrusted: event.isTrusted,
            pointerType: event.pointerType,
          });
      },
      { capture: true },
    );
    Object.defineProperty(window, "__commandCanvasPointerEvidence", {
      configurable: true,
      value: pointerEvidence,
    });
  });
  const cdp = await context.newCDPSession(page);

  await page.getByRole("button", { name: "Create sketch" }).click();
  const touchSurface = page.getByRole("img", { name: "Sketch draft surface" });
  const touchBounds = await touchSurface.boundingBox();
  if (!touchBounds) throw new Error("Touch sketch geometry is unavailable.");
  const touchStart = { x: touchBounds.x + 70, y: touchBounds.y + 90 };
  const touchEnd = { x: touchBounds.x + 210, y: touchBounds.y + 160 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...touchStart, id: 41, force: 0.5 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...touchEnd, id: 41, force: 0.65 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByText("1 draft stroke")).toBeVisible();
  await page.getByRole("button", { name: "Finish sketch" }).click();
  await expect(page.getByText("R1 · touch")).toBeVisible();

  await page.getByRole("button", { name: "Create sketch" }).click();
  const penSurface = page.getByRole("img", { name: "Sketch draft surface" });
  const penBounds = await penSurface.boundingBox();
  if (!penBounds) throw new Error("Pen sketch geometry is unavailable.");
  const penStart = { x: penBounds.x + 95, y: penBounds.y + 75 };
  const penEnd = { x: penBounds.x + 260, y: penBounds.y + 175 };
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...penStart,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "pen",
    force: 0.45,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...penEnd,
    button: "none",
    buttons: 1,
    pointerType: "pen",
    force: 0.7,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...penEnd,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "pen",
    force: 0,
  });
  await expect(page.getByText("1 draft stroke")).toBeVisible();
  await page.getByRole("button", { name: "Finish sketch" }).click();

  await expect(page.getByText("R2 · stylus")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Rough architecture" }),
  ).toHaveCount(2);
  const pointerEvidence = await page.evaluate(
    () =>
      (
        window as unknown as {
          __commandCanvasPointerEvidence: Array<{
            isTrusted: boolean;
            pointerType: string;
          }>;
        }
      ).__commandCanvasPointerEvidence,
  );
  expect(pointerEvidence).toEqual([
    { isTrusted: true, pointerType: "touch" },
    { isTrusted: true, pointerType: "pen" },
  ]);
  expect(browserErrors).toEqual([]);
});

test("keeps the ordinary-browser canvas usable under an iPhone WebKit profile", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "webkit-mobile-safari");
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByText("Site Tools unavailable")).toBeVisible();
  await expect(page.getByRole("region", { name: "Infinite canvas" })).toBeVisible();

  await page.getByRole("button", { name: "Create note" }).tap();
  await expect(
    page.getByRole("button", { name: "Select New thought" }),
  ).toBeVisible();
  await expect(page.getByText("Danny created “New thought”.")).toBeVisible();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(browserErrors).toEqual([]);
});
