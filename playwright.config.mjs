import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./test/browser",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }]
  ],
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02
    }
  },
  use: {
    baseURL,
    colorScheme: "light",
    locale: "en-US",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 1000 }
      }
    },
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      }
    }
  ],
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{projectName}/{arg}{ext}",
  webServer: {
    command: "npm run build && npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
