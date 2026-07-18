import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

export async function openApp(page, route = "#/") {
  await page.goto(`/${route}`);
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.locator("main.loading")).toHaveCount(0);
  await expect(page.locator("main.error")).toHaveCount(0);
}

export async function expectNoHighImpactAccessibilityViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.filter(({ impact }) => ["critical", "serious"].includes(impact));
  expect(violations, violations.map(({ id, help, nodes }) =>
    `${id}: ${help}\n${nodes.map(({ target, failureSummary }) => `  ${target.join(" ")}: ${failureSummary}`).join("\n")}`
  ).join("\n\n")).toEqual([]);
}

export function isMobileProject(testInfo) {
  return testInfo.project.name === "mobile-chromium";
}
