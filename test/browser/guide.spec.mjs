import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, isMobileProject, openApp } from "./helpers.mjs";

test("the guide's steps, editions, dates, and questions respond to selection", async ({ page }, testInfo) => {
  await openApp(page, "#/guide");
  await expect(page.getByRole("heading", { level: 1, name: "Understanding the Statutes" })).toBeVisible();
  // The page's code loads only on this route.
  expect(await page.evaluate(() => [...document.querySelectorAll('link[rel="modulepreload"]')].some((link) => link.href.endsWith("/guide.js")))).toBe(false);

  const governor = page.getByRole("button", { name: /Governor's action/ });
  await governor.click();
  await expect(governor).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Bill introduced/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: "Step 5: Governor's action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Step 1: Bill introduced" })).toBeHidden();
  // On a phone the open step's details follow it; across a desktop they sit under the row.
  const panelInStep = await page.locator("#guide-stage-panel").evaluate((panel) => Boolean(panel.closest(".guide-stage")));
  expect(panelInStep).toBe(isMobileProject(testInfo));
  const stepBox = await governor.boundingBox();
  const panelBox = await page.locator("#guide-stage-panel").boundingBox();
  expect(panelBox.y).toBeGreaterThanOrEqual(stepBox.y + stepBox.height - 1);

  const anticipated = page.locator('[data-guide-year="2027"]');
  await anticipated.click();
  await expect(anticipated).toHaveAttribute("aria-pressed", "true");
  const yearPanel = page.locator("#guide-year-panel");
  await expect(yearPanel.getByRole("heading", { name: /2027 General Statutes/ })).toBeVisible();
  await expect(yearPanel).toContainText("Not yet published");
  await expect(yearPanel.getByRole("link")).toHaveCount(0);

  await page.getByLabel("July 2026").check();
  await expect(page.locator('[data-guide-moment-outcome="summer"]')).toBeVisible();
  await expect(page.locator('[data-guide-moment-outcome="summer"]')).toContainText("not operative until October 1, 2026");
  await expect(page.locator('[data-guide-moment-outcome="fall"]')).toBeHidden();

  const question = page.getByRole("group", { name: "Does a 2026 Public Act amend the section?" });
  await question.getByRole("button", { name: "No" }).click();
  await expect(question.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
  await expect(question).toContainText("is likely current");

  await expectNoHighImpactAccessibilityViolations(page);
});

test("contents links move to a part without leaving the guide, and parts can be linked directly", async ({ page }) => {
  await openApp(page, "#/guide");
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "What this app includes" }).click();
  await expect(page).toHaveURL(/#\/guide\?part=coverage$/);
  await expect(page.getByRole("heading", { level: 2, name: "What does the CGS Explorer include?" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 2, name: "What does the CGS Explorer include?" })).toBeInViewport();

  await openApp(page, "#/guide?part=cycle");
  await expect(page.getByRole("heading", { level: 2, name: "The statutes publication cycle" })).toBeInViewport();
});

test("the guide is reachable from Home, Settings, About, and Acts", async ({ page }) => {
  await openApp(page);
  await expect(page.locator('main a[href="#/guide"]')).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("link", { name: /Understanding the Statutes/ })).toBeVisible();
  await openApp(page, "#/about");
  await expect(page.locator('main a[href="#/guide"]')).toBeVisible();
  await openApp(page, "#/acts");
  await expect(page.getByRole("link", { name: "How Public Acts become statute text" })).toHaveAttribute("href", "#/guide?part=public-acts");
});
