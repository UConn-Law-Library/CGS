import { expect, test } from "@playwright/test";
import { openApp } from "./helpers.mjs";

for (const [name, destination, path] of [
  ["chapter", "#/t/01/c/001", "**/data/chapters/001.json"],
  ["supplement", "#/t/01/c/001", "**/data/supplements/2026/chapters/001.json"],
  ["section references", "#/t/01/c/001/s/1-1", "**/data/secondary/links/title-01.json"],
  ["index", "#/index", "**/data/secondary/statutes-index/manifest.json"],
  ["index letter", "#/index/a", "**/data/secondary/statutes-index/a-01.json"],
  ["infractions", "#/infractions", "**/data/secondary/infractions/manifest.json"],
  ["about", "#/about", "**/data/secondary/manifest.json"]
]) {
  test(`a delayed ${name} page cannot overwrite newer navigation`, async ({ page }) => {
    await openApp(page);
    const requested = Promise.withResolvers();
    const release = Promise.withResolvers();
    await page.route(path, async (route) => {
      requested.resolve();
      await release.promise;
      await route.continue();
    });
    await page.evaluate((hash) => { location.hash = hash; }, destination);
    await requested.promise;
    try {
      await page.evaluate(() => { location.hash = "#/bookmarks"; });
      await expect(page.getByRole("heading", { level: 1, name: "Bookmarks", exact: true })).toBeVisible();
    } finally {
      release.resolve();
    }
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Bookmarks", exact: true })).toBeVisible();
    await expect(page).toHaveTitle(/Bookmarks/);
    await expect(page).toHaveURL(/#\/bookmarks$/);
    expect(await page.evaluate((href) => JSON.parse(localStorage.getItem("cgs.page-history.v1") ?? "[]").some((item) => item.href === href), destination)).toBe(false);
  });
}

test("a failed chapter load displays an error and can be retried", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "#/bookmarks");
  await page.route("**/data/chapters/001.json", (route) => route.fulfill({ status: 503, body: "Unavailable" }), { times: 1 });
  await page.evaluate(() => { location.hash = "#/t/01/c/001"; });
  await expect(page.locator("main.error")).toContainText("503");
  await page.evaluate(() => { location.hash = "#/bookmarks"; });
  await expect(page.getByRole("heading", { level: 1, name: "Bookmarks", exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = "#/t/01/c/001"; });
  await expect(page.getByRole("heading", { level: 1, name: /Chapter 1/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a failed load explains itself and retries in place", async ({ page }) => {
  await openApp(page, "#/bookmarks");
  await page.route("**/data/chapters/001.json", (route) => route.fulfill({ status: 503, body: "Unavailable" }), { times: 1 });
  await page.evaluate(() => { location.hash = "#/t/01/c/001"; });
  await expect(page.getByRole("heading", { level: 1, name: "The statutes could not be loaded" })).toBeFocused();
  await expect(page.locator(".load-failure-detail")).toContainText("503");
  await expect(page).toHaveTitle(/^Could not load/);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Chapter 1/ })).toBeVisible();
  await expect(page).toHaveURL(/#\/t\/01\/c\/001$/);
});

test("the not-found page keeps its styles and home link at any path depth", async ({ page }) => {
  await page.goto("/a/b/missing");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  expect(await page.locator("main").evaluate((main) => getComputedStyle(main).textAlign)).toBe("center");
  await expect(page.getByRole("link", { name: /Return to the Connecticut General Statutes/ }))
    .toHaveJSProperty("href", new URL("/", page.url()).href);
});

test("a late chapter failure cannot replace the current page with an error", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page);
  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route("**/data/chapters/001.json", async (route) => {
    requested.resolve();
    await release.promise;
    await route.fulfill({ status: 503, body: "Unavailable" });
  });
  await page.evaluate(() => { location.hash = "#/t/01/c/001"; });
  await requested.promise;
  try {
    await page.evaluate(() => { location.hash = "#/bookmarks"; });
    await expect(page.getByRole("heading", { level: 1, name: "Bookmarks", exact: true })).toBeVisible();
  } finally {
    release.resolve();
  }
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "Bookmarks", exact: true })).toBeVisible();
  await expect(page.locator("main.error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
