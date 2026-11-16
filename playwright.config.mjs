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
    },
    { name: "firefox-smoke", testMatch: /cross-browser\.spec\.mjs/, use: { browserName: "firefox", viewport: { width: 1440, height: 1000 } } },
    { name: "webkit-smoke", testMatch: /cross-browser\.spec\.mjs/, use: { browserName: "webkit", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{projectName}/{arg}{ext}",
  webServer: {
    // The served site adds a rehearsal archive (the fixture's 2021 revision with its 2022
    // Supplement) so archive navigation is tested before a real rollover publishes one.
    command: "node scripts/build-edition-fixture.mjs --output .crawl/browser-editions && node scripts/build-site.mjs --editions-overlay .crawl/browser-editions/candidate/editions && node scripts/serve.mjs --base-path /CGS/",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
