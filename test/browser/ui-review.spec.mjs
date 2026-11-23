import { expect, test } from "@playwright/test";
import { expectNoHighImpactAccessibilityViolations, openApp, isMobileProject } from "./helpers.mjs";

const routes = ["#/", "#/titles", "#/t/01", "#/t/01/c/001", "#/t/01/c/001/s/1-1", "#/infractions", "#/index", "#/acts", "#/bookmarks", "#/search"];

test("security deposit shows a collapsed Also found in above the statute results", async ({ page }) => {
  await openApp(page, "#/search?q=security%20deposit");
  await expect(page.locator("#search-status")).toContainText(/Showing \d+ of \d+ results?/, { timeout: 60_000 });
  const alsoFound = page.locator("[data-also-found]");
  await expect(alsoFound).toBeVisible();
  await expect(alsoFound).not.toHaveAttribute("open");
  await expect(alsoFound.locator(".also-found-groups")).toBeHidden();
  const also = await alsoFound.boundingBox();
  const results = await page.locator("#results").boundingBox();
  expect(also.y + also.height).toBeLessThanOrEqual(results.y);
  await alsoFound.locator("summary").press("Enter");
  await expect(alsoFound.getByRole("region", { name: "Public and Special Acts" })).toBeVisible();
  await expect(alsoFound.getByRole("region", { name: "Infractions" })).toBeVisible();
  await expectNoHighImpactAccessibilityViolations(page);
});

test("Search tips is a collapsed disclosure outside Advanced options with every tip", async ({ page }) => {
  await openApp(page, "#/search");
  const advanced = page.locator(".search-advanced");
  await expect(advanced).not.toHaveAttribute("open");
  await advanced.locator("summary").click();
  await expect(page.getByLabel("Chapter", { exact: true })).toBeDisabled();
  await page.getByLabel("Title", { exact: true }).selectOption("title-01");
  await expect(page.getByLabel("Chapter", { exact: true })).toBeEnabled();
  const tips = page.locator(".search-syntax");
  await expect(tips.locator("summary")).toHaveText("Search tips");
  await expect(page.locator(".search-advanced .search-syntax")).toHaveCount(0);
  await expect(tips.locator("#search-help")).toBeHidden();
  await tips.locator("summary").click();
  for (const text of ["AND", "OR", "NOT", '"security deposit"', "NEAR/5", "regulat*", "Stemming"]) await expect(tips).toContainText(text);
});

test("the header keeps one height and each page has one main search box", async ({ page }) => {
  await openApp(page);
  const heights = new Set();
  for (const route of routes) {
    await page.evaluate((hash) => { location.hash = hash; }, route);
    await expect(page.locator("main.loading")).toHaveCount(0);
    await page.waitForTimeout(400);
    heights.add(await page.locator(".site-header").evaluate((header) => header.offsetHeight));
    expect(await page.locator(".site-header [data-omni-input]").count(), route).toBe(route === "#/search" ? 0 : 1);
    expect(await page.locator("#main-content [data-omni-input]").count(), route).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
  }
  expect([...heights]).toHaveLength(1);
});

test("the / shortcut reaches the search box on home and on the search page", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "keyboard shortcut");
  await openApp(page);
  await page.locator("h1").first().click();
  await page.keyboard.press("/");
  await expect(page.locator("#global-query")).toBeFocused();
  await openApp(page, "#/search");
  await page.locator("h1").first().click();
  await page.keyboard.press("/");
  await expect(page.locator("#search-page-query")).toBeFocused();
});

test("the pane toggle covers no breadcrumb or heading, open or collapsed", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "no panes on phones");
  test.setTimeout(240_000);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["#/", "#/t/01", "#/t/01/c/001", "#/t/01/c/001/s/1-1", "#/infractions", "#/index"]) {
      for (const state of ["open", "collapsed"]) {
        await page.goto("about:blank");
        await openApp(page, route);
        const toggleLocator = page.locator("[data-toggle-navigation]");
        await expect(toggleLocator).toBeVisible();
        const collapsed = (await page.locator(".application-shell").getAttribute("data-navigation-collapsed")) === "true";
        if (collapsed !== (state === "collapsed")) await toggleLocator.click();
        const toggle = await toggleLocator.boundingBox();
        expect(toggle, `no toggle box: ${route} ${state} at ${viewport.width}, url ${page.url()}, columns ${await page.locator(".application-shell").getAttribute("data-context-columns").catch(() => "none")}, collapsedAttr ${await page.locator(".application-shell").getAttribute("data-navigation-collapsed").catch(() => "none")}`).not.toBeNull();
        const firstEdge = await page.evaluate(() => Math.min(...[...document.querySelectorAll(".breadcrumbs li, main h1")].filter((element) => element.offsetParent).map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getBoundingClientRect().left;
        })));
        expect(firstEdge, `${route} ${state} at ${viewport.width}: first text x=${firstEdge}, toggle right=${toggle.x + toggle.width}`).toBeGreaterThan(toggle.x + toggle.width);
        if (state === "collapsed") await toggleLocator.click();
      }
    }
  }
});

