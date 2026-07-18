import { expect, test } from "@playwright/test";
import { openApp } from "./helpers.mjs";

test.use({ serviceWorkers: "allow" });

test("the installed shell can reopen while offline", async ({ context, page }) => {
  const failedRequests = [];
  const pageErrors = [];
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openApp(page);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) {
      throw new Error("The service worker did not become active.");
    }
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Connecticut General Statutes" }),
      `Failed requests:\n${failedRequests.join("\n")}\nPage errors:\n${pageErrors.join("\n")}`
    ).toBeVisible();
    await expect(page.locator("main.error")).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});
