import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test("renders the Markdown content and all Mermaid diagrams as SVG", async ({ page }) => {
  await page.goto("/repository-map/");
  await expect(page).toHaveTitle("CGS Repository Map");
  await expect(page.locator("main h1")).toHaveText("Repository map");
  await expect(page.locator("main h2")).toHaveCount(4);
  await expect(page.locator(".diagram-ready")).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator(".diagram-viewport svg")).toHaveCount(3);
  await expect(page.locator(".diagram-error")).toHaveCount(0);
  await expect(page.locator(".diagram-viewport svg").first()).toContainText("CGA statute pages");
  await expect(page.locator(".table-scroll table tbody tr")).toHaveCount(13);
  await expect(page.locator(".page-header a")).toHaveAttribute("href", "https://github.com/UConn-Law-Library/CGS/blob/main/docs/repository-map.md");
  await expect(page.getByRole("link", { name: "base statute data" })).toHaveAttribute("href", "https://github.com/UConn-Law-Library/CGS/tree/main/public/data");
});

test("keeps wide diagrams inside a scrollable viewport on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/repository-map/");
  await expect(page.locator(".diagram-ready")).toHaveCount(3, { timeout: 30_000 });
  const sizes = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
    diagrams: [...document.querySelectorAll(".diagram-viewport")].map((element) => ({
      visible: element.clientWidth,
      content: element.scrollWidth
    }))
  }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.diagrams.some(({ visible, content }) => content > visible)).toBe(true);
});

test("loads inside an iframe on a different origin", async ({ page }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><title>Confluence fixture</title><iframe title="CGS Repository Map" src="http://127.0.0.1:4173/repository-map/" width="700" height="900"></iframe>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const frame = page.frameLocator('iframe[title="CGS Repository Map"]');
    await expect(frame.locator("main h1")).toHaveText("Repository map");
    await expect(frame.locator(".diagram-ready")).toHaveCount(3, { timeout: 30_000 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