test("programmatic heading focus shows a ring only for someone tabbing", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "keyboard");
  await openApp(page, "#/titles");
  const outline = () => page.locator("main h1").evaluate((element) => document.activeElement === element ? getComputedStyle(element).outlineStyle : "not focused");
  await page.locator(".app-nav a", { hasText: "Infractions" }).click();
  await expect(page.locator("main h1")).toHaveText("Infractions and violations");
  await expect.poll(outline).toBe("none");
  await page.locator(".app-nav a", { hasText: "Acts" }).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/acts/);
  await expect.poll(outline).toBe("solid");
});

test("filter placeholders fit, the Infractions pane filters, and its search box is wide", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "panes are desktop only");
  await openApp(page, "#/t/01/c/001");
  const room = await page.locator("#rail-title-filter").evaluate((input) => {
    const style = getComputedStyle(input);
    const context = document.createElement("canvas").getContext("2d");
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - context.measureText(input.placeholder).width;
  });
  expect(room).toBeGreaterThanOrEqual(0);
  await openApp(page, "#/infractions");
  const filter = page.getByLabel("Filter categories");
  await filter.fill("boat");
  await expect(page.locator("#rail-infraction-categories li:visible")).toHaveCount(1);
  await expect(page.locator('[data-filter-status="rail-infraction-categories"]')).toContainText(/^1 of \d+ shown$/);
  await filter.fill("");
  const input = await page.locator("#infraction-query").boundingBox();
  const form = await page.locator(".infraction-search").boundingBox();
  expect(input.width / form.width).toBeGreaterThan(0.7);
});

test("the chapter page has no large gap above the section count", async ({ page }) => {
  await openApp(page, "#/t/01/c/001");
  const tools = await page.locator(".chapter-research-tools").boundingBox();
  const count = await page.locator(".chapter-overview .eyebrow").boundingBox();
  expect(count.y - (tools.y + tools.height)).toBeLessThan(40);
});

const amended = "#/t/11/c/190/s/11-24b";
const views = (page) => page.locator(".revision-view:not([hidden])");

test("an amended section defaults to the Supplement and switches to previous text and Compare", async ({ page }) => {
  await openApp(page, amended);
  const group = page.getByRole("tablist", { name: "Section text version" });
  await expect(group.getByRole("tab")).toHaveText(["2026 Supplement", "2025 text", "Compare"]);
  await expect(group.getByRole("tab", { name: "2026 Supplement" })).toHaveAttribute("aria-selected", "true");
  await expect(views(page)).toHaveCount(1);
  await expect(views(page).locator(".information-references")).toBeVisible();
  // It sits between the action buttons and the statute text.
  const actions = await page.locator(".provision .section-actions").boundingBox();
  const box = await group.boundingBox();
  const text = await views(page).locator(".statute-text").boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(actions.y + actions.height);
  expect(box.y + box.height).toBeLessThanOrEqual(text.y);
  await expectNoHighImpactAccessibilityViolations(page);

  await group.getByRole("tab", { name: "2025 text" }).click();
  await expect(views(page)).toHaveCount(1);
  await expect(views(page)).toContainText("superseded by the 2026 Supplement");
  await expect(page.locator(".information-references")).toBeHidden();
  await expectNoHighImpactAccessibilityViolations(page);

  await group.getByRole("tab", { name: "Compare" }).click();
  await expect(views(page)).toHaveCount(1);
  await expect(views(page).getByRole("heading", { name: "2026 Supplement compared with 2025" })).toBeVisible();
  await expect(views(page).locator(".revision-diff-text")).toBeVisible();
  await expect(views(page).locator(".revision-addition, .revision-deletion").first()).toBeVisible();
  await expectNoHighImpactAccessibilityViolations(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the text views work from the keyboard with one tab stop", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "keyboard");
  await openApp(page, amended);
  const tabs = page.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(0)).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("End");
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Tab");
  await expect(page.locator(".revision-view:not([hidden])")).toBeFocused();
});

test("printing shows only the selected view and hides the buttons", async ({ page }) => {
  await openApp(page, amended);
  await page.getByRole("tab", { name: "2025 text" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".revision-view-switch")).toBeHidden();
  await expect(views(page)).toContainText("superseded by the 2026 Supplement");
  await expect(page.locator(".revision-diff-text")).toBeHidden();
});

