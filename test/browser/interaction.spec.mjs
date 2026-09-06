import { expect, test } from "@playwright/test";
import { isMobileProject, openApp } from "./helpers.mjs";

test("statute ranges link both endpoints and navigate to the referenced section", async ({ page }) => {
  await openApp(page, "#/t/04/c/050/s/4-66aa");
  const statute = page.locator("article.provision .statute-text");
  await expect(statute.getByRole("link", { name: "10-409", exact: true })).toHaveAttribute("href", "#/t/10/c/184b/s/10-409");
  const endpoint = statute.getByRole("link", { name: "10-415", exact: true });
  await expect(endpoint).toHaveAttribute("href", "#/t/10/c/184b/s/10-415");
  await endpoint.click();
  await expect(page).toHaveURL(/#\/t\/10\/c\/184b\/s\/10-415$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 10-415\./ })).toBeVisible();
});

test("Public Act references link to CGA from statute text and reference notes", async ({ page }) => {
  await openApp(page, "#/t/04a/c/058/s/4a-52a");
  const href = "https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Public+Act&which_year=1993&bill_num=336";
  const act = page.locator("article.provision .statute-text").getByRole("link", { name: "93-336", exact: true });
  await expect(act).toHaveAttribute("href", href);
  await expect(act).toHaveAttribute("target", "_blank");
  await expect(act).toHaveAttribute("rel", "noopener noreferrer");
  const notes = page.locator(".information-references");
  await expect(notes.locator(`a[href="${href}"]`)).toHaveCount(1);
  await expect(notes.locator('a[href*="which_year=1993&bill_num=201"]')).toHaveCount(2);
  await expect(notes.getByRole("link", { name: "88-192", exact: true })).toHaveCount(0);
});

test("abbreviated See references in 2-71h link to the referenced statutes", async ({ page }) => {
  await openApp(page, "#/t/02/c/018a/s/2-71h");
  const statute = page.locator("article.provision .statute-text");
  for (const [citation, href] of [
    ["4b-54", "#/t/04b/c/060/s/4b-54"],
    ["5-142", "#/t/05/c/065/s/5-142"],
    ["5-145a", "#/t/05/c/065/s/5-145a"],
    ["29-8a", "#/t/29/c/529/s/29-8a"],
    ["53-39a", "#/t/53/c/939/s/53-39a"]
  ]) {
    await expect(statute.getByRole("link", { name: citation, exact: true })).toHaveAttribute("href", href);
  }
  await expect(statute.locator("p").filter({ hasText: "See Sec. 4b-54(b)" })).toBeVisible();
  await statute.getByRole("link", { name: "4b-54", exact: true }).click();
  await expect(page).toHaveURL(/#\/t\/04b\/c\/060\/s\/4b-54$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 4b-54\./ })).toBeVisible();
});

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

test("About links to the deployed GitHub release", async ({ page }) => {
  await openApp(page, "#/about");
  const release = page.locator(".about-version a");
  await expect(release).toHaveText(/^v\d+\.\d+\.\d+ ↗$/);
  const version = (await release.textContent()).trim().split(" ")[0];
  await expect(release).toHaveAttribute("href", `https://github.com/UConn-Law-Library/CGS/releases/tag/${version}`);
});

test("About shows recent updates and expands earlier changes", async ({ page }, testInfo) => {
  await openApp(page, "#/about");
  const updates = page.getByRole("region", { name: "Recent updates" });
  await expect(updates.getByRole("heading", { name: "Recent updates", exact: true })).toBeVisible();
  const recent = updates.getByRole("list", { name: "Latest updates", exact: true });
  await expect(recent.locator("li")).toHaveCount(3);
  const latestTitle = await page.evaluate(async () => (await import("/release.js")).RECENT_UPDATES[0].title);
  await expect(recent.getByRole("heading", { level: 3 }).first()).toHaveText(latestTitle);
  await expect(recent.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(recent.getByRole("link").first()).toHaveAttribute("href", /^https:\/\/github\.com\/UConn-Law-Library\/CGS\/commit\/[a-f0-9]{40}$/);
  await updates.screenshot({ path: testInfo.outputPath("recent-updates.png") });
  const earlier = updates.getByRole("list", { name: "Earlier updates", exact: true });
  await expect(earlier).toBeHidden();
  await updates.locator("summary").click();
  await expect(earlier).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
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
