import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, isMobileProject, openApp, openNavigationSettings } from "./helpers.mjs";

test("filtered title, chapter and section browsing reaches canonical text", async ({ page }, testInfo) => {
  await openApp(page, "#/titles");
  await page.getByLabel("Find a title", { exact: true }).fill("general application");
  await expect(page.locator("#browse-titles-list > li:visible")).toHaveCount(1);
  await page.locator("#browse-titles-list a:visible").click();
  const mobile = isMobileProject(testInfo);
  await page.getByLabel(mobile ? "Find a chapter" : "Filter chapters", { exact: true }).fill("Oaths");
  const chapters = page.locator(mobile ? "#browse-chapters-list" : "#rail-chapters");
  await chapters.locator("li:visible a").click();
  await page.getByLabel(mobile ? "Find a section" : "Filter sections", { exact: true }).fill("1-24");
  const sections = page.locator(mobile ? "#browse-sections-list" : "#rail-sections");
  await sections.locator("li:visible a").first().click();
  await expect(page).toHaveURL(/#\/t\/01\/c\/004\/s\/1-24$/);
  await expect(page.locator(".statute-text").first()).toContainText("administer oaths");
  await expectNoHighImpactAccessibilityViolations(page);
});

test("heading filters explain no matches and clearing restores all titles", async ({ page }) => {
  await openApp(page, "#/titles");
  const rows = page.locator("#browse-titles-list > li:visible");
  const total = await rows.count();
  await page.getByLabel("Find a title", { exact: true }).fill("no-such-title-xyz");
  await expect(rows).toHaveCount(0);
  await expect(page.locator('[data-filter-status="browse-titles-list"]')).toContainText("No matching headings");
  await page.getByLabel("Find a title", { exact: true }).fill("");
  await expect(rows).toHaveCount(total);
});

test("chapter navigation shortens headings and filters by the full title", async ({ page }, testInfo) => {
  await openApp(page, "#/t/04/c/047/s/4-28");
  const mobile = isMobileProject(testInfo);
  if (mobile) await page.getByRole("button", { name: "Browse chapter", exact: true }).click();
  const sections = page.locator(mobile ? "#sheet-sections" : "#rail-sections");
  const current = sections.locator('[aria-current="page"]');
  await expect(current).toContainText("Federal funds; Governor's responsibilities.");
  await expect(current).not.toContainText("Copy of applications");

  await page.getByLabel(mobile ? "Filter chapter sections" : "Filter sections", { exact: true }).fill("Copy of applications");
  await expect(current).toBeVisible();
  if (mobile) await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Copy of applications");
});

test("chapter disclosures link to updated, new, and act-affected sections", async ({ page }) => {
  await openApp(page, "#/t/04/c/050");
  const updated = page.locator(".supplement-summary details").filter({ hasText: "Updated sections" });
  const added = page.locator(".supplement-summary details").filter({ hasText: "New sections" });
  const acts = page.locator(".pending-amendments-summary details");
  for (const group of [updated, added, acts]) {
    await expect(group.locator("summary")).toBeVisible();
    await expect(group.getByRole("link")).toHaveCount(0);
    await group.locator("summary").click();
    await expect(group.getByRole("link").first()).toBeVisible();
  }
  await expect(updated.locator('a[href="#/t/04/c/050/s/4-68cc"]')).toBeVisible();
  await expect(added.locator('a[href="#/t/04/c/050/s/4-68bbb"]')).toBeVisible();
  await expect(acts.locator('a[href="#/t/04/c/050/s/4-68cc"]')).toBeVisible();
  await acts.locator('a[href="#/t/04/c/050/s/4-68cc"]').click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sec. 4-68cc.");
});

test("subtle notices persist and keep transferred and act labels accessible", async ({ page }, testInfo) => {
  await openApp(page, "#/t/04/c/050/s/4-68bb");
  await openNavigationSettings(page);
  const toggle = page.getByRole("switch", { name: "Subtle notices" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-subtle-notices", "true");
  const mobile = isMobileProject(testInfo);
  if (mobile) await page.getByRole("button", { name: "Browse chapter", exact: true }).click();
  const sections = page.locator(mobile ? "#sheet-sections" : "#rail-sections");
  const transferred = sections.getByRole("link", { name: /§ 4-68bb\s+Transferred/ });
  await expect(transferred.locator(".transferred-pill")).toHaveCSS("border-radius", "50%");
  const affected = sections.locator('a[href="#/t/04/c/050/s/4-68cc"]');
  await expect(affected).toHaveAccessibleName(/Supplement.*Amended by (?:a recent Public Act|recent Public Acts)/);
  await expect(affected.locator(".act-pending-pill")).toHaveCSS("border-radius", "50%");
});

test("reader citation, scoped search, history and chapter sheet remain usable", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (text) => { window.copiedCitation = text; } }
  }));
  await openApp(page, "#/t/01/c/004/s/1-24");
  await page.locator(".section-actions").getByRole("button", { name: "Copy citation", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.copiedCitation)).toBe("Conn. Gen. Stat. § 1-24");
  await expect(page.locator("[data-action-toast]")).toContainText("copied");
  await page.getByRole("link", { name: "Search this chapter", exact: true }).click();
  await expect(page.locator("#search-title")).toHaveValue("title-01");
  await expect(page.locator("#search-chapter")).toHaveValue("004");
  await page.locator("#search-page-query").fill("oaths");
  await page.locator("[data-search-refine]").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("#search-status")).toContainText("Showing");
  await page.locator("#results a").first().click();
  await expect(page.locator("article.provision")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#search-page-query")).toHaveValue("oaths");
  await openApp(page, "#/t/01/c/004/s/1-24");
  if (isMobileProject(testInfo)) {
    const trigger = page.getByRole("button", { name: "Browse chapter", exact: true });
    await trigger.click();
    await page.getByLabel("Filter chapter sections", { exact: true }).fill("1-25");
    await expect(page.locator("#sheet-sections li:visible")).toHaveCount(1);
    await expectNoHighImpactAccessibilityViolations(page);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
});

test("prototype light and dark layouts keep readable content and no overflow", async ({ page }, testInfo) => {
  await openApp(page, "#/t/01/c/004/s/1-24");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    await expectNoHighImpactAccessibilityViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`reader-${theme}.png`), fullPage: false });
  }
});
