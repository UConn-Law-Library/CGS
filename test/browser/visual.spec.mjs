import { expect, test } from "@playwright/test";
import { isMobileProject, openApp } from "./helpers.mjs";

test("desktop Home visual contract", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Desktop baseline.");
  await openApp(page);
  await expect(page).toHaveScreenshot("home.png", { fullPage: false });
});

test("desktop search-results visual contract", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Desktop baseline.");
  await openApp(page, "#/search");
  await page.locator("#search-page-query").fill('"Effective January"');
  await page.locator("#search-title").selectOption("title-13b");
  await page.locator("[data-search-refine]").getByRole("button", { name: "Search" }).click();
  await expect(page.locator("#search-status")).toContainText(/Showing \d+ of \d+ results?/);
  await expect(page).toHaveScreenshot("search-results.png", { fullPage: false });
});

test("mobile statute-reader visual contract", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Mobile baseline.");
  await openApp(page, "#/t/01/c/004/s/1-24");
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 1-24/ })).toBeVisible();
  await expect(page).toHaveScreenshot("statute-reader.png", { fullPage: false });
});
