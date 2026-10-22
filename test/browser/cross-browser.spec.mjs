import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openApp } from "./helpers.mjs";

// A private server lets Windows WebKit lose its connection without Playwright's
// offline emulation, which also blocks its service-worker responses.
async function isolatedServer() {
  const root = path.resolve("dist");
  const server = createServer(async (request, response) => {
    let file = path.resolve(root, "." + new URL(request.url, "http://localhost").pathname);
    if (file !== root && !file.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      const type = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" }[path.extname(file)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }).end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  } };
}

test("navigation, search, bookmarks, and native dialogs work across engines", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "#/t/01/c/001/s/1-1");
  await expect(page.locator(".statute-text")).toBeVisible();
  await page.locator("[data-bookmark-id]").click();
  await expect(page.locator("[data-bookmark-id]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-open-settings]").click();
  await page.locator("[data-open-feedback]").click();
  await expect(page.locator("[data-feedback-dialog]")).toBeVisible();
  await page.locator("[data-close-feedback]").click();
  await expect(page.locator("[data-feedback-dialog]")).not.toBeVisible();
  await page.evaluate(() => { location.hash = "#/search?q=public&title=title-01"; });
  await expect(page.locator("#results li").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("offline", () => {
  test.use({ serviceWorkers: "allow" });
  test("visited statute and shell reopen without a connection", async ({ page, context }, testInfo) => {
    const privateServer = testInfo.project.use.browserName === "webkit" && process.platform === "win32" ? await isolatedServer() : null;
    try {
    if (privateServer) {
      await page.goto(privateServer.url);
      await expect(page.locator("#main-content")).toBeVisible();
    } else await openApp(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.evaluate(() => { location.hash = "#/t/01/c/001/s/1-1"; });
    await expect(page.locator(".statute-text")).toBeVisible();
    await expect(page.locator("[data-amendments-status]")).not.toContainText("loading");
    if (privateServer) await privateServer.close();
    else await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator(".statute-text")).toBeVisible();
      await expect(page.locator("main.error")).toHaveCount(0);
    } finally { await context.setOffline(false); }
    } finally { await privateServer?.close(); }
  });
});
