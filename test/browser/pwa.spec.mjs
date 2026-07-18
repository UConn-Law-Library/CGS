import { expect, test } from "@playwright/test";
import { openApp } from "./helpers.mjs";

test.use({ serviceWorkers: "allow" });

async function waitForOfflineWorker(page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) throw new Error("The service worker did not become active.");
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test("the installed shell can reopen while offline", async ({ context, page }) => {
  const failedRequests = [];
  const pageErrors = [];
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openApp(page);
  await waitForOfflineWorker(page);

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

test("Settings reports persistent-storage and release status", async ({ page }) => {
  await openApp(page);
  await waitForOfflineWorker(page);
  await page.locator("[data-open-settings]").first().click();

  await expect(page.locator("[data-persistence-status]"))
    .toContainText(/Persistent (?:browser )?storage/i);
  await page.locator(".offline-release-details").click();
  await expect(page.locator("[data-offline-release]"))
    .toContainText(/Expected corpus|Application release/);
});

test("an incompatible downloaded corpus is identified and can be repaired", async ({ page }) => {
  await openApp(page);
  await waitForOfflineWorker(page);
  const cacheName = "cgs-data-offline-browser-incompatible";
  try {
    await page.evaluate(async (name) => {
      const requestStatus = () => new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => data.type === "complete"
          ? resolve(data.result)
          : data.type === "error" ? reject(new Error(data.message)) : undefined;
        navigator.serviceWorker.controller.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]);
      });
      const current = await requestStatus();
      const scope = new URL("./", document.baseURI);
      const control = await caches.open("cgs-data-control-v1");
      await control.put(new URL("./__active-offline-cache__", scope), new Response(name));
      const cache = await caches.open(name);
      await cache.put(new URL("./__offline-metadata__", scope), new Response(JSON.stringify({
        offlineFormatVersion: 2,
        shellBuildId: "old-shell",
        cachedFiles: 2,
        totalFiles: 2,
        complete: true,
        downloadedAt: "2026-01-02T03:04:05.000Z",
        verifiedFiles: 1,
        verifiedBytes: 128,
        corpus: {
          generatedAt: "1900-01-01T00:00:00Z",
          schemaVersion: current.currentRelease.corpus.schemaVersion
        },
        secondary: null,
        search: null,
        supplements: []
      }), { headers: { "Content-Type": "application/json" } }));
    }, cacheName);
    await page.reload();
    await expect(page.locator("#main-content")).toBeVisible();
    await page.locator("[data-open-settings]").first().click();

    await expect(page.locator("[data-offline-compatibility]"))
      .toContainText(/offline corpus revision differs/i);
    await expect(page.locator("[data-repair-offline]")).toBeEnabled();
    await page.locator(".offline-release-details").click();
    await expect(page.locator("[data-offline-release]"))
      .toContainText("1900-01-01T00:00:00Z");
    await expect(page.locator("[data-offline-release]"))
      .toContainText("2026-01-02T03:04:05.000Z");
  } finally {
    await page.evaluate(async (name) => {
      await caches.delete(name);
      await caches.delete("cgs-data-control-v1");
    }, cacheName).catch(() => {});
  }
});
