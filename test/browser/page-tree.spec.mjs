import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, isMobileProject, openApp } from "./helpers.mjs";

const turnTreeOn = async (page, route = "#/") => {
  await openApp(page, route);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("[data-navigation-tree]").check();
  await expect(page.locator(".statute-tree-column")).toBeVisible();
  await page.locator("[data-close-settings]").click();
};
const rail = (page) => page.locator("#rail-statute-tree");
const desktopOnly = (testInfo) => test.skip(isMobileProject(testInfo), "panes are desktop only");

test("the panes stay the default, and the setting swaps them and persists", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openApp(page, "#/t/01/c/001");
  await expect(page.locator(".context-column")).toHaveCount(3);
  await expect(page.locator(".statute-tree-column")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  const setting = page.getByRole("checkbox", { name: /Page tree navigation/ });
  await expect(setting).not.toBeChecked();
  await setting.check();
  await expect(page.locator(".context-column")).toHaveCount(1);
  await expect(page.locator(".statute-tree-column")).toBeVisible();
  await expect(page.locator("[data-settings-panel]")).toBeVisible();
  await expect(page.locator("[data-navigation-tree]")).toBeFocused();
  await page.reload();
  await expect(page.locator(".statute-tree-column")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("[data-navigation-tree]").uncheck();
  await expect(page.locator(".context-column")).toHaveCount(3);
});

test("the tree opens to the current section, in view, and marks only that row current", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await turnTreeOn(page);
  await page.goto("/#/t/11/c/190/s/11-24b");
  const current = rail(page).locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("11-24b");
  await expect(rail(page).locator(".tree-title")).toHaveCount(81);
  await expect(rail(page).locator(".tree-chapter")).toHaveCount(6);
  await expect(page.locator("[data-amendments-status]")).not.toContainText("loading");
  await expect(current).toBeInViewport();
  await expectNoHighImpactAccessibilityViolations(page);
});

test("chevrons open and close rows without navigating, and links navigate and open", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await turnTreeOn(page);
  const startUrl = page.url();
  const expand = rail(page).getByRole("button", { name: "Expand Title 11", exact: true });
  await expand.click();
  expect(page.url()).toBe(startUrl);
  const collapse = rail(page).getByRole("button", { name: "Collapse Title 11", exact: true });
  await expect(collapse).toBeFocused();
  await rail(page).getByRole("button", { name: "Expand Chapter 190", exact: true }).click();
  await expect(rail(page).getByRole("link", { name: /§ 11-22/ })).toBeVisible();
  await expect(rail(page).locator(".tree-chapter")).toHaveCount(6);
  await collapse.click();
  await expect(rail(page).locator(".tree-chapter")).toHaveCount(0);
  await rail(page).getByRole("link", { name: /^Title 2c/ }).click();
  await expect(page).toHaveURL(/#\/t\/02c$/);
  await expect(page.locator(".tree-row.is-path")).toHaveCount(1);
  await rail(page).locator(".tree-chapter a").first().click();
  await expect(page).toHaveURL(/#\/t\/02c\/c\//);
  await rail(page).locator(".tree-sections a").first().click();
  await expect(page).toHaveURL(/#\/t\/02c\/c\/[^/]+\/s\//);
  await expect(page.locator("main h1")).toBeVisible();
  // Earlier rows stay open across page changes.
  await expect(rail(page).getByRole("button", { name: "Collapse Title 2c", exact: true })).toBeVisible();
});

test("the filter reaches titles, chapters and sections, across every title", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await turnTreeOn(page);
  const filter = page.getByLabel("Filter titles, chapters, and sections");
  const status = page.locator("[data-tree-filter-status]");
  await filter.fill("libraries and museums");
  await expect(rail(page).locator(".tree-title")).toHaveCount(1);
  await expect(status).toHaveText("1 title.");
  await filter.fill("public libraries");
  await expect(status).not.toContainText("Searching");
  await expect(rail(page).getByRole("link", { name: /^Chapter 190/ })).toBeVisible();
  await filter.fill("security deposit");
  await expect(status).toContainText(/\d+ sections?/);
  await expect(status).not.toContainText("0 ");
  const section = rail(page).locator(".tree-sections a").first();
  await expect(section).toBeVisible();
  await expect(filter).toBeFocused();
  await filter.fill("11-24b");
  await expect(rail(page).locator(".tree-sections a")).toHaveCount(1);
  await expect(rail(page).locator(".tree-sections a")).toContainText("11-24b");
  await filter.fill("§ 11-24b");
  await expect(rail(page).locator(".tree-sections a")).toHaveCount(1);
  await filter.fill("tax");
  await expect(status).toContainText("Showing the first 200 sections");
  await expect(rail(page).locator(".tree-sections > li")).toHaveCount(200);
  await filter.fill("zzzzzz");
  await expect(status).toHaveText("No matching titles, chapters, or sections.");
  await filter.fill("");
  await expect(status).toBeEmpty();
  await expect(rail(page).locator(".tree-title")).toHaveCount(81);
});

test("a filter survives opening a result, and clearing it returns to the open section", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await turnTreeOn(page);
  const filter = page.getByLabel("Filter titles, chapters, and sections");
  await filter.fill("11-24b");
  await rail(page).locator(".tree-sections a").first().click();
  await expect(page).toHaveURL(/#\/t\/11\/c\/190\/s\/11-24b$/);
  await expect(page.getByLabel("Filter titles, chapters, and sections")).toHaveValue("11-24b");
  await expect(rail(page).locator('.tree-sections a[aria-current="page"]')).toHaveCount(1);
  await page.getByLabel("Filter titles, chapters, and sections").fill("");
  const current = rail(page).locator('[aria-current="page"]');
  await expect(current).toContainText("11-24b");
  await expect(current).toBeInViewport();
});

test("a row that only matches itself opens to all its children during a filter", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await turnTreeOn(page);
  await page.getByLabel("Filter titles, chapters, and sections").fill("libraries and museums");
  await expect(rail(page).locator(".tree-chapter")).toHaveCount(0);
  await rail(page).getByRole("button", { name: "Expand Title 11", exact: true }).click();
  await expect(rail(page).locator(".tree-chapter")).toHaveCount(6);
});

