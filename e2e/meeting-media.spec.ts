import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";
import { requireProductionApiProxyOrigin } from "../lib/testing/live-probe-guards";

test.use({
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

const meetingControlViewports = [
  { width: 320, height: 568, label: "320x568" },
  { width: 390, height: 844, label: "390x844" },
  { width: 430, height: 932, label: "430x932" },
  { width: 768, height: 1024, label: "768x1024" },
  { width: 1024, height: 768, label: "1024x768" },
  { width: 1280, height: 720, label: "1280x720" },
  { width: 1440, height: 900, label: "1440x900" },
] as const;

test("meeting controls contain their labels and remain clickable at every supported viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name),
  );
  test.setTimeout(180_000);

  const apiProxyOrigin = process.env.COMMANDCANVAS_API_PROXY_ORIGIN;
  if (apiProxyOrigin) await installApiProxy(page, apiProxyOrigin);
  const roomCapture = captureCreatedRoom(page);
  let roomId: string | null = null;

  try {
    await page.goto("/demo");
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();

    for (const viewport of meetingControlViewports) {
      await page.setViewportSize(viewport);
      const filmstrip = page.getByRole("region", { name: "Meeting presence" });
      await expect(filmstrip).toBeVisible();
      await expectMeetingControlsContained(page, filmstrip, viewport.label);
      await expectVisibleButtonLabelsContained(page, viewport.label);

      const videoToggle = page.getByRole("button", {
        name: "Show participant videos",
      });
      await videoToggle.click();
      await expect(
        page.getByRole("group", { name: "Participant videos" }),
      ).toBeVisible();
      await expectMeetingControlsContained(page, filmstrip, viewport.label);
      await expectVisibleButtonLabelsContained(page, viewport.label);
      await page
        .getByRole("button", { name: "Hide participant videos" })
        .click();
    }

    await page.setViewportSize({ width: 320, height: 568 });
    const startMedia = page.getByRole("button", {
      name: "Start camera and microphone",
    });
    await expect(startMedia).toBeEnabled({ timeout: 10_000 });
    await startMedia.click();
    await expect(
      page.getByRole("button", { name: "Stop sharing video" }),
    ).toBeVisible({ timeout: 15_000 });

    for (const viewport of meetingControlViewports) {
      await page.setViewportSize(viewport);
      const filmstrip = page.getByRole("region", { name: "Meeting presence" });
      await expectMeetingControlsContained(page, filmstrip, viewport.label);
      await expectVisibleButtonLabelsContained(page, viewport.label);

      await page
        .getByRole("button", { name: "Hide participant videos" })
        .click();
      await expectMeetingControlsContained(page, filmstrip, viewport.label);
      await expectVisibleButtonLabelsContained(page, viewport.label);
      await page
        .getByRole("button", { name: "Show participant videos" })
        .click();
    }

    await page.getByRole("button", { name: "Leave meeting video" }).click();
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

test("keeps collapsed meeting controls at least 44px at a 390px viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      testInfo.project.name !== "chromium-mobile",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const apiProxyOrigin = process.env.COMMANDCANVAS_API_PROXY_ORIGIN;
  if (apiProxyOrigin) await installApiProxy(page, apiProxyOrigin);
  const roomCapture = captureCreatedRoom(page);
  let roomId: string | null = null;

  try {
    await page.goto("/demo");
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();

    const controls = page.locator(".meeting-filmstrip-actions button");
    expect(await controls.count()).toBeGreaterThanOrEqual(2);
    for (const control of await controls.all()) {
      const target = await control.boundingBox();
      if (!target) throw new Error("Meeting control geometry is unavailable.");
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ).toEqual({ clientWidth: 390, scrollWidth: 390 });
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

test("two no-signup browsers exchange real WebRTC media after both opt in", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );
  test.setTimeout(120_000);

  const contextA = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const contextB = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  await contextA.grantPermissions(
    ["camera", "microphone", "clipboard-read", "clipboard-write"],
    { origin },
  );
  await contextB.grantPermissions(["camera", "microphone"], { origin });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const apiProxyOrigin = process.env.COMMANDCANVAS_API_PROXY_ORIGIN;
  if (apiProxyOrigin) {
    await installApiProxy(pageA, apiProxyOrigin);
    await installApiProxy(pageB, apiProxyOrigin);
  }
  const roomCapture = captureCreatedRoom(pageA);
  let roomId: string | null = null;

  try {
    await pageA.goto("/demo");
    await enterLimitedJudgePreview(pageA);
    await expect(pageA.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();

    await pageA.getByRole("button", { name: "Invite people" }).click();
    const inviteUrl = await pageA.evaluate(() => navigator.clipboard.readText());
    await pageB.goto(inviteUrl);
    await enterLimitedJudgePreview(pageB);
    await expect(pageB.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    await expect(pageA.getByLabel("2 participants present")).toBeVisible({
      timeout: 20_000,
    });

    await pageA
      .getByRole("button", { name: "Start camera and microphone" })
      .click();
    await pageB
      .getByRole("button", { name: "Start camera and microphone" })
      .click();

    await expect(pageA.getByTestId("local-meeting-video")).toBeVisible();
    await expect(pageB.getByTestId("local-meeting-video")).toBeVisible();
    await expect(pageA.getByTestId("remote-meeting-video")).toBeVisible({
      timeout: 30_000,
    });
    await expect(pageB.getByTestId("remote-meeting-video")).toBeVisible({
      timeout: 30_000,
    });

    expect(await inspectMedia(pageA)).toEqual({
      localAudio: "live",
      localVideo: "live",
      remoteAudio: "live",
      remoteVideo: "live",
    });

    await pageA.getByRole("button", { name: "Stop sharing video" }).click();
    await expect(
      pageA.getByRole("button", { name: "Share video" }),
    ).toBeVisible();
    await expect(pageA.getByTestId("local-meeting-video")).toHaveCount(0);
    await expect(
      pageA
        .getByRole("region", { name: "Meeting presence" })
        .getByText(
          "Video is not shared. Your camera may remain active locally for hand input.",
          { exact: true },
        ),
    ).toBeVisible();

    await pageB.getByRole("button", { name: "Leave meeting video" }).click();
    await expect(pageB.getByTestId("local-meeting-video")).toHaveCount(0);
    await expect(pageA.getByTestId("remote-meeting-video")).toHaveCount(0, {
      timeout: 15_000,
    });
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    let cleanupError: unknown;
    try {
      if (roomId) await deleteHostedRoom(pageA, roomId);
    } catch (error) {
      cleanupError = error;
    } finally {
      await Promise.allSettled([contextB.close(), contextA.close()]);
    }
    if (cleanupError) throw cleanupError;
  }
});

async function inspectMedia(page: Page) {
  return page.evaluate(() => {
    function states(testId: string) {
      const video = document.querySelector<HTMLVideoElement>(
        `[data-testid="${testId}"]`,
      );
      const stream = video?.srcObject as MediaStream | null;
      return {
        audio: stream?.getAudioTracks()[0]?.readyState ?? null,
        video: stream?.getVideoTracks()[0]?.readyState ?? null,
      };
    }
    const local = states("local-meeting-video");
    const remote = states("remote-meeting-video");
    return {
      localAudio: local.audio,
      localVideo: local.video,
      remoteAudio: remote.audio,
      remoteVideo: remote.video,
    };
  });
}

async function expectVisibleButtonLabelsContained(page: Page, label: string) {
  const buttons = page.locator(".command-canvas-shell button:visible");
  for (const [index, button] of (await buttons.all()).entries()) {
    const content = (await button.textContent())?.trim();
    if (!content) continue;
    const overflow = await button.evaluate((element) => ({
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    }));
    expect(
      overflow.scrollWidth,
      `${label} visible button ${index} width: ${content}`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(
      overflow.scrollHeight,
      `${label} visible button ${index} height: ${content}`,
    ).toBeLessThanOrEqual(overflow.clientHeight + 1);
  }
}

async function expectMeetingControlsContained(
  page: Page,
  filmstrip: Locator,
  label: string,
) {
  const filmstripBox = await filmstrip.boundingBox();
  if (!filmstripBox) throw new Error(`${label} meeting filmstrip has no geometry.`);

  const controls = filmstrip.locator(".meeting-filmstrip-actions button:visible");
  expect(await controls.count(), `${label} visible meeting controls`).toBeGreaterThan(0);

  for (const [index, control] of (await controls.all()).entries()) {
    const box = await control.boundingBox();
    if (!box) throw new Error(`${label} meeting control ${index} has no geometry.`);
    expect(box.width, `${label} control ${index} touch width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${label} control ${index} touch height`).toBeGreaterThanOrEqual(44);
    expect(box.x, `${label} control ${index} left bound`).toBeGreaterThanOrEqual(
      filmstripBox.x - 1,
    );
    expect(
      box.x + box.width,
      `${label} control ${index} right bound`,
    ).toBeLessThanOrEqual(filmstripBox.x + filmstripBox.width + 1);

    const receivesPointer = await control.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const target = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return target === button || (target !== null && button.contains(target));
    });
    expect(receivesPointer, `${label} control ${index} center hit target`).toBe(
      true,
    );

    const overflow = await control.evaluate((button) => ({
      clientWidth: button.clientWidth,
      clientHeight: button.clientHeight,
      scrollWidth: button.scrollWidth,
      scrollHeight: button.scrollHeight,
    }));
    expect(
      overflow.scrollWidth,
      `${label} control ${index} label width`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(
      overflow.scrollHeight,
      `${label} control ${index} label height`,
    ).toBeLessThanOrEqual(overflow.clientHeight + 1);
  }
}

async function installApiProxy(page: Page, proxyOrigin: string) {
  const targetOrigin = requireProductionApiProxyOrigin(proxyOrigin);
  await page.route("**/api/**", async (route) => {
    const source = new URL(route.request().url());
    if (!isDemoProbeApiPath(source.pathname)) {
      await route.abort("blockedbyclient");
      return;
    }
    const response = await route.fetch({
      url: `${targetOrigin}${source.pathname}${source.search}`,
    });
    await route.fulfill({ response });
  });
}

function isDemoProbeApiPath(pathname: string) {
  return (
    pathname === "/api/rooms" ||
    pathname === "/api/rooms/join" ||
    /^\/api\/rooms\/[0-9a-f-]{36}(?:\/commands|\/media\/(?:roster|turn))?$/.test(
      pathname,
    )
  );
}