test("a subsection link on an amended section still reaches its paragraph", async ({ page }) => {
  await openApp(page, `${amended}/p/a`);
  await expect(page.locator("#subsection-a")).toBeVisible();
  await expect(page.locator("#subsection-a")).toBeInViewport();
});

test("a section with no earlier text has no buttons, and nothing replaces the disclaimer", async ({ page }) => {
  await openApp(page, "#/t/01/c/001/s/1-1g");
  await expect(page.locator("[data-amendments-status]")).toBeEmpty();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.locator(".statute-text")).toBeVisible();
  await expect(page.locator(".information-references")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("No amendments found");
});

test("the page does not shift when the amendment check finishes with nothing to report", async ({ page }) => {
  await page.route("**/data/acts/**", async (route) => { await new Promise((resolve) => setTimeout(resolve, 700)); await route.continue(); });
  await openApp(page, "#/t/01/c/001/s/1-1g");
  const top = () => page.locator(".provision .section-actions").evaluate((element) => Math.round(element.getBoundingClientRect().top + scrollY));
  const before = await top();
  await expect(page.locator("[data-amendments-status]")).toBeEmpty({ timeout: 20_000 });
  expect(await top()).toBe(before);
});

test("the Amendment warning still shows when a section does have a pending act", async ({ page }) => {
  await openApp(page, "#/t/01/c/001/s/1-1");
  await expect(page.locator("[data-amendments-status]")).toContainText("A recent Public Act amends this section");
});

test("the buttons fit at 320px and the guide names the new control", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page, amended);
  for (const tab of await page.getByRole("tab").all()) expect(await tab.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const guide = await page.request.get("/CGS/discover/understanding-the-statutes/");
  expect(await guide.text()).toContain("under the “2025 text” button.");
});

test("section actions are four named icons and a blue Official source button", async ({ page }) => {
  await openApp(page, "#/t/11/c/190/s/11-22");
  const actions = page.locator(".provision .section-actions");
  for (const [role, name] of [["button", "Copy citation"], ["button", "Bookmark"], ["button", "Copy link"], ["link", "Email"], ["link", "Official source"]]) {
    await expect(actions.getByRole(role, { name, exact: true })).toBeVisible();
  }
  const source = actions.getByRole("link", { name: "Official source" });
  await expect(source).toHaveClass(/primary-action/);
  expect(await source.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--blue)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }));
  for (const icon of await actions.locator(".icon-action").all()) {
    const box = await icon.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(36);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(icon).toHaveCSS("border-top-width", "0px");
    await expect(icon.locator("svg")).toHaveCSS("width", "24px");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectNoHighImpactAccessibilityViolations(page);
});

test("tooltips appear on hover and keyboard focus and icon actions still work", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "hover and keyboard");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copied = text; } } });
  });
  await openApp(page, "#/t/11/c/190/s/11-22");
  const actions = page.locator(".provision .section-actions");
  const opacity = (locator) => locator.locator(".action-label").evaluate((element) => getComputedStyle(element).opacity);
  const citation = actions.getByRole("button", { name: "Copy citation", exact: true });
  await expect.poll(() => opacity(citation)).toBe("0");
  await citation.hover();
  await expect.poll(() => opacity(citation)).toBe("1");
  await page.mouse.move(0, 0);
  await citation.click();
  await expect.poll(() => page.evaluate(() => window.copied)).toBe("Conn. Gen. Stat. § 11-22");
  await expect(page.locator("[data-action-toast]")).toContainText("copied");
  const link = actions.getByRole("button", { name: "Copy link", exact: true });
  await link.click();
  await expect.poll(() => page.evaluate(() => window.copied)).toContain("#/t/11/c/190/s/11-22");
  await expect(page.locator("[data-action-toast]")).toHaveText("Link copied.");
  await expect(page.locator("[data-action-toast]")).toBeEmpty({ timeout: 4500 });
  await page.mouse.move(0, 0);
  await citation.focus();
  await page.keyboard.press("Tab");
  await expect(actions.getByRole("button", { name: "Bookmark" })).toBeFocused();
  await expect.poll(() => opacity(actions.getByRole("button", { name: "Bookmark" }))).toBe("1");
  await expect(actions.getByRole("link", { name: "Email" })).toHaveAttribute("href", /^mailto:/);
});

test("the saved bookmark icon is filled and the saved section appears on Bookmarks", async ({ page }) => {
  await openApp(page, "#/t/11/c/190/s/11-22");
  const button = page.locator(".provision .bookmark-button");
  await expect(button.locator("svg path")).toHaveCSS("fill", "none");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAccessibleName("Saved");
  const bookmark = button.locator(".bookmark-shape");
  const color = await bookmark.evaluate((path) => getComputedStyle(path).color);
  await expect(bookmark).toHaveCSS("fill", color);
  await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("[data-action-toast]")).toContainText("Bookmark saved");
  await page.evaluate(() => { location.hash = "#/bookmarks"; });
  await expect(page.getByRole("link", { name: "Sec. 11-22" }).first()).toBeVisible();
});

