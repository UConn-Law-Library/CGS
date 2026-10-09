import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, isMobileProject, openApp } from "./helpers.mjs";

test("a section that a listed act repeals says so and links to the act", async ({ page }) => {
  await openApp(page, "#/t/10/c/170/s/10-234gg");
  const notice = page.getByRole("complementary", { name: "A recent Public Act repeals this section" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Repeals this section. Effective from passage (approved March 3, 2026).");
  await expect(notice.getByRole("link", { name: "P.A. 26-1, § 98" })).toHaveAttribute("href", "#/acts/2026-regular/pa-1?section=98");
  await expect(notice.getByRole("link", { name: "How to check whether a section is current" })).toHaveAttribute("href", "#/guide?part=research");
  await expectNoHighImpactAccessibilityViolations(page);
});

test("several acts and their scopes are listed, and the chapter list marks the section", async ({ page }, testInfo) => {
  await openApp(page, "#/t/22a/c/446d/s/22a-245");
  const notice = page.getByRole("complementary", { name: "Recent Public Acts change this section" });
  await expect(notice.getByRole("listitem")).toHaveText([
    /P\.A\. 26-2, § 1\s*Amends this section\./,
    /P\.A\. 26-148, § 2\s*Amends subdivision \(2\) of subsection \(d\)\./
  ]);
  if (isMobileProject(testInfo)) {
    await page.getByRole("button", { name: "Browse chapter" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: /^§ 22a-245 .*Amended by recent Public Acts/ })).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "Sections in Chapter 446d" }).getByRole("link", { name: /^§ 22a-245 .*Amended by recent Public Acts/ })).toBeVisible();
  }
});

test("sections no listed act changes show no notice, and the chapter overview counts the ones that do", async ({ page }) => {
  await openApp(page, "#/t/01/c/001/s/1-2");
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 1-2\./ })).toBeVisible();
  await expect(page.locator(".pending-amendments")).toHaveCount(0);
  await openApp(page, "#/t/22a/c/446d");
  await expect(page.locator(".pending-amendments-summary")).toContainText(/(A recent Public Act changes|Recent Public Acts change) \d+ sections? in this chapter\./);
});

test.describe("dark color scheme", () => {
  test.use({ colorScheme: "dark" });
  test("the act notice keeps its contrast", async ({ page }) => {
    await openApp(page, "#/t/22a/c/446d/s/22a-245");
    await expect(page.locator(".pending-amendments")).toBeVisible();
    await expectNoHighImpactAccessibilityViolations(page);
  });
});
