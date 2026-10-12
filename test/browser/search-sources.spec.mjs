import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, openApp } from "./helpers.mjs";

const alsoFound = (page) => page.getByRole("region", { name: "Also found in" });

test("the search page lists matching acts and infractions beside the statute results", async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await page.locator("#global-query").fill("beverage containers");
  await page.locator("#global-query").press("Enter");
  await expect(page).toHaveURL(/#\/search\?q=beverage%20containers$/);

  // The acts and infractions groups do not wait for the search of every statute title.
  const acts = alsoFound(page).getByRole("region", { name: "Public and Special Acts" });
  await expect(acts.getByRole("link").first()).toContainText("P.A. 26-2");
  await expect(acts.getByRole("link").first()).toHaveAttribute("href", "#/acts/2026-regular/pa-2");
  const infractions = alsoFound(page).getByRole("region", { name: "Infractions" });
  await expect(infractions.getByRole("link").first()).toContainText("22a-245");
  await expect(page.locator("#search-status")).toContainText(/Showing \d+ of \d+ results?/, { timeout: 60_000 });
  await expectNoHighImpactAccessibilityViolations(page);

  // Each group's count is the number its own search lists.
  const seeAllActs = acts.getByRole("link", { name: /^See all \d+ matching acts?$/ });
  const actCount = (await seeAllActs.textContent()).match(/\d+/)[0];
  await seeAllActs.click();
  await expect(page).toHaveURL(/#\/acts\?q=beverage%20containers$/);
  await expect(page.locator(".acts-page [role=status]")).toContainText(`Showing ${actCount} of`);

  await page.goBack();
  const seeAllInfractions = alsoFound(page).getByRole("link", { name: /^See all \d+ matching infractions?$/ });
  const infractionCount = (await seeAllInfractions.textContent()).match(/\d+/)[0];
  await seeAllInfractions.click();
  await expect(page).toHaveURL(/#\/infractions\?q=beverage%20containers$/);
  await expect(page.locator("#infraction-query")).toHaveValue("beverage containers");
  await expect(page.locator("main .note")).toContainText(`${infractionCount} matching entr`);
  await expect(page.locator("main .infraction-list li")).toHaveCount(Number(infractionCount));
  await expect(page.locator("main .infraction-list li").first()).toContainText("ENVIRONMENTAL PROTECTION");
});

test("a search that names an act lists it under the acts group", async ({ page }) => {
  await openApp(page, "#/search?q=PA%2026-2&title=title-22a");
  const acts = alsoFound(page).getByRole("region", { name: "Public and Special Acts" });
  await expect(acts.getByRole("listitem")).toHaveCount(1);
  await expect(acts.getByRole("link").first()).toContainText("P.A. 26-2");
  await expect(acts.getByRole("link", { name: "See all 1 matching act" })).toHaveAttribute("href", "#/acts?q=PA%2026-2");
  await expect(page.locator("#search-status")).toContainText(/Showing|No results/);
});

test("a source that fails to load drops its group without breaking the search", async ({ page }) => {
  await page.route("**/data/acts/manifest.json", (route) => route.abort());
  // One title keeps the statute search short; acts and infractions ignore the filter.
  await openApp(page, "#/search?q=beverage%20containers&title=title-22a");
  await expect(page.locator("#search-status")).toContainText(/Showing \d+ of \d+ results?/);
  await expect(alsoFound(page).getByRole("region", { name: "Infractions" })).toBeVisible();
  await expect(page.locator('[data-also-found-group="acts"]')).toBeHidden();
});

test("Boolean operators that acts and infractions cannot apply leave them out", async ({ page }) => {
  await openApp(page, "#/search?q=beverage%20OR%20bottle&title=title-22a");
  await expect(page.locator("#search-status")).toContainText(/Showing \d+ of \d+ results?/);
  await expect(page.locator(".also-found-note")).toContainText("not searched when a query uses OR, NOT, NEAR, or parentheses");
  await expect(page.locator("[data-also-found]")).toHaveCount(0);
});

test("the infractions page searches every category", async ({ page }) => {
  await openApp(page, "#/infractions");
  await page.getByLabel("Search all categories").fill("redemption center");
  await page.locator("[data-infraction-search]").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/#\/infractions\?q=redemption%20center$/);
  const results = page.locator("main .infraction-list li");
  await expect(results.first()).toContainText("ENVIRONMENTAL PROTECTION");
  await results.first().getByRole("link").click();
  await expect(page).toHaveURL(/#\/infractions\/ENVIRONMENTAL%20PROTECTION\/entry\//);

  // A category search offers the same words across every category.
  await openApp(page, "#/infractions/ENVIRONMENTAL%20PROTECTION?q=redemption");
  await page.locator("main").getByRole("link", { name: "Search all categories" }).click();
  await expect(page).toHaveURL(/#\/infractions\?q=redemption$/);
  await page.locator("main").getByRole("link", { name: "Clear search" }).click();
  await expect(page).toHaveURL(/#\/infractions$/);
  await expect(page.locator("main .infraction-list")).toHaveCount(0);
});
