import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  outputDir: "audit-output/playwright-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "audit-output/playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3007",
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_SYSTEM_CHROME === "1"
          ? { channel: "chrome" }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: "node audit-output/test-build/tests/fixtures/browser-api.js",
      url: "http://127.0.0.1:4007/health",
      reuseExistingServer: process.env.PW_REUSE_FIXTURES === "1",
      timeout: 60000,
      env: { NODE_ENV: "test" },
    },
    {
      command: "node scripts/run-browser-web.mjs",
      url: "http://127.0.0.1:3007",
      reuseExistingServer: process.env.PW_REUSE_FIXTURES === "1",
      timeout: 90000,
      env: { NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
