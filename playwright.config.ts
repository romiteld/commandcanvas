import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /webmcp-chrome153\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "webkit-mobile-safari",
      testMatch: /(realtime-input|hand-worker-webkit|landing-page)\.spec\.ts/,
      use: { ...devices["iPhone 15"] },
    },
    {
      name: "chrome-webmcp",
      testMatch: /webmcp-native\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ["--enable-features=WebMCP"] },
      },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          "npm run build && npm run start -- --hostname 127.0.0.1",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
