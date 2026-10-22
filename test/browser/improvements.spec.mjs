import { expect, test } from "@playwright/test";
import { openApp } from "./helpers.mjs";

test("startup recovers when the first catalog request fails", async ({ page }) => {
  let attempts = 0;
  await page.route("**/data/catalog.json*", (route) => ++attempts === 1 ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
  await page.goto("/");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Connecticut General Statutes", exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test("reader is ready while amendment information is delayed, then reports failure honestly", async ({ page }) => {
  const release = Promise.withResolvers();
  await page.route("**/data/acts/amendments.json*", async (route) => { await release.promise; await route.fulfill({ status: 503, body: "unavailable" }); });
  try {
    await page.goto("/#/t/01/c/001/s/1-1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".statute-text")).toBeVisible();
    await expect(page.locator("[data-amendments-status]")).toContainText("Amendment information loading");
    await expect(page.locator("main > .source-note")).toContainText("2025 revision with the 2026 Supplement");
  } finally { release.resolve(); }
  await expect(page.locator("[data-amendments-status]")).toContainText("Amendment information is unavailable");
  await expect(page.locator(".statute-text")).toBeVisible();
});

test("blocked bookmark storage remains usable and can be exported and imported locally", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Blocked", "QuotaExceededError"); }; });
  await openApp(page, "#/t/01/c/001/s/1-1");
  await page.locator("[data-bookmark-id]").click();
  await expect(page.locator(".action-status")).toContainText(/temporary|temporarily/i);
  await page.evaluate(() => { location.hash = "#/bookmarks"; });
  await expect(page.locator("[data-remove-bookmark]")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export bookmarks" }).click();
  const file = await download;
  const filename = await file.path();
  await page.locator("[data-remove-bookmark]").click();
  await page.locator("[data-bookmark-file]").setInputFiles(filename);
  await expect(page.locator("[data-remove-bookmark]")).toHaveCount(1);
  await expect(page.locator("[data-bookmark-status]")).toContainText("1 bookmarks imported");
  await page.reload();
  await expect(page.locator("[data-remove-bookmark]")).toHaveCount(0);
});

test("autocomplete loads headings and citation maps without full search bodies", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await openApp(page);
  await page.locator("[data-omni-input]").fill("public records");
  await expect(page.locator("[data-omni-panel]")).toContainText("Section");
  expect(requests.some((url) => /\/search\/title-/.test(url))).toBe(false);
  expect(requests.some((url) => /\/search-v2\/auxiliary\//.test(url))).toBe(false);
  expect(requests.some((url) => /\/search-v2\/headings\//.test(url))).toBe(true);
});

test("both guides report the same supplement under the Pages deployment path", async ({ page }) => {
  await page.goto("/CGS/#/guide");
  const link = page.getByRole("link", { name: "Read the full guide on one page" });
  await expect(link).toBeVisible();
  await expect(page.locator(".guide-page")).toContainText("2026 Supplement");
  await link.click();
  await expect(page).toHaveURL(/\/CGS\/discover\/understanding-the-statutes\/$/);
  await expect(page.locator("main")).toContainText("2026 Supplement");
  await expect(page.locator('a[href="../../index.html#/guide"]')).toBeVisible();
});

test("JavaScript-disabled visitors can open the expanded guide directly", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4173/CGS/");
    await page.locator('noscript a[href="./discover/understanding-the-statutes/"]').click();
    await expect(page).toHaveURL(/\/CGS\/discover\/understanding-the-statutes\/$/);
    await expect(page.locator("main")).toContainText("2026 Supplement");
  } finally { await context.close(); }
});
