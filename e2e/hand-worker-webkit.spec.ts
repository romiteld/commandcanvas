import { expect, test } from "@playwright/test";

type WorkerResult = { type: "ready" } | { type: "error"; message: string };

test.skip(
  ({ browserName }) => browserName !== "webkit",
  "This regression exercises WebKit's module-worker runtime.",
);

test("initializes the local hand detector in an iPhone module worker without DOM globals", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.route("**/__hand-worker-webkit-bootstrap.js", async (route) => {
    await route.fulfill({
      contentType: "text/javascript",
      body: [
        'Object.defineProperty(globalThis, "importScripts", { configurable: true, value: undefined });',
        'await import("/workers/hand-landmarker.js");',
        'globalThis.postMessage({ type: "bootstrap-ready" });',
      ].join("\n"),
    });
  });
  await page.goto("/local");

  const result = await page.evaluate(
    () =>
      new Promise<{ type: "ready" } | { type: "error"; message: string }>(
        (resolve) => {
          const worker = new Worker("/__hand-worker-webkit-bootstrap.js", {
            type: "module",
            name: "commandcanvas-hand-tracker-regression",
          });
          const timeout = window.setTimeout(() => {
            worker.terminate();
            resolve({
              type: "error",
              message: "The local hand worker did not become ready in time.",
            });
          }, 45_000);

          worker.onmessage = (event: MessageEvent) => {
            const message = event.data as
              | { type: "bootstrap-ready" }
              | { type: "ready" }
              | { type: "error"; message: string };
            if (message.type === "bootstrap-ready") {
              worker.postMessage({
                type: "initialize",
                wasmBaseUrl: "/mediapipe/wasm",
                modelAssetUrl:
                  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              });
              return;
            }
            if (message.type !== "ready" && message.type !== "error") return;
            window.clearTimeout(timeout);
            worker.postMessage({ type: "dispose" });
            worker.terminate();
            resolve(message);
          };
          worker.onerror = (event) => {
            window.clearTimeout(timeout);
            worker.terminate();
            resolve({ type: "error", message: event.message });
          };
        },
      ),
  );

  expect(result).toEqual({ type: "ready" });
});

test("fails with an explicit fallback signal rather than touching the DOM when a worker canvas is unavailable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.route("**/__hand-worker-no-canvas-bootstrap.js", async (route) => {
    await route.fulfill({
      contentType: "text/javascript",
      body: [
        'Object.defineProperty(globalThis, "importScripts", { configurable: true, value: undefined });',
        'Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: undefined });',
        'await import("/workers/hand-landmarker.js");',
        'globalThis.postMessage({ type: "bootstrap-ready" });',
      ].join("\n"),
    });
  });
  await page.goto("/local");

  const result = await initializeWorker(
    page,
    "/__hand-worker-no-canvas-bootstrap.js",
  );

  expect(result).toEqual({
    type: "error",
    message:
      "Local hand tracking needs the browser's in-page fallback because OffscreenCanvas is unavailable.",
  });
});

async function initializeWorker(
  page: import("@playwright/test").Page,
  workerUrl: string,
) {
  return page.evaluate(
    (url) =>
      new Promise<WorkerResult>((resolve) => {
        const worker = new Worker(url, {
          type: "module",
          name: "commandcanvas-hand-tracker-no-canvas-regression",
        });
        const timeout = window.setTimeout(() => {
          worker.terminate();
          resolve({
            type: "error",
            message: "The local hand worker did not become ready in time.",
          });
        }, 45_000);

        worker.onmessage = (event: MessageEvent) => {
          const message = event.data as
            | { type: "bootstrap-ready" }
            | WorkerResult;
          if (message.type === "bootstrap-ready") {
            worker.postMessage({
              type: "initialize",
              wasmBaseUrl: "/mediapipe/wasm",
              modelAssetUrl:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            });
            return;
          }
          if (message.type !== "ready" && message.type !== "error") return;
          window.clearTimeout(timeout);
          worker.postMessage({ type: "dispose" });
          worker.terminate();
          resolve(message);
        };
        worker.onerror = (event) => {
          window.clearTimeout(timeout);
          worker.terminate();
          resolve({ type: "error", message: event.message });
        };
      }),
    workerUrl,
  );
}
