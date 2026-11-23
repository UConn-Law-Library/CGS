import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

export async function openApp(page, route = "#/") {
  await page.goto(`/${route}`);
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.locator("main.loading")).toHaveCount(0);
  await expect(page.locator("main.error")).toHaveCount(0);
}

// Panels and dialogs fade in. Scanned mid-transition, their text is partly transparent and
// fails color contrast, so let every finite animation finish first. Infinite ones, such as a
// loading spinner, are skipped.
export async function settleAnimations(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map((animation) => animation.finished.catch(() => {}))));
}

export async function expectNoHighImpactAccessibilityViolations(page) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations;
  expect(violations, violations.map(({ id, help, nodes }) =>
    `${id}: ${help}\n${nodes.map(({ target, failureSummary }) => `  ${target.join(" ")}: ${failureSummary}`).join("\n")}`
  ).join("\n\n")).toEqual([]);
}

// Opens where the navigation settings live on this page: the side panel's icon, or Settings.
export async function openNavigationSettings(page) {
  const paneButton = page.locator("[data-open-navigation-settings]:visible");
  if (await paneButton.count()) {
    await paneButton.click();
    return { trigger: paneButton, panel: page.locator("[data-navigation-settings]") };
  }
  const trigger = page.getByRole("button", { name: "Settings", exact: true });
  await trigger.click();
  return { trigger, panel: page.locator("[data-settings-panel]") };
}

export function isMobileProject(testInfo) {
  return testInfo.project.name === "mobile-chromium";
}
