import { expect, test } from "@playwright/test";
import { isMobileProject, openApp } from "./helpers.mjs";

test("Home exposes the core application destinations", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".home-intro")).toMatchAriaSnapshot(`
    - heading "Connecticut General Statutes" [level=1]
    - paragraph: Browse and search the statutes, the official subject index, and the Judicial Branch infraction schedule. Save frequently used material on this device.
  `);
  for (const name of ["Statutes", "Index", "Infractions", "Bookmarks", "Settings"]) {
    await expect(page.getByRole(name === "Settings" ? "button" : "link", { name: new RegExp(name) }).first()).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Settings closes and restores focus to its trigger", async ({ page }) => {
  await openApp(page);
  const trigger = page.getByRole("button", { name: "Settings" });
  await trigger.click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("desktop contextual rail retains its scroll position after section navigation", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Contextual rails are a desktop presentation.");
  await openApp(page, "#/t/17b/c/319v/s/17b-238");
  const sections = page.locator(".sections-column");
  const before = await sections.evaluate((element) => element.scrollTop);
  await sections.locator('a[href="#/t/17b/c/319v/s/17b-239"]').click();
  await expect(page).toHaveURL(/#\/t\/17b\/c\/319v\/s\/17b-239$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 17b-239/ })).toBeVisible();
  const after = await sections.evaluate((element) => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});

test("mobile chapter sheet closes and restores focus", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "The chapter sheet is a mobile reader control.");
  await openApp(page, "#/t/17b/c/319v/s/17b-238");
  const trigger = page.getByRole("button", { name: "Browse chapter" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Chapter 319v sections" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Boolean full-text search highlights phrase matches and can show more", async ({ page }) => {
  await openApp(page, "#/search?q=%22Effective%20January%22");
  await expect(page.locator("#search-status")).toContainText(/Showing 50 of [\d,]+ results/);
  await expect(page.locator("#results mark").first()).toHaveText(/Effective January/i);
  const more = page.getByRole("button", { name: /Show 50 more results/ });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator("#search-status")).toContainText(/Showing 100 of \d+ results/);
});

test("Search v2 preserves filters, explains the query, searches within results, and records history", async ({ page }) => {
  await openApp(page, "#/search?q=public&title=title-01&field=heading&sort=citation");
  await expect(page.locator("#search-title")).toHaveValue("title-01");
  await expect(page.locator("#search-field")).toHaveValue("heading");
  await expect(page.locator("#search-sort")).toHaveValue("citation");
  await expect(page.getByRole("heading", { level: 2, name: "public" })).toBeVisible();
  await expect(page.locator("#search-status")).toContainText(/Showing|No results/);

  await page.locator("#search-within-query").fill("records");
  await page.locator("[data-search-within]").getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/within=records/);
  await expect(page.getByRole("heading", { level: 2, name: "public AND records" })).toBeVisible();
  await page.locator(".search-history").click();
  await expect(page.locator(".search-history-list a").first()).toHaveAttribute("href", /within=records/);
});

test("bookmarks remain available on the device-local bookmarks page", async ({ page }) => {
  await openApp(page, "#/t/01/c/006/s/1-34");
  await page.getByRole("button", { name: /Bookmark/ }).click();
  await page.getByRole("link", { name: /Bookmarks 1 saved bookmark/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bookmarks" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sec\. 1-34/ })).toBeVisible();
});

test("print mode keeps statute text and removes application chrome", async ({ page }) => {
  await openApp(page, "#/t/01/c/006/s/1-34");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".context-column").first()).toBeHidden();
  await expect(page.locator("article.provision .statute-text")).toBeVisible();
});

test("the search shortcut moves focus to the omnisearch field", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("/");
  await expect(page.locator("#global-query")).toBeFocused();
});
