import { expect, test, type Page } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { requireProductionApiProxyOrigin } from "../lib/testing/live-probe-guards";

test("opens two real no-signup browsers with Presence, cursors, and durable collaboration", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );

  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const apiProxyOrigin = process.env.COMMANDCANVAS_API_PROXY_ORIGIN;
  if (apiProxyOrigin) {
    await installApiProxy(pageA, apiProxyOrigin);
    await installApiProxy(pageB, apiProxyOrigin);
  }
  const browserErrors: string[] = [];
  pageA.on("pageerror", (error) => browserErrors.push(`A: ${error.message}`));
  pageB.on("pageerror", (error) => browserErrors.push(`B: ${error.message}`));
  let roomId: string | null = null;
  const roomCapture = captureCreatedRoom(pageA);

  try {
    await pageA.goto("/demo");
    await expect(pageA.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
    await expect(
      pageA.getByRole("button", { name: "Select Launch readiness" }),
    ).toBeVisible();
    await expect(
      pageA.getByRole("button", { name: "Select Submission week" }),
    ).toBeVisible();
    await expect(pageA.getByText("Revision 3")).toBeVisible();
    await expect(pageA.getByLabel("1 participant present")).toBeVisible();
    await expect(pageA.getByText("Site Tools unavailable")).toBeVisible();

    roomId = await roomCapture.resolveRoomId();
    expect(roomId).toMatch(/^[0-9a-f-]{36}$/);

    await pageA.getByRole("button", { name: "Copy participant invite" }).click();
    await expect(pageA.getByText("Invite copied")).toBeVisible();
    const inviteUrl = await pageA.evaluate(() => navigator.clipboard.readText());
    expect(inviteUrl).toContain("/demo?room=room-");
    expect(inviteUrl).toContain("&join=");

    await pageB.goto(inviteUrl);
    await expect(pageB.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
    await expect(pageB).toHaveURL(`${origin}/demo`);
    await expect(pageA.getByLabel("2 participants present")).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageB.getByLabel("2 participants present")).toBeVisible({
      timeout: 15_000,
    });

    await contextB.setOffline(true);
    await expect(
      pageB.getByText("Realtime unavailable · state preserved"),
    ).toBeVisible({ timeout: 10_000 });
    await contextB.setOffline(false);
    await expect(
      pageB.getByText("2 present via Supabase Realtime"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(pageA.getByLabel("2 participants present")).toBeVisible({
      timeout: 20_000,
    });

    const canvasB = pageB.getByRole("region", { name: "Infinite canvas" });
    const boundsB = await canvasB.boundingBox();
    if (!boundsB) throw new Error("Participant canvas geometry is unavailable.");
    await pageB.mouse.move(boundsB.x + 520, boundsB.y + 410, { steps: 4 });
    await expect(
      pageA.locator(".remote-cursor").filter({ hasText: "Sarah" }),
    ).toBeVisible({ timeout: 10_000 });

    await pageB.getByRole("button", { name: "Create note" }).click();
    await expect(pageB.getByText("Sarah created “New thought”.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageA.getByText("Sarah created “New thought”.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageA.getByText("Revision 4")).toBeVisible();
    await expect(pageB.getByText("R4 · collaborator")).toBeVisible();

    await pageB.reload();
    await expect(pageB.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByText("Revision 4")).toBeVisible();
    await expect(pageB.getByLabel("2 participants present")).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageA.getByLabel("2 participants present")).toBeVisible({
      timeout: 15_000,
    });

    const cursorAfterReload = pageA
      .locator(".remote-cursor")
      .filter({ hasText: "Sarah" });
    const positionBeforeReloadMove = await cursorAfterReload.getAttribute("style");
    const reloadedBounds = await pageB
      .getByRole("region", { name: "Infinite canvas" })
      .boundingBox();
    if (!reloadedBounds)
      throw new Error("Reloaded participant canvas geometry is unavailable.");
    await pageB.mouse.move(
      reloadedBounds.x + 820,
      reloadedBounds.y + 220,
      { steps: 4 },
    );
    await expect
      .poll(() => cursorAfterReload.getAttribute("style"), {
        message: "The reloaded participant cursor should resume immediately.",
      })
      .not.toBe(positionBeforeReloadMove);

    await pageA.screenshot({
      path: "/tmp/commandcanvas-checkpoint-4-realtime.png",
      fullPage: true,
    });
    expect(browserErrors).toEqual([]);
  } finally {
    roomCapture.stop();
    roomId ??= await roomCapture.resolveRoomId();
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
