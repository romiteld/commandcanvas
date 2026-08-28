import { expect, test } from "@playwright/test";

import { YOLO_HAND_POSE_MODEL_URL } from "../lib/gesture/yolo-hand-pose-detector";

const MODEL_URL = YOLO_HAND_POSE_MODEL_URL;

test("loads the pinned YOLO 21-keypoint model and completes one browser inference", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_YOLO_HAND_POSE_E2E !== "true" ||
      testInfo.project.name !== "chromium-desktop",
  );
  test.setTimeout(180_000);
  const responses: Array<{ url: string; status: number }> = [];
  const requestedModels: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === MODEL_URL)
      requestedModels.push(new URL(request.url()).pathname);
  });
  page.on("response", (response) => {
    if (
      response.url().includes("/workers/yolo-hand-pose.js") ||
      response.url().includes("/onnxruntime/") ||
      new URL(response.url()).pathname === MODEL_URL
    )
      responses.push({ url: response.url(), status: response.status() });
  });

  await page.goto("/");
  const observation = await page.evaluate(async ({ modelUrl }) => {
    const worker = new Worker("/workers/yolo-hand-pose.js", {
      type: "module",
      name: "commandcanvas-yolo-smoke",
    });
    const waitFor = <T extends { type: string }>(type: T["type"]) =>
      new Promise<T>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error(`YOLO worker timed out waiting for ${type}.`)),
          150_000,
        );
        const onMessage = (event: MessageEvent<T | { type: "error"; message: string }>) => {
          if (event.data.type === "error" && "message" in event.data) {
            window.clearTimeout(timeout);
            worker.removeEventListener("message", onMessage);
            reject(new Error(event.data.message));
            return;
          }
          if (event.data.type !== type) return;
          window.clearTimeout(timeout);
          worker.removeEventListener("message", onMessage);
          resolve(event.data as T);
        };
        worker.addEventListener("message", onMessage);
      });
    try {
      const ready = waitFor<{ type: "ready" }>("ready");
      worker.postMessage({
        type: "initialize",
        wasmBaseUrl: "/onnxruntime/",
        modelAssetUrl: modelUrl,
      });
      await ready;
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Smoke-test canvas is unavailable.");
      context.fillStyle = "#161b24";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const bitmap = await createImageBitmap(canvas);
      const result = waitFor<{
        type: "result";
        timestamp: number;
        hands: Array<{ landmarks: unknown[] }>;
      }>("result");
      worker.postMessage(
        { type: "frame", frame: bitmap, timestamp: 12_345 },
        [bitmap],
      );
      return await result;
    } finally {
      worker.postMessage({ type: "dispose" });
      worker.terminate();
    }
  }, { modelUrl: MODEL_URL });

  expect(observation.type).toBe("result");
  expect(observation.timestamp).toBe(12_345);
  for (const hand of observation.hands)
    expect(hand.landmarks).toHaveLength(21);
  expect(
    responses.some(
      ({ url, status }) =>
        new URL(url).pathname === "/workers/yolo-hand-pose.js" && status === 200,
    ),
  ).toBe(true);
  expect(
    responses.some(
      ({ url, status }) => url.includes("/onnxruntime/") && status === 200,
    ),
  ).toBe(true);
  expect(requestedModels).toContain(MODEL_URL);
});
