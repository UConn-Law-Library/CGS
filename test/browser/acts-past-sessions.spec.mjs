import { expect, test } from "@playwright/test";
import { openApp } from "./helpers.mjs";

// Rehearses the acts side of the 2027 rollover on the published data: the test serves a catalog
// revised to January 1, 2027 with no supplement, which is what the app sees once the rollover
// merges. The acts data is unchanged.
async function activate2027(page) {
  await page.route(/\/data\/catalog\.json/, async (route) => {
    const catalog = await (await route.fetch()).json();
    catalog.source.revisionYear = 2027;
    await route.fulfill({ json: catalog });
  });
  await page.route(/\/data\/supplements\/manifest\.json/, async (route) => {
    const index = await (await route.fetch()).json();
    await route.fulfill({ json: { ...index, editions: [] } });
  });
}

test("today the 2026 sessions are recent, and there are no past sessions", async ({ page }) => {
  await openApp(page, "#/acts");
  await expect(page.locator(".acts-page .source-note")).toContainText("2026 Regular Session");
  await expect(page.locator(".acts-page .eyebrow").first()).not.toContainText("Past session");
  await page.getByRole("link", { name: "Past sessions" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Past sessions");
  await expect(page.locator(".empty-state")).toContainText("No past sessions yet");
});

test("once the 2027 revision is active, 2026 acts move to Past sessions and their links still open", async ({ page }) => {
  await activate2027(page);
  await openApp(page, "#/acts");
  await expect(page.locator(".empty-state")).toContainText("No acts have been published from a session after the 2026 sessions, which the 2027 General Statutes in this app covers.");
  await page.getByRole("link", { name: "Past sessions (1)" }).click();
  await expect(page.locator(".past-sessions")).toContainText("2026 Regular Session");
  await page.getByRole("link", { name: /2026 Regular Session/ }).click();
  await expect(page).toHaveURL(/#\/acts\?session=2026-regular$/);
  await expect(page.locator(".acts-page .eyebrow").first()).toContainText("Past session");
  await expect(page.locator(".index-intro > p").nth(1)).toContainText("should already be reflected in the 2027 General Statutes text in this app, which covers legislation through the 2026 sessions");

  // A link saved before the rollover opens the same act and section.
  await openApp(page, "#/acts/2026-regular/pa-8?section=1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("26-8");
  await expect(page.locator("main")).toContainText("2027 General Statutes");

  // A search still finds 2026 acts, and "See all" opens their past session rather than the
  // empty recent view.
  await openApp(page, "#/search?q=PA%2026-8");
  await page.locator("details", { hasText: "Also found in" }).locator("summary").first().click();
  await page.getByRole("link", { name: "See all 1 matching act" }).click();
  await expect(page).toHaveURL(/#\/acts\?session=2026-regular&q=PA%2026-8$/);
  await expect(page.locator(".acts-page .eyebrow").first()).toContainText("Past session");
  await expect(page.locator("main table")).toContainText("26-8");

  // The current statute page no longer shows the 2026 act notice.
  await openApp(page, "#/t/01/c/001/s/1-1");
  await expect(page.locator(".reader-content > .source-note")).toContainText("Text: 2027 revision.");
  await expect(page.locator("[data-amendments-status]")).not.toContainText("P.A. 26-8");
  await expect(page.locator(".pending-amendments")).toHaveCount(0);
});
