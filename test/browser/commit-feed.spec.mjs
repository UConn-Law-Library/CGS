import { expect, test } from "@playwright/test";

const API = "https://api.github.com/repos/UConn-Law-Library/CGS/commits**";

function commit(sha, message, author = null) {
  return {
    sha,
    commit: {
      message,
      author: { name: "Alex Example", date: "2026-09-23T14:30:00Z" },
      committer: { date: "2026-09-23T15:00:00Z" }
    },
    author
  };
}

test("shows recent commits safely with working GitHub links", async ({ page }) => {
  const sha = "a".repeat(40);
  const requests = [];
  await page.route(API, async (route) => {
    requests.push(new URL(route.request().url()));
    await route.fulfill({ json: [
      commit(sha, "Fix <img src=x onerror=alert(1)>\nLong description", {
        login: "alex-example",
        avatar_url: "https://avatars.githubusercontent.com/u/123?v=4"
      }),
      commit("b".repeat(40), "Update citations")
    ] });
  });

  await page.goto("/commit-feed/?limit=5&compact=true");
  await expect(page.locator(".commit-item")).toHaveCount(2);
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get("sha")).toBe("main");
  expect(requests[0].searchParams.get("per_page")).toBe("5");
  await expect(page.locator(".feed")).toHaveClass(/compact/);
  await expect(page.locator(".commit-message").first()).toContainText("Fix <img src=x onerror=alert(1)>");
  await expect(page.locator(".commit-item img")).toHaveCount(1);
  await expect(page.locator(".commit-item a[href='https://github.com/alex-example']")).toHaveCount(1);
  await expect(page.locator(".commit-message").first()).toHaveAttribute("href", `https://github.com/UConn-Law-Library/CGS/commit/${sha}`);
  await expect(page.locator(".commit-item time").first()).toHaveAttribute("datetime", "2026-09-23T15:00:00.000Z");
  await expect(page.locator(".commit-item img[src='x']")).toHaveCount(0);
  await expect(page.locator(".commit-item a[target='_blank']:not([rel~='noopener'])")).toHaveCount(0);
});

test("shows a useful fallback for rate limits and malformed responses", async ({ page }) => {
  await page.route(API, (route) => route.fulfill({ status: 403, json: { message: "API rate limit exceeded" } }));
  await page.goto("/commit-feed/");
  await expect(page.locator("#feed-status")).toContainText("request limit");
  await expect(page.locator("#feed-status a")).toHaveAttribute("href", "https://github.com/UConn-Law-Library/CGS/commits/main/");

  await page.route(API, (route) => route.fulfill({ json: { message: "Unexpected body" } }));
  await page.reload();
  await expect(page.locator("#feed-status")).toContainText("unavailable");
});

test("fits a narrow iframe without horizontal overflow", async ({ page }) => {
  await page.route(API, (route) => route.fulfill({ json: [
    commit("c".repeat(40), "A very long commit subject that should wrap gracefully without making the embedded page wider than the iframe ".repeat(3))
  ] }));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/commit-feed/");
  await expect(page.locator(".commit-item")).toHaveCount(1);
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
});

test("renders inside an iframe served by the Pages artifact", async ({ page }) => {
  await page.route(API, (route) => route.fulfill({ json: [commit("d".repeat(40), "Update corpus links")] }));
  await page.goto("/");
  await page.setContent('<iframe title="CGS development activity" src="/commit-feed/" width="800" height="1000"></iframe>');
  await expect(page.frameLocator("iframe").locator(".commit-message")).toContainText("Update corpus links");
});
