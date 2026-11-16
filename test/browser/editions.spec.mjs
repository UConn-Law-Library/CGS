import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, isMobileProject, openApp } from "./helpers.mjs";

// The served site includes a rehearsal archive built by scripts/build-edition-fixture.mjs: the
// fixture's 2021 revision with its 2022 Supplement, superseded by a 2023 revision. The current
// statutes are the published data.
const ARCHIVED_SECTION = "#/editions/2021/t/01/c/001/s/1-1";

test("the editions view leads from the current titles into an archived edition", async ({ page }) => {
  await openApp(page, "#/titles");
  await page.getByRole("link", { name: "Earlier editions" }).click();
  await expect(page).toHaveURL(/#\/editions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Editions" })).toBeVisible();
  await expect(page.locator(".edition-current h2")).toContainText(/General Statutes revised to January 1, 2025/);
  const archived = page.locator("section[aria-labelledby='editions-archived-heading'] .edition-card");
  await expect(archived).toHaveCount(1);
  await expect(archived).toContainText("General Statutes revised to January 1, 2021, with the 2022 Supplement");
  await expect(archived).toContainText("superseded by the 2023 revision");
  await expectNoHighImpactAccessibilityViolations(page);

  await archived.getByRole("link", { name: /^Browse the 2021 revision/ }).click();
  await expect(page).toHaveURL(/#\/editions\/2021$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2021 revision with the 2022 Supplement");
  await expect(page.locator(".edition-notice")).toContainText("it is not the current law");
  await page.locator('main a[href="#/editions/2021/t/01"]').click();
  await expect(page).toHaveURL(/#\/editions\/2021\/t\/01$/);
  await expect(page.locator(".breadcrumbs a")).toHaveText(["Editions", "2021 edition"]);
  await expect(page.locator(".breadcrumbs [aria-current='page']")).toHaveText("Title 1");
});

test("an archived section keeps its base and supplement comparison and stays in its edition", async ({ page }, testInfo) => {
  await openApp(page, ARCHIVED_SECTION);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sec. 1-1.");
  await expect(page.locator(".edition-notice")).toContainText("General Statutes revised to January 1, 2021, with the 2022 Supplement");
  await expect(page.locator(".reader-content > .source-note")).toContainText("Text: 2021 revision with the 2022 Supplement (archived edition)");
  await expect(page.locator(".provision-heading .eyebrow")).toHaveText(/2022 Supplement/);
  // No act notices and no current-edition search on an archived page.
  await expect(page.locator(".pending-amendments")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Search this chapter" })).toHaveCount(0);
  await expect(page.locator(".provision a.primary-action")).toHaveAttribute("href", /^https:\/\/www\.cga\.ct\.gov\/2022\/sup\//);

  const tabs = page.getByRole("tablist", { name: "Section text version" });
  await expect(tabs.getByRole("tab")).toHaveText(["2022 Supplement", "2021 text", "Compare"]);
  await tabs.getByRole("tab", { name: "2021 text" }).click();
  await expect(page.locator(".revision-view:not([hidden]) .revision-view-note")).toHaveText("Text of the 2021 revision, superseded by the 2022 Supplement.");
  await tabs.getByRole("tab", { name: "Compare" }).click();
  await expect(page.locator(".revision-view:not([hidden]) h2")).toHaveText("2022 Supplement compared with 2021");
  await expect(page.locator(".revision-view:not([hidden]) ins.revision-addition")).toContainText("As amended by the 2022 Supplement");

  // Every statute link on the page stays in the 2021 edition, apart from the way out.
  if (isMobileProject(testInfo)) await page.getByRole("button", { name: "Browse chapter", exact: true }).click();
  const hrefs = await page.locator("a[href^='#/t/'], a[href^='#/editions/']").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  // The ways out are the notice's Current text link and the note that related records belong to it.
  const outside = hrefs.filter((href) => href !== "#/editions/2021" && !href.startsWith("#/editions/2021/"));
  expect([...new Set(outside)]).toEqual(["#/t/01/c/001/s/1-1"]);
  expect(hrefs).toContain("#/editions/2021/t/01/c/001/s/1-99");
  if (isMobileProject(testInfo)) await page.getByRole("button", { name: "Close" }).click();
  await expectNoHighImpactAccessibilityViolations(page);

  // A shared archived link opens the same edition after a reload.
  await page.reload();
  await expect(page.locator(".edition-notice")).toBeVisible();
  await page.getByRole("link", { name: "Next" }).last().click();
  await expect(page).toHaveURL(/#\/editions\/2021\/t\/01\/c\/001\/s\//);
  await expect(page.locator(".edition-notice")).toBeVisible();
});

test("the way back leads to the current text, and current search stays on the current revision", async ({ page }) => {
  await openApp(page, ARCHIVED_SECTION);
  await page.locator(".provision .bookmark-button").click();
  await expect(page.locator(".provision .bookmark-button")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".edition-notice").getByRole("link", { name: "Current text" }).click();
  await expect(page).toHaveURL(/#\/t\/01\/c\/001\/s\/1-1$/);
  await expect(page.locator(".edition-notice")).toHaveCount(0);
  await expect(page.locator(".reader-content > .source-note")).toContainText("Text: 2025 revision");
  // The archived bookmark is its own entry, not the current section's.
  await expect(page.locator(".provision .bookmark-button")).toHaveAttribute("aria-pressed", "false");

  await openApp(page, "#/search?q=%221-1%22&field=citation");
  const first = page.locator("#results a[href]").first();
  await expect(first).toHaveAttribute("href", /^#\/t\//);
  await first.click();
  await expect(page.locator(".edition-notice")).toHaveCount(0);
  await expect(page.locator(".reader-content > .source-note")).toContainText("Text: 2025 revision");
});

test("an archived infractions schedule keeps its statute links and marks unresolved citations", async ({ page }) => {
  await openApp(page, "#/editions");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Infractions schedule editions" }) });
  await section.getByRole("link", { name: /Mail-In Violations and Infractions Schedule, effective October 1, 2026/ }).click();
  await expect(page).toHaveURL(/#\/editions\/infractions\/2026-10-01-[0-9a-f]{8}$/);
  await expect(page.locator(".edition-notice")).toContainText("The edition effective January 1, 2099 replaced it");
  await expect(page.locator(".edition-notice")).toContainText("the 2025 revision");
  const manifest = await page.evaluate(() => fetch("./data/secondary/infractions/manifest.json").then((response) => response.json()));
  await expect(page.locator(".note").first()).toHaveText(`${manifest.counts.entries.toLocaleString("en-US")} entries in ${manifest.counts.categories} categories.`);
  await expect(page.locator(".citation-unresolved")).toHaveCount(manifest.counts.entries - manifest.counts.resolved);
  // The schedule's statute links were resolved against the 2025 revision, which is current here.
  const motor = page.locator("details.archived-source-group").filter({ has: page.locator("summary", { hasText: /^MOTOR VEHICLES \(/ }) });
  await motor.locator("summary").click();
  const link = motor.locator("a.legal-reference").first();
  await expect(link).toHaveAttribute("href", /^#\/t\/[0-9a-z]+\/c\/[0-9a-z-]+\/s\//);
  await expectNoHighImpactAccessibilityViolations(page);
  // Current lookup stays on the current schedule.
  await page.locator(".edition-notice").getByRole("link", { name: "Current edition" }).click();
  await expect(page).toHaveURL(/#\/infractions$/);
});

test("an unknown archived edition is reported, not shown as current text", async ({ page }) => {
  await page.goto("/#/editions/1999/t/01");
  await expect(page.locator("main.error h1")).toHaveText("No archived 1999 edition is available.");
});
