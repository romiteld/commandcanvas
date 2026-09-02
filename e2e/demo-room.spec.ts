import { expect, test, type Page } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
  readSessionRoomId,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";
import { requireProductionApiProxyOrigin } from "../lib/testing/live-probe-guards";

test("opens two real no-signup browsers with Presence, cursors, and durable collaboration", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );
  test.setTimeout(120_000);

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
    await enterLimitedJudgePreview(pageA);
    await expect(pageA.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
    await expect(
      pageA.getByRole("button", { name: "Select Launch readiness" }),
    ).toBeVisible();
    await expect(
      pageA.getByRole("button", { name: "Select Submission week" }),
    ).toBeVisible();
    await expect(
      pageA
        .getByLabel("Canvas coordinates")
        .getByText("Revision 3", { exact: true }),
    ).toBeVisible();
    await expect(pageA.getByLabel("1 participant present")).toBeVisible();
    await pageA.getByRole("button", { name: "Open system status" }).click();
    await expect(
      pageA
        .getByRole("complementary", { name: "System status drawer" })
        .getByRole("region", { name: "Service status" })
        .getByText("Site Tools unavailable", { exact: true }),
    ).toBeVisible();
    await pageA
      .getByRole("button", { name: "Close system status drawer" })
      .click();

    roomId = await roomCapture.resolveRoomId();
    expect(roomId).toMatch(/^[0-9a-f-]{36}$/);

    await pageA.getByRole("button", { name: "Invite people" }).click();
    await expect(pageA.getByText("Invite link copied")).toBeVisible();
    const inviteUrl = await pageA.evaluate(() => navigator.clipboard.readText());
    expect(inviteUrl).toContain("/demo?room=room-");
    expect(inviteUrl).toContain("&join=");

    await pageB.goto(inviteUrl);
    await enterLimitedJudgePreview(pageB);
    await expect(pageB.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
    await expect(pageB).toHaveURL(`${origin}/demo`);
    await expect(pageA.getByLabel("2 participants present")).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageB.getByLabel("2 participants present")).toBeVisible({
      timeout: 15_000,
    });

    await pageB.getByRole("button", { name: "Open system status" }).click();
    await contextB.setOffline(true);
    await expect(
      pageB
        .getByRole("complementary", { name: "System status drawer" })
        .getByRole("region", { name: "Service status" })
        .getByText("Realtime unavailable · state preserved", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await contextB.setOffline(false);
    await expect(
      pageB
        .getByRole("complementary", { name: "System status drawer" })
        .getByRole("region", { name: "Service status" })
        .getByText("2 present via Supabase Realtime", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await pageB
      .getByRole("button", { name: "Close system status drawer" })
      .click();
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
    const participantNoteReceiptName =
      "Open activity drawer: Sarah created “New thought”.";
    await expect(
      pageB.getByRole("button", { name: participantNoteReceiptName }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pageA.getByRole("button", { name: participantNoteReceiptName }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pageA
        .getByLabel("Canvas coordinates")
        .getByText("Revision 4", { exact: true }),
    ).toBeVisible();
    await expect(
      pageB
        .getByRole("button", { name: participantNoteReceiptName })
        .getByText("R4 · collaborator", { exact: true }),
    ).toBeVisible();

    await pageB
      .getByRole("button", { name: "Enable multiple selection" })
      .click();
    await pageB.getByRole("button", { name: "Select Decision" }).click();
    await pageB.getByRole("button", { name: "Select New thought" }).click();
    await pageB
      .getByRole("button", { name: "Group selected objects" })
      .click();
    await expect(
      pageA.getByRole("button", {
        name: "Open activity drawer: Sarah grouped 2 objects in “Frame 5”.",
      }),
    ).toBeVisible({ timeout: 15_000 });

    await pageB.getByRole("button", { name: "Rotate clockwise" }).click();
    await expect(
      pageA.getByRole("button", {
        name: "Open activity drawer: Sarah transformed “Frame 5” and its contents spatially.",
      }),
    ).toBeVisible({ timeout: 15_000 });

    await pageB.getByRole("button", { name: "Undo last change" }).click();
    await expect(
      pageA.getByRole("button", {
        name: /Open activity drawer: Sarah undid: Sarah transformed “Frame 5”/,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await pageB.getByRole("button", { name: "Redo last undone change" }).click();
    await expect(
      pageA.getByRole("button", {
        name: /Open activity drawer: Sarah redid: Sarah transformed “Frame 5”/,
      }),
    ).toBeVisible({ timeout: 15_000 });

    await pageB
      .getByRole("button", { name: "Ungroup selected frame" })
      .click();
    await expect(
      pageA.getByRole("button", {
        name: "Open activity drawer: Sarah ungrouped “Frame 5”.",
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pageA
        .getByLabel("Canvas coordinates")
        .getByText("Revision 9", { exact: true }),
    ).toBeVisible();

    await pageB.reload();
    await expect(pageB.getByText("Live demo room")).toBeVisible({ timeout: 20_000 });
    await expect(
      pageB
        .getByLabel("Canvas coordinates")
        .getByText("Revision 9", { exact: true }),
    ).toBeVisible();
    await expect(
      pageB.getByRole("button", { name: "Select Frame 5" }),
    ).toHaveCount(0);
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

test("reopens the same recent demo room when a fresh tab retains only the Supabase identity", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );
  test.setTimeout(90_000);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const pageA = await context.newPage();
  const apiProxyOrigin = process.env.COMMANDCANVAS_API_PROXY_ORIGIN;
  if (apiProxyOrigin) await installApiProxy(pageA, apiProxyOrigin);

  const browserErrors: string[] = [];
  pageA.on("pageerror", (error) =>
    browserErrors.push(`initial: ${error.message}`),
  );

  const roomCapture = captureCreatedRoom(pageA);
  const roomsToDelete = new Set<string>();
  let cleanupPage: Page = pageA;

  try {
    await pageA.goto("/demo");
    await enterLimitedJudgePreview(pageA);
    await expect(pageA.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      pageA
        .getByLabel("Canvas coordinates")
        .getByText("Revision 3", { exact: true }),
    ).toBeVisible();

    const initialRoomId = await roomCapture.resolveRoomId();
    expect(initialRoomId).toMatch(/^[0-9a-f-]{36}$/);
    roomsToDelete.add(initialRoomId!);
    expect(await readSessionRoomId(pageA)).toBe(initialRoomId);

    const initialUserId = await readSupabaseAnonymousUserId(pageA);
    expect(initialUserId).toMatch(/^[0-9a-f-]{36}$/);

    const pageB = await context.newPage();
    cleanupPage = pageB;
    if (apiProxyOrigin) await installApiProxy(pageB, apiProxyOrigin);
    pageB.on("pageerror", (error) =>
      browserErrors.push(`reopen: ${error.message}`),
    );

    await pageB.goto("/");
    expect(await readSupabaseAnonymousUserId(pageB)).toBe(initialUserId);
    expect(await readSessionRoomId(pageB)).toBeNull();

    roomCapture.stop();
    await pageA.close();

    let roomOpenRequestCount = 0;
    pageB.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/rooms")
        roomOpenRequestCount += 1;
    });
    const reopenResponsePromise = pageB.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        url.pathname === "/api/rooms"
      );
    });

    await pageB.goto("/demo");
    await enterLimitedJudgePreview(pageB);
    const reopenResponse = await reopenResponsePromise;
    const rawBody = (await reopenResponse.json().catch(() => null)) as
      | {
          ok?: unknown;
          room?: {
            roomId?: unknown;
            role?: unknown;
            joined?: unknown;
          };
        }
      | null;
    const reopenedRoom = {
      ok: rawBody?.ok,
      roomId: rawBody?.room?.roomId,
      role: rawBody?.room?.role,
      joined: rawBody?.room?.joined,
    };

    if (
      typeof reopenedRoom.roomId === "string" &&
      /^[0-9a-f-]{36}$/.test(reopenedRoom.roomId)
    )
      roomsToDelete.add(reopenedRoom.roomId);

    expect(reopenResponse.status()).toBe(201);
    expect(roomOpenRequestCount).toBe(1);
    expect(reopenedRoom).toEqual({
      ok: true,
      roomId: initialRoomId,
      role: "host",
      joined: true,
    });

    await expect(pageB.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      pageB.getByRole("button", { name: "Select Launch readiness" }),
    ).toBeVisible();
    await expect(
      pageB
        .getByLabel("Canvas coordinates")
        .getByText("Revision 3", { exact: true }),
    ).toBeVisible();
    expect(await readSupabaseAnonymousUserId(pageB)).toBe(initialUserId);
    expect(await readSessionRoomId(pageB)).toBe(initialRoomId);
    await expect(
      pageB.getByText("Demo room could not be created.", { exact: true }),
    ).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  } finally {
    roomCapture.stop();

    let cleanupError: unknown;
    try {
      for (const roomId of [...roomsToDelete].reverse()) {
        try {
          await deleteHostedRoom(cleanupPage, roomId);
        } catch (error) {
          cleanupError ??= error;
        }
      }
    } finally {
      await context.close();
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

async function readSupabaseAnonymousUserId(page: Page) {
  return page.evaluate(() => {
    const authKey = Object.keys(localStorage).find(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    );
    if (!authKey) return null;

    try {
      const stored = JSON.parse(localStorage.getItem(authKey) ?? "null") as {
        user?: { id?: unknown };
      } | null;
      return typeof stored?.user?.id === "string" ? stored.user.id : null;
    } catch {
      return null;
    }
  });
}
