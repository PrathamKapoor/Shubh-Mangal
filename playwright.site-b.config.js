import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/site-b-e2e", workers: 1, timeout: 45000,
  use: { baseURL: "http://127.0.0.1:5191", ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  webServer: [
    { command: "node tests/e2e-site-b-server.mjs", url: "http://127.0.0.1:3012/api/health", reuseExistingServer: false, timeout: 60000 },
    { command: "npm run dev -- --port 5191 --strictPort", url: "http://127.0.0.1:5191", env: { API_PROXY_TARGET: "http://127.0.0.1:3012", SITE_SOURCE_CONFIG: "tests/fixtures/second-site/source.json", VITE_GOOGLE_MAPS_ENABLED: "true", VITE_GOOGLE_MAPS_KEY: "fixture-key" }, reuseExistingServer: false, timeout: 60000 },
  ],
});
