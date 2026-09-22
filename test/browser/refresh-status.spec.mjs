import { expect, test } from "@playwright/test";
import { openApp } from "./helpers.mjs";

for (const conclusion of ["success", "failure"]) {
  test(`About reports the latest refresh ${conclusion}`, async ({ page }) => {
    await page.route("https://api.github.com/**", (route) => route.fulfill({ json: {
      workflow_runs: [{ id: 12345, updated_at: "2026-09-21T12:00:00Z", conclusion }]
    } }));
    await openApp(page, "#/about");
    const status = page.locator("[data-corpus-refresh]");
    await expect(status).toContainText("September 21, 2026");
    await expect(status).toContainText(conclusion === "success" ? "completed successfully" : "failure");
    await expect(status.getByRole("link")).toHaveAttribute("href", "https://github.com/UConn-Law-Library/CGS/actions/runs/12345");
  });
}

test("About remains usable when refresh history is unavailable", async ({ page }) => {
  await page.route("https://api.github.com/**", (route) => route.fulfill({ status: 403, body: "Rate limited" }));
  await openApp(page, "#/about");
  await expect(page.locator("[data-corpus-refresh]")).toContainText("Latest update check: unavailable.");
  await expect(page.locator("[data-corpus-refresh] a")).toHaveAttribute("href", /refresh-corpus.yml$/);
  await expect(page.getByRole("heading", { name: "General Statutes", exact: true })).toBeVisible();
  for (const status of await page.locator("[data-secondary-refresh]").all()) {
    await expect(status).toContainText("Latest update check: unavailable.");
    await expect(status.getByRole("link")).toHaveAttribute("href", /refresh-secondary.yml$/);
  }
});

test("secondary cards share their workflow result independently of the corpus", async ({ page }) => {
  let secondaryRequests = 0;
  await page.route("https://api.github.com/**", (route) => {
    const secondary = route.request().url().includes("refresh-secondary.yml");
    if (secondary) secondaryRequests++;
    return route.fulfill({ json: { workflow_runs: [{
      id: secondary ? 67890 : 12345,
      updated_at: secondary ? "2026-09-22T12:00:00Z" : "2026-09-21T12:00:00Z",
      conclusion: secondary ? "failure" : "success"
    }] } });
  });
  await openApp(page, "#/about");
  await expect(page.locator("[data-corpus-refresh]")).toContainText("September 21, 2026 (completed successfully)");
  const statuses = page.locator("[data-secondary-refresh]");
  await expect(statuses).toHaveCount(2);
  for (const status of await statuses.all()) {
    await expect(status).toContainText("September 22, 2026 (failure)");
    await expect(status.getByRole("link")).toHaveAttribute("href", "https://github.com/UConn-Law-Library/CGS/actions/runs/67890");
  }
  expect(secondaryRequests).toBe(1);
});