test("the Infractions bookmark keeps its visible label with the new icons", async ({ page }) => {
  await openApp(page, "#/infractions?q=boat");
  const button = page.locator(".compact-bookmark").first();
  await expect(button).toBeVisible();
  await expect(button.locator(".action-label")).toBeVisible();
  expect(await button.locator(".action-label").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  expect(await button.locator("svg path").getAttribute("d")).toMatch(/^M12 13V7/);
});

const stubShare = (page, behavior = "resolve") => page.addInitScript((mode) => {
  window.shared = [];
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (data) => {
      window.shared.push(data);
      if (mode === "abort") throw new DOMException("cancelled", "AbortError");
      if (mode === "fail") throw new DOMException("blocked", "NotAllowedError");
    }
  });
}, behavior);

test("Share shows only on touch devices that have a share sheet", async ({ page }, testInfo) => {
  await stubShare(page);
  await openApp(page, "#/t/11/c/190/s/11-22");
  const share = page.locator(".provision .section-actions").getByRole("button", { name: "Share", exact: true });
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect(coarse).toBe(isMobileProject(testInfo));
  await expect(share).toHaveCount(isMobileProject(testInfo) ? 1 : 0);
  if (!isMobileProject(testInfo)) return;
  // share-06, between Copy link and Email.
  expect((await share.locator("svg path").getAttribute("d")).startsWith("M20.791 12.607")).toBe(true);
  const names = await page.locator(".provision .section-actions > *").evaluateAll((items) => items.map((item) => item.textContent.trim()));
  expect(names).toEqual(["Copy citation", "Bookmark", "Copy link", "Share", "Email", "Official source"]);
  await share.click();
  await expect.poll(() => page.evaluate(() => window.shared.length)).toBe(1);
  const data = await page.evaluate(() => window.shared[0]);
  expect(data.title).toBe("Sec. 11-22. Expenses.");
  expect(data.url).toContain("#/t/11/c/190/s/11-22");
  await expect(page.locator("[data-action-toast]")).toHaveText("Share options opened.");
  await expectNoHighImpactAccessibilityViolations(page);
});

test("a touch device with no share sheet gets no Share button", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "touch only");
  await page.addInitScript(() => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); });
  await openApp(page, "#/t/11/c/190/s/11-22");
  await expect(page.locator(".provision .section-actions").getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
  await expect(page.locator(".provision .section-actions").getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
});

test("closing the share sheet says nothing, and a real failure points to Copy link", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "touch only");
  await stubShare(page, "abort");
  await openApp(page, "#/t/11/c/190/s/11-22");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.shared.length)).toBe(1);
  await expect(page.locator("[data-action-toast]")).toBeEmpty();
});

test("a share failure points to Copy link", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "touch only");
  await stubShare(page, "fail");
  await openApp(page, "#/t/11/c/190/s/11-22");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.locator("[data-action-toast]")).toContainText("Use Copy link instead");
});

for (const width of [320, 360, 375, 390, 430, 576]) {
  test(`the phone action row holds together at ${width}px with Share`, async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), "touch only");
    await stubShare(page);
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, "#/t/11/c/190/s/11-22");
    const row = page.locator(".provision .section-actions > *");
    await expect(row).toHaveCount(6);
    const boxes = await row.evaluateAll((items) => items.map((item) => { const b = item.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, w: b.width, h: b.height, clipped: (() => {
      const icon = item.querySelector("svg");
      if (!icon) return item.scrollWidth > item.clientWidth + 1;
      const glyph = icon.getBoundingClientRect();
      return glyph.left < b.left || glyph.right > b.right;
    })() }; }));
    for (const box of boxes) {
      expect(box.clipped).toBe(false);
      expect(box.r).toBeLessThanOrEqual(width);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.h).toBeGreaterThanOrEqual(44);
    }
    for (const box of boxes.slice(0, 5)) expect(box.w).toBeGreaterThanOrEqual(36);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    console.log(`${width}px: ${boxes.map((b) => Math.round(b.w)).join(" ")} / rows ${new Set(boxes.map((b) => Math.round(b.y))).size}`);
  });
}

test("Email uses the envelope icon", async ({ page }) => {
  await openApp(page, "#/t/11/c/190/s/11-22");
  const path = await page.locator(".provision .section-actions").getByRole("link", { name: "Email" }).locator("svg path").getAttribute("d");
  expect(path.startsWith("m2 7 8.165")).toBe(true);
});
