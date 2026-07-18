import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, openApp } from "./helpers.mjs";

const representativeRoutes = [
  { name: "Home", route: "#/", heading: "Connecticut General Statutes" },
  { name: "Statute reader", route: "#/t/17b/c/319v/s/17b-238", heading: /Sec\. 17b-238/ },
  { name: "Search results", route: "#/search?q=%22Effective%20January%22", heading: "Search" },
  { name: "Statutes index", route: "#/index", heading: "Index to the General Statutes" },
  { name: "Infractions", route: "#/infractions", heading: "Infractions and violations" }
];

for (const { name, route, heading } of representativeRoutes) {
  test(`${name} has no serious or critical WCAG violations`, async ({ page }) => {
    await openApp(page, route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectNoHighImpactAccessibilityViolations(page);
  });
}

test("Settings remains accessible while expanded", async ({ page }) => {
  await openApp(page);
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await settingsButton.click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();
  await expectNoHighImpactAccessibilityViolations(page);
});
