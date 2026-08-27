import { defineConfig, devices } from "@playwright/test";

import { assertLiveProbeTarget } from "./lib/testing/live-probe-guards";

const baseURL =
  process.env.WEBMCP_BASE_URL ?? "http://127.0.0.1:3000";
const executablePath =
  process.env.WEBMCP_CHROME_PATH ?? "/usr/bin/google-chrome";

assertLiveProbeTarget(
  baseURL,
  process.env.WEBMCP_LIVE_PROBE === "true",
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /webmcp-chrome153\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath,
      args: ["--enable-features=WebMCP"],
    },
  },
  projects: [{ name: "chrome-153-webmcp" }],
});
