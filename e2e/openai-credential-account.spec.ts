import { createHash, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { createTestOpenAiApiKey } from "../lib/testing/openai-key-fixture";

const enabled = process.env.OPENAI_CREDENTIAL_LIVE_PROBE === "true";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("verified account OpenAI credential", () => {
  test.skip(!enabled, "Set OPENAI_CREDENTIAL_LIVE_PROBE=true for the destructive-cleanup live probe.");
  test.skip(
    !supabaseUrl || !publishableKey || !secretKey,
    "Supabase browser and server test credentials are required.",
  );

  test("saves once, survives reload without returning the raw key, and deletes cleanly", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "Run the account lifecycle once in desktop Chromium.",
    );

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const browserAuth = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const suffix = crypto.randomUUID();
    const email = `commandcanvas-probe-${suffix}@example.com`;
    const authInput = `${randomBytes(24).toString("base64url")}aA9!`;
    const apiKey = createTestOpenAiApiKey(
      `commandcanvas-browser-probe-${suffix.replaceAll("-", "")}`,
    );
    const expectedFingerprint = `sha256:${createHash("sha256")
      .update(apiKey)
      .digest("hex")
      .slice(0, 16)}`;
    let userId: string | null = null;

    try {
      const created = await admin.auth.admin.createUser({
        email,
        password: authInput,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      expect(created.data.user?.id).toBeTruthy();
      userId = created.data.user!.id;

      const signedIn = await browserAuth.auth.signInWithPassword({
        email,
        password: authInput,
      });
      expect(signedIn.error).toBeNull();
      expect(signedIn.data.session).toBeTruthy();
      const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
      const storageKey = `sb-${projectRef}-auth-token`;
      await page.addInitScript(
        ({ key, session }) => {
          window.localStorage.setItem(key, JSON.stringify(session));
        },
        { key: storageKey, session: signedIn.data.session },
      );

      await page.goto("/meet");
      await expect(page.getByText(`Verified as ${email}`)).toBeVisible();
      await page.getByLabel("Room name").fill("Credential verification room");
      await page.getByLabel("Your display name").fill("Credential probe");
      await page.getByRole("button", { name: "Enter CommandCanvas" }).click();

      await expect(page.getByLabel("Spatial command surface")).toBeVisible({
        timeout: 20_000,
      });
      await page
        .getByRole("button", { name: "Open ChatGPT Site Tools and activity drawer" })
        .click();
      const keyInput = page.getByLabel("Your OpenAI API key");
      await expect(keyInput).toBeVisible();
      await keyInput.fill(apiKey);
      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/openai-credential") &&
          response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save key to my account" }).click();
      const saveResponse = await saveResponsePromise;
      const saveResponseText = await saveResponse.text();

      await expect(
        page.getByText("Saved to your CommandCanvas account"),
      ).toBeVisible({ timeout: 15_000 });
      await expect(keyInput).toHaveValue("");
      expect(saveResponse.ok()).toBe(true);
      expect(saveResponseText).not.toContain(apiKey);
      await expect(page.locator("body")).not.toContainText(apiKey);
      await expect(page.getByText(expectedFingerprint)).toBeVisible();
      await expectBrowserStorageNotToContain(page, apiKey);

      const reloadStatusPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/openai-credential") &&
          response.request().method() === "GET",
      );
      await page.reload();
      const reloadStatus = await reloadStatusPromise;
      const reloadStatusText = await reloadStatus.text();
      await expect(page.getByLabel("Spatial command surface")).toBeVisible({
        timeout: 20_000,
      });
      await page
        .getByRole("button", { name: "Open ChatGPT Site Tools and activity drawer" })
        .click();
      await expect(
        page.getByText("Saved to your CommandCanvas account"),
      ).toBeVisible({ timeout: 15_000 });
      expect(reloadStatus.ok()).toBe(true);
      expect(reloadStatusText).not.toContain(apiKey);
      await expect(page.locator("body")).not.toContainText(apiKey);
      await expectBrowserStorageNotToContain(page, apiKey);

      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/openai-credential") &&
          response.request().method() === "DELETE",
      );
      await page.getByRole("button", { name: "Remove saved key" }).click();
      await expect(
        page.getByRole("alertdialog", {
          name: "Confirm saved OpenAI key removal",
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Confirm remove saved key" })
        .click();
      const deleteResponse = await deleteResponsePromise;
      const deleteResponseText = await deleteResponse.text();
      await expect(
        page.getByText("Saved to your CommandCanvas account"),
      ).toHaveCount(0);
      expect(deleteResponse.ok()).toBe(true);
      expect(deleteResponseText).not.toContain(apiKey);
      await expect(page.locator("body")).not.toContainText(apiKey);
      await expectBrowserStorageNotToContain(page, apiKey);
    } finally {
      await cleanProbeState(admin, userId);
      await browserAuth.auth.signOut().catch(() => undefined);
    }
  });
});

async function cleanProbeState(
  admin: SupabaseClient,
  userId: string | null,
) {
  if (!userId) return;
  const cleanupErrors: string[] = [];
  const roomCleanup = await admin
    .from("rooms")
    .delete()
    .eq("created_by", userId);
  if (roomCleanup.error) {
    cleanupErrors.push(`room delete: ${roomCleanup.error.message}`);
  }

  const userCleanup = await admin.auth.admin.deleteUser(userId);
  if (userCleanup.error) {
    cleanupErrors.push(`user delete: ${userCleanup.error.message}`);
  }

  const roomResidue = await admin
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId);
  if (roomResidue.error) {
    cleanupErrors.push(`room residue check: ${roomResidue.error.message}`);
  } else if (roomResidue.count !== 0) {
    cleanupErrors.push(`room residue check: found ${roomResidue.count ?? "unknown"}`);
  }

  const credentialResidue = await admin.rpc(
    "get_user_openai_credential_status",
    { p_user_id: userId },
  );
  if (credentialResidue.error) {
    cleanupErrors.push(
      `credential residue check: ${credentialResidue.error.message}`,
    );
  } else {
    const status = credentialResidue.data as { configured?: unknown } | null;
    if (status?.configured !== false) {
      cleanupErrors.push("credential residue check: credential remains configured");
    }
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`Probe cleanup failed (${cleanupErrors.join("; ")})`);
  }
}

async function expectBrowserStorageNotToContain(
  page: import("@playwright/test").Page,
  secret: string,
) {
  const storage = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(storage.local).not.toContain(secret);
  expect(storage.session).not.toContain(secret);
}