test("a heading index that fails to load says so and offers the chapter", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await turnTreeOn(page);
  await page.route("**/data/search-v2/headings/title-11.json*", (route) => route.abort());
  await rail(page).getByRole("button", { name: "Expand Title 11", exact: true }).click();
  await rail(page).getByRole("button", { name: "Expand Chapter 190", exact: true }).click();
  await expect(rail(page)).toContainText("Sections could not be loaded");
  await expect(rail(page).locator(".tree-message a")).toHaveAttribute("href", /#\/t\/11\/c\/190$/);
});

test("the tree keeps its own width, separate from the Titles pane", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openApp(page, "#/t/01/c/001");
  const widthOf = (selector) => page.locator(selector).evaluate((element) => Math.round(element.getBoundingClientRect().width));
  const titlesBefore = await widthOf(".titles-column");
  await turnTreeOn(page, "#/t/01/c/001");
  expect(await widthOf(".statute-tree-column")).toBe(320);
  const handle = page.locator(".context-resizer");
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 42, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => widthOf(".statute-tree-column")).toBe(360);
  await page.reload();
  await expect.poll(() => widthOf(".statute-tree-column")).toBe(360);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("[data-navigation-tree]").uncheck();
  expect(await widthOf(".titles-column")).toBe(titlesBefore);
});

test("the pane toggle stays clear in tree mode, open and collapsed", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await turnTreeOn(page, "#/t/01/c/001/s/1-1");
  const toggle = page.locator("[data-toggle-navigation]");
  const pane = await page.locator(".statute-tree-column").boundingBox();
  expect((await toggle.boundingBox()).x).toBeGreaterThan(pane.x + pane.width);
  const crumb = await page.locator(".breadcrumbs li").first().boundingBox();
  const box = await toggle.boundingBox();
  expect(crumb.x).toBeGreaterThan(box.x + box.width);
  await toggle.click();
  await expect(page.locator(".statute-tree-column")).toBeHidden();
  await toggle.click();
  await expect(page.locator(".statute-tree-column")).toBeVisible();
});

test("phones keep their browsing with the setting on", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "phone only");
  await openApp(page, "#/t/01/c/001");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("[data-navigation-tree]").check();
  await expect(page.locator(".statute-tree-column")).toBeHidden();
  await expect(page.locator("#browse-sections-list")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

