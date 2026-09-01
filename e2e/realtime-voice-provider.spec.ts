import { expect, test } from "@playwright/test";

import {
  captureCreatedRoom,
  deleteHostedRoom,
} from "./support/hosted-room";
import { enterLimitedJudgePreview } from "./support/limited-judge-preview";

const fakeAudioPath = process.env.PLAYWRIGHT_FAKE_AUDIO_PATH;
const providerOpenAiKey = process.env.COMMANDCANVAS_PROVIDER_OPENAI_KEY;

test.use({
  permissions: ["microphone"],
  trace: "off",
  screenshot: "off",
  video: "off",
  launchOptions: fakeAudioPath
    ? {
        args: [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-audio-capture=${fakeAudioPath}%noloop`,
        ],
      }
    : undefined,
});

test("regular GPT Realtime hears speech and submits a canonical canvas mutation", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_OPENAI_PROVIDER_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop" ||
      !fakeAudioPath ||
      !providerOpenAiKey,
  );
  test.setTimeout(90_000);

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const roomCapture = captureCreatedRoom(page);
  let roomId: string | null = null;

  try {
    await page.addInitScript(() => {
      const summaries: Array<Record<string, unknown>> = [];
      const original = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function (...args) {
        const channel = original.apply(this, args);
        channel.addEventListener("message", (event) => {
          try {
            const value = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (value.type === "response.output_audio.delta") return;
            const item =
              value.item && typeof value.item === "object"
                ? (value.item as Record<string, unknown>)
                : null;
            const response =
              value.response && typeof value.response === "object"
                ? (value.response as Record<string, unknown>)
                : null;
            summaries.push({
              type: value.type,
              name: value.name ?? item?.name,
              itemType: item?.type,
              callId: value.call_id ?? item?.call_id,
              outputTypes: Array.isArray(response?.output)
                ? response.output.map((entry) =>
                    entry && typeof entry === "object"
                      ? (entry as Record<string, unknown>).type
                      : null,
                  )
                : undefined,
            });
            if (summaries.length > 200) summaries.shift();
          } catch {
            // The provider test records only parseable event metadata.
          }
        });
        return channel;
      };
      Object.defineProperty(window, "__commandCanvasRealtimeEventSummaries", {
        configurable: true,
        value: summaries,
      });
    });
    await page.goto("/demo");
    await enterLimitedJudgePreview(page);
    await expect(page.getByText("Live demo room")).toBeVisible({
      timeout: 20_000,
    });
    roomId = await roomCapture.resolveRoomId();

    await page
      .getByRole("button", { name: "Open ChatGPT Site Tools and activity drawer" })
      .click();
    await page
      .getByLabel("Your OpenAI API key")
      .fill(providerOpenAiKey!);
    await page.getByRole("button", { name: "Start live voice" }).click();

    await expect(page.getByText("Listening", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("list", { name: "Live voice transcript" }),
    ).toContainText(/project board/i, { timeout: 30_000 });
    try {
      await expect(
        page.getByRole("button", { name: "Select Project Board" }),
      ).toBeVisible({ timeout: 30_000 });
      const activityReceipt = page.getByRole("button", {
        name: "Open activity drawer: Daniel created “Project Board”.",
      });
      await expect(activityReceipt).toBeVisible({ timeout: 30_000 });
      await expect(
        activityReceipt.getByText("R4 · voice", { exact: true }),
      ).toBeVisible({
        timeout: 15_000,
      });
      expect(browserErrors).toEqual([]);
    } finally {
      const providerEvents = await page.evaluate(
        () =>
          (
            window as typeof window & {
              __commandCanvasRealtimeEventSummaries?: Array<
                Record<string, unknown>
              >;
            }
          ).__commandCanvasRealtimeEventSummaries ?? [],
      );
      await testInfo.attach("realtime-provider-event-types.json", {
        body: Buffer.from(JSON.stringify(providerEvents, null, 2)),
        contentType: "application/json",
      });
    }
  } finally {
    try {
      roomId ??= await roomCapture.resolveRoomId();
    } finally {
      roomCapture.stop();
    }
    if (roomId) await deleteHostedRoom(page, roomId);
  }
});
