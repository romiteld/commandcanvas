import { expect, test, type Page } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { requireProductionApiProxyOrigin } from "../lib/testing/live-probe-guards";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
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
    await expect(pageA.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();

    await pageA.getByRole("button", { name: "Copy participant invite" }).click();
    const inviteUrl = await pageA.evaluate(() => navigator.clipboard.readText());
    await pageB.goto(inviteUrl);
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

    await pageA.getByRole("button", { name: "Turn camera off" }).click();
    expect(
      await pageA.getByTestId("local-meeting-video").evaluate((video) => {
        const stream = (video as HTMLVideoElement).srcObject as MediaStream;
        return stream.getVideoTracks()[0]?.enabled;
      }),
    ).toBe(false);

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
    /^\/api\/rooms\/[0-9a-f-]{36}(?:\/commands)?$/.test(pathname)
  );
}
