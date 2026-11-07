import { expect, test } from "@playwright/test";
import { isMobileProject, openApp, expectNoHighImpactAccessibilityViolations } from "./helpers.mjs";

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

  await page.locator(".site-header .brand").click();
  await expect(page.locator(".home-page")).toBeVisible();
  const homeBack = page.locator(".site-header").getByRole("button", { name: "Go back", exact: true });
  await expect(homeBack).toBeEnabled();
  await homeBack.click();
  await expect(page).toHaveURL(/#\/titles$/);
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
  await page.route("**/data/chapters/001.json*", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.evaluate(() => { location.hash = "#/t/01/c/001"; });
  await expect(page.locator("main.error")).toBeVisible();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/#\/titles$/);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".page-history-list li")).toHaveCount(1);
});

test("the phone header centers the brand with Back in the top-left corner", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Checks the phone layout.");
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 780 });
    for (const route of ["#/", "#/search"]) {
      await openApp(page, route);
      const layout = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const brand = box(".site-header .brand");
        const back = box(".site-header .navigation-back");
        return { viewport: document.documentElement.clientWidth, brandLeft: brand.left, brandRight: brand.right, brandTop: brand.top, backLeft: back.left, backRight: back.right, backTop: back.top };
      });
      expect(Math.abs((layout.brandLeft + layout.brandRight) / 2 - layout.viewport / 2), `brand centered at ${width}px on ${route}`).toBeLessThanOrEqual(1);
      expect(layout.backLeft, `Back on the left at ${width}px on ${route}`).toBeLessThanOrEqual(17);
      expect(Math.abs(layout.backTop - layout.brandTop), `Back level with the brand at ${width}px on ${route}`).toBeLessThanOrEqual(1);
      expect(layout.backRight, `Back clear of the brand at ${width}px on ${route}`).toBeLessThanOrEqual(layout.brandLeft);
    }
  }
});

test("the Statutes tab opens the title list on phones and Home on desktop", async ({ page }, testInfo) => {
  await openApp(page, "#/acts");
  const statutes = page.locator(".app-nav > a").first();
  await statutes.click();
  if (isMobileProject(testInfo)) {
    await expect(page).toHaveURL(/#\/titles$/);
    await expect(page.locator(".titles-page")).toBeVisible();
    await page.locator(".site-header .brand").click();
    await expect(page.locator(".home-page")).toBeVisible();
  } else {
    await expect(page.locator(".home-page")).toBeVisible();
  }

  const compact = isMobileProject(testInfo);
  await page.setViewportSize(compact ? { width: 1280, height: 800 } : { width: 375, height: 780 });
  await expect(statutes).toHaveAttribute("href", compact ? "#/" : "#/titles");
});
