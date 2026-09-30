// Playwright runs the prototype page in WebKit and Chromium with the iPhone 14 Pro Max
// landscape descriptor (814 x 380 with touch). The descriptor's viewport already takes
// Safari's toolbars off; tests that need the full 932x430 screen resize the page.
// Chromium runs at device scale 1: the CI runners have no GPU, and Chromium's software
// renderer at scale 3 (9x the pixels) starved the page's main thread so badly that the
// timed gestures (350 ms long press, 300 ms double tap) could not be tested (run
// 36669779106). WebKit keeps the iPhone's scale 3.

import { defineConfig, devices } from "@playwright/test";

const phone = devices["iPhone 14 Pro Max landscape"];

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 60_000,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:4173/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "webkit", use: { ...phone, browserName: "webkit" } },
    { name: "chromium", use: { ...phone, browserName: "chromium", deviceScaleFactor: 1 } },
  ],
});
