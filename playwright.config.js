import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5181",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e-server.mjs",
      url: "http://127.0.0.1:3002/api/health",
      env: { E2E_TEST_MODE: "true" },
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npm run dev -- --port 5181 --strictPort",
      url: "http://127.0.0.1:5181",
      env: { API_PROXY_TARGET: "http://127.0.0.1:3002" },
      reuseExistingServer: false,
    },
  ],
});
