import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

test("opens two real no-signup browsers with Presence, cursors, and durable collaboration", async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_SUPABASE_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );

  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl)
    throw new Error("Supabase E2E server configuration is missing.");

  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const browserErrors: string[] = [];
  pageA.on("pageerror", (error) => browserErrors.push(`A: ${error.message}`));
  pageB.on("pageerror", (error) => browserErrors.push(`B: ${error.message}`));
  let roomId: string | null = null;

  try {
    await pageA.goto("/demo");
    await expect(pageA.getByText("Opening your no-signup demo room…")).toBeVisible();
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

    roomId = await pageA.evaluate(() => {
      const raw = sessionStorage.getItem("commandcanvas.demo.room.v1");
      return raw ? (JSON.parse(raw) as { roomId?: string }).roomId ?? null : null;
    });
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

    await pageA.screenshot({
      path: "/tmp/commandcanvas-checkpoint-4-realtime.png",
      fullPage: true,
    });
    expect(browserErrors).toEqual([]);
  } finally {
    await contextB.close();
    await contextA.close();
    if (roomId) {
      const service = createClient(supabaseUrl, serviceKey, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      });
      const cleanup = await service.from("rooms").delete().eq("id", roomId);
      if (cleanup.error) throw new Error("Supabase E2E room cleanup failed.");
    }
  }
});
