import { expect, test, type Page } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";

const recipient = process.env.COMMANDCANVAS_RESEND_TEST_RECIPIENT?.trim();

test("submits an explicitly approved packet to the configured Resend provider", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_RESEND_PROVIDER_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );
  test.setTimeout(120_000);
  if (!recipient || !recipient.includes("@") || recipient.endsWith("@example.com"))
    throw new Error(
      "COMMANDCANVAS_RESEND_TEST_RECIPIENT must be a real allowlisted address.",
    );

  const roomCapture = captureCreatedRoom(page);
  let roomId: string | null = null;

  try {
    await page.goto("/demo", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();
    expect(roomId).toMatch(/^[0-9a-f-]{36}$/);

    await openCommandDrawer(page);
    await page.getByRole("button", { name: "Prepare meeting packet" }).click();
    await expect(page.getByText("Draft v1")).toBeVisible({ timeout: 20_000 });

    await page
      .getByRole("textbox", { name: "Recipient 1 name" })
      .fill("Daniel Romitelli");
    await page
      .getByRole("textbox", { name: "Recipient 1 email" })
      .fill(recipient);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Approve packet" })).toBeEnabled();
    await page.getByRole("button", { name: "Approve packet" }).click();
    await expect(page.getByText("Approved packet v1").first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Request email send" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Send packet?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(recipient)).toBeVisible();

    const executeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/execute"),
    );
    await dialog.getByRole("button", { name: "SEND", exact: true }).click();
    const executeResponse = await executeResponsePromise;
    expect(executeResponse.status()).toBe(200);
    expect(await executeResponse.json()).toMatchObject({
      ok: true,
      send: {
        mode: "resend",
        status: "submitted",
        providerMessageId: expect.any(String),
        recipientCount: 1,
        message: "Submitted to Resend; delivery is pending.",
      },
    });
    await expect(
      page.getByText("Submitted to Resend; delivery pending"),
    ).toBeVisible();
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});

async function openCommandDrawer(page: Page) {
  const trigger = page.getByRole("button", { name: "Open command drawer" });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await expect(
    page.getByRole("complementary", { name: "Command drawer" }),
  ).toBeVisible();
}
