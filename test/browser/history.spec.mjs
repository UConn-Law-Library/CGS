import { expect, test } from "@playwright/test";
import { openApp, expectNoHighImpactAccessibilityViolations } from "./helpers.mjs";

test("Back follows the browser trail across reload, forward, and a new branch", async ({ page }) => {
  await openApp(page, "#/titles");
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeDisabled();
  await page.locator('main a[href="#/t/01"]').click();
  await expect(page).toHaveTitle(/^Title 1/);
  await page.evaluate(() => { location.hash = "#/t/01/c/001/s/1-1"; });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sec. 1-1");
  await page.reload();
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/#\/t\/01$/);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sec. 1-1");
  await page.goBack();
  await expect(page).toHaveTitle(/^Title 1/);
  await page.getByRole("link", { name: /Bookmarks/ }).first().click();
  await expect(page).toHaveTitle(/^Bookmarks/);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveTitle(/^Title 1/);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/#\/titles$/);
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeDisabled();
});

test("History persists visited pages, reopens them, and clears without deleting bookmarks", async ({ page }, testInfo) => {
  await openApp(page, "#/titles");
  for (const [href, title] of [["#/t/01", /^Title 1/], ["#/t/01/c/001", /^Chapter 1/], ["#/search?q=law&title=title-01", /^Search: law/], ["#/index", /^Statutes index/], ["#/infractions", /^Infractions/]]) {
    await page.evaluate((hash) => { location.hash = hash; }, href);
    await expect(page).toHaveTitle(title);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cgs.page-history.v1") ?? "[]")[0]?.href)).toBe(href);
  }
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await expect(page.locator(".page-history-list li")).toHaveCount(6);
  await expect(page.locator(".page-history-list li").first()).toContainText("Infractions");
  await page.reload();
  await expect(page.locator(".page-history-list li")).toHaveCount(6);
  await expectNoHighImpactAccessibilityViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("history.png") });
  await page.locator('.page-history-list a[href="#/t/01/c/001"]').click();
  await expect(page).toHaveTitle(/^Chapter 1/);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".page-history-list li")).toHaveCount(6);
  await expect(page.locator(".page-history-list li").first()).toContainText("Chapter 1");
  await page.evaluate(() => localStorage.setItem("cgs.bookmarks.v1", JSON.stringify([{ id: "saved", href: "#/t/01" }])));
  await page.getByRole("button", { name: "Clear history", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("No browsing history yet");
  await page.reload();
  await expect(page.locator(".page-history-list li")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cgs.bookmarks.v1")).length)).toBe(1);
});

test("a canonicalized legacy link remains the first page of the Back trail", async ({ page }) => {
  await page.goto("/?chapter=001&section=section-1-1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sec. 1-1");
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".page-history-list a")).toHaveAttribute("href", "#/t/01/c/001/s/1-1");
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sec. 1-1");
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeDisabled();
});

test("failed routes offer Back and do not enter visited-page history", async ({ page }) => {
  await openApp(page, "#/titles");
  await page.route("**/data/chapters/001.json", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.evaluate(() => { location.hash = "#/t/01/c/001"; });
  await expect(page.locator("main.error")).toBeVisible();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/#\/titles$/);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".page-history-list li")).toHaveCount(1);
});
