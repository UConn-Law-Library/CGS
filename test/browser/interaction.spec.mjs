import { expect, test } from "@playwright/test";
import { isMobileProject, openApp } from "./helpers.mjs";

async function textContrastRatios(locator, childSelector = null) {
  return locator.evaluate((element, selector) => {
    const luminance = (value) => value.match(/\d+/g).slice(0, 3).map((part) => {
      const channel = Number(part) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const background = luminance(getComputedStyle(element).backgroundColor);
    const nodes = selector ? [element, ...element.querySelectorAll(selector)] : [element];
    return nodes.map((node) => {
      const foreground = luminance(getComputedStyle(node).color);
      return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
    });
  }, childSelector);
}

test("statute ranges link both endpoints and navigate to the referenced section", async ({ page }) => {
  await openApp(page, "#/t/04/c/050/s/4-66aa");
  const statute = page.locator("article.provision .statute-text");
  await expect(statute.getByRole("link", { name: "10-409", exact: true })).toHaveAttribute("href", "#/t/10/c/184b/s/10-409");
  const endpoint = statute.getByRole("link", { name: "10-415", exact: true });
  await expect(endpoint).toHaveAttribute("href", "#/t/10/c/184b/s/10-415");
  await endpoint.click();
  await expect(page).toHaveURL(/#\/t\/10\/c\/184b\/s\/10-415$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 10-415\./ })).toBeVisible();
});

test("Public Act references link to CGA from statute text and reference notes", async ({ page }) => {
  await openApp(page, "#/t/04a/c/058/s/4a-52a");
  const href = "https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Public+Act&which_year=1993&bill_num=336";
  const act = page.locator("article.provision .statute-text").getByRole("link", { name: "93-336", exact: true });
  await expect(act).toHaveAttribute("href", href);
  await expect(act).toHaveAttribute("target", "_blank");
  await expect(act).toHaveAttribute("rel", "noopener noreferrer");
  const notes = page.locator(".information-references");
  await expect(notes.locator(`a[href="${href}"]`)).toHaveCount(1);
  await expect(notes.locator('a[href*="which_year=1993&bill_num=201"]')).toHaveCount(2);
  await expect(notes.getByRole("link", { name: "88-192", exact: true })).toHaveCount(0);
});

test("abbreviated See references in 2-71h link to the referenced statutes", async ({ page }) => {
  await openApp(page, "#/t/02/c/018a/s/2-71h");
  const statute = page.locator("article.provision .statute-text");
  for (const [citation, href] of [
    ["4b-54", "#/t/04b/c/060/s/4b-54"],
    ["5-142", "#/t/05/c/065/s/5-142"],
    ["5-145a", "#/t/05/c/065/s/5-145a"],
    ["29-8a", "#/t/29/c/529/s/29-8a"],
    ["53-39a", "#/t/53/c/939/s/53-39a"]
  ]) {
    await expect(statute.getByRole("link", { name: citation, exact: true })).toHaveAttribute("href", href);
  }
  await expect(statute.locator("p").filter({ hasText: "See Sec. 4b-54(b)" })).toBeVisible();
  await statute.getByRole("link", { name: "4b-54", exact: true }).click();
  await expect(page).toHaveURL(/#\/t\/04b\/c\/060\/s\/4b-54$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 4b-54\./ })).toBeVisible();
});

test("Home exposes the core application destinations", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".home-intro")).toMatchAriaSnapshot(`
    - heading "Connecticut General Statutes" [level=1]
    - paragraph: Browse and search the statutes, the official subject index, and the Judicial Branch infraction schedule. Save frequently used material on this device.
  `);
  for (const name of ["Statutes", "Index", "Infractions", "Bookmarks", "Settings"]) {
    await expect(page.getByRole(name === "Settings" ? "button" : "link", { name: new RegExp(name) }).first()).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Settings closes and restores focus to its trigger", async ({ page }) => {
  await openApp(page);
  const trigger = page.getByRole("button", { name: "Settings" });
  await trigger.click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Text size slider follows Font and persists its value", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const font = page.getByLabel("Font", { exact: true });
  const slider = page.getByLabel("Text size");
  expect(await font.evaluate((element) => Boolean(element.closest(".setting-group").nextElementSibling.querySelector("[data-text-size]")))).toBe(true);
  await slider.fill("1.2");
  await expect(page.locator("[data-text-size-value]")).toHaveText("120%");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("19.2px");
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Text size")).toHaveValue("1.2");
  await expect(page.locator("[data-text-size-value]")).toHaveText("120%");
});

test("Hide repealed sections keeps Settings open and focused after the chapter redraws", async ({ page }) => {
  await openApp(page, "#/t/03/c/033/s/3-99h");
  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  await settingsButton.click();
  const checkbox = page.locator("input[data-hide-repealed]");
  await checkbox.check();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await checkbox.uncheck();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(checkbox).not.toBeChecked();
});

test("Compact lists changes chapter navigation density", async ({ page }, testInfo) => {
  await openApp(page, "#/t/02/c/017");
  const row = page.locator(isMobileProject(testInfo) ? ".mobile-section-browser .context-list a" : ".context-column .context-list a").first();
  const compactHeight = (await row.boundingBox()).height;
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("input[data-compact-lists]").uncheck();
  const comfortableHeight = (await row.boundingBox()).height;
  expect(comfortableHeight).toBeGreaterThan(compactHeight + 5);
  await page.locator("input[data-compact-lists]").check();
  expect((await row.boundingBox()).height).toBe(compactHeight);
});

test("feedback action keeps readable hover contrast in light and dark themes", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Hover is a desktop interaction");
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const feedback = page.locator("[data-open-feedback]");
  for (const theme of ["light", "dark"]) {
    await page.locator(`[data-theme-value="${theme}"]`).click();
    await feedback.hover();
    const ratios = await textContrastRatios(feedback, "small");
    expect(ratios.every((ratio) => ratio >= 4.5), `${theme} hover contrast: ${ratios.join(", ")}`).toBe(true);
  }
});

test("section action buttons have readable contrast in dark mode", async ({ page }) => {
  await openApp(page, "#/t/03/c/033/s/3-99h");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator('[data-theme-value="dark"]').click();
  for (const button of await page.locator(".section-actions button").all()) {
    const ratio = (await textContrastRatios(button))[0];
    expect(ratio, `Contrast of ${await button.innerText()}: ${ratio}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("font and line spacing settings apply across the app and survive reload", async ({ page }) => {
  await openApp(page, "#/t/02c/c/028a/s/2c-21");
  const statute = page.locator(".statute-text").first();
  const originalFont = await statute.evaluate((element) => getComputedStyle(element).fontFamily);
  const originalSpacing = await statute.evaluate((element) => getComputedStyle(element).lineHeight);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Font", { exact: true }).selectOption("atkinson");
  await expect.poll(() => statute.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Atkinson Hyperlegible");
  await expect.poll(() => page.locator(".brand").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Atkinson Hyperlegible");
  for (const [profile, family] of [["atkinson", "Atkinson Hyperlegible"], ["lexend", "Lexend"], ["inclusive", "Inclusive Sans"]]) {
    await page.getByLabel("Font", { exact: true }).selectOption(profile);
    expect(await page.evaluate(async (name) => (await document.fonts.load(`16px "${name}"`)).length, family)).toBeGreaterThan(0);
  }
  await page.getByLabel("Font", { exact: true }).selectOption("atkinson");
  await page.getByLabel("Line spacing").fill("1.9");
  await expect(page.locator("[data-line-spacing-value]")).toHaveText("1.90×");
  expect(await statute.evaluate((element) => getComputedStyle(element).lineHeight)).not.toBe(originalSpacing);
  await page.reload();
  await expect(page.locator(".statute-text").first()).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("atkinson");
  await expect(page.getByLabel("Line spacing")).toHaveValue("1.9");
  await page.getByLabel("Font", { exact: true }).selectOption("default");
  await expect.poll(() => page.locator(".statute-text").first().evaluate((element) => getComputedStyle(element).fontFamily)).toBe(originalFont);
});

test("About links to the deployed GitHub release", async ({ page }) => {
  await openApp(page, "#/about");
  const release = page.locator(".about-version a");
  await expect(release).toHaveText(/^v\d+\.\d+\.\d+ ↗$/);
  const version = (await release.textContent()).trim().split(" ")[0];
  await expect(release).toHaveAttribute("href", `https://github.com/UConn-Law-Library/CGS/releases/tag/${version}`);
});

test("About shows recent updates and expands earlier changes", async ({ page }, testInfo) => {
  await openApp(page, "#/about");
  const updates = page.getByRole("region", { name: "Recent updates" });
  await expect(updates.getByRole("heading", { name: "Recent updates", exact: true })).toBeVisible();
  const recent = updates.getByRole("list", { name: "Latest updates", exact: true });
  await expect(recent.locator("li")).toHaveCount(3);
  const latestTitle = await page.evaluate(async () => (await import("/release.js")).RECENT_UPDATES[0].title);
  await expect(recent.getByRole("heading", { level: 3 }).first()).toHaveText(latestTitle);
  await expect(recent.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(recent.getByRole("link").first()).toHaveAttribute("href", /^https:\/\/github\.com\/UConn-Law-Library\/CGS\/commit\/[a-f0-9]{40}$/);
  await updates.screenshot({ path: testInfo.outputPath("recent-updates.png") });
  const earlier = updates.getByRole("list", { name: "Earlier updates", exact: true });
  await expect(earlier).toBeHidden();
  await updates.locator("summary").click();
  await expect(earlier).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("desktop contextual rail retains its scroll position after section navigation", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Contextual rails are a desktop presentation.");
  await openApp(page, "#/t/17b/c/319v/s/17b-238");
  const sections = page.locator(".sections-column");
  const before = await sections.evaluate((element) => element.scrollTop);
  await sections.locator('a[href="#/t/17b/c/319v/s/17b-239"]').click();
  await expect(page).toHaveURL(/#\/t\/17b\/c\/319v\/s\/17b-239$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 17b-239/ })).toBeVisible();
  const after = await sections.evaluate((element) => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});

test("desktop navigation panes resize and stay collapsed until shown again", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Contextual rails are a desktop presentation.");
  await openApp(page, "#/t/02c/c/028a/s/2c-21");
  const firstPane = page.locator(".context-column").first();
  const firstResize = page.getByRole("separator", { name: /Resize.*pane/ }).first();
  const initialWidth = await firstPane.evaluate((element) => element.getBoundingClientRect().width);
  const bounds = await firstResize.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 48, bounds.y + 100);
  await page.mouse.up();
  const resizedWidth = await firstPane.evaluate((element) => element.getBoundingClientRect().width);
  expect(resizedWidth).toBeGreaterThan(initialWidth + 30);

  const hidePanes = page.getByRole("button", { name: "Hide navigation panes" });
  await expect(hidePanes).toHaveText("‹");
  await hidePanes.click();
  await expect(firstPane).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 2c-21/ })).toBeVisible();
  await page.reload();
  const showPanes = page.getByRole("button", { name: "Show navigation panes" });
  await expect(showPanes).toHaveText("›");
  await expect(firstPane).toBeHidden();
  await showPanes.click();
  await expect(firstPane).toBeVisible();
  expect(await firstPane.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(resizedWidth, 0);
});

test("pane toggle stays clear of the navigation scrollbar", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Contextual rails are a desktop presentation.");
  await page.setViewportSize({ width: 1031, height: 910 });
  await openApp(page);
  const paneEdge = await page.locator(".context-column").first().evaluate((element) => element.getBoundingClientRect().right);
  const toggle = page.getByRole("button", { name: "Hide navigation panes" });
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox.x).toBeGreaterThan(paneEdge);
});

test("Settings feedback form posts to the Law Library through FormSubmit", async ({ page }) => {
  let submission;
  await page.route("https://formsubmit.co/**", async (route) => {
    submission = { url: route.request().url(), method: route.request().method(), body: route.request().postData() };
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Feedback received</title>" });
  });
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const feedbackButton = page.getByRole("button", { name: /Submit feedback/ });
  await feedbackButton.click();
  const dialog = page.getByRole("dialog", { name: "Submit feedback" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(feedbackButton).toBeFocused();
  await feedbackButton.click();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Jane Reader");
  await dialog.getByRole("textbox", { name: "Email" }).fill("jane@example.edu");
  await dialog.getByRole("textbox", { name: "Feedback" }).fill("Please improve the chapter navigation.");
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect.poll(() => submission?.method).toBe("POST");
  expect(submission.url).toBe("https://formsubmit.co/lawlibraryadministration@uconn.edu");
  const body = new URLSearchParams(submission.body);
  expect(body.get("name")).toBe("Jane Reader");
  expect(body.get("email")).toBe("jane@example.edu");
  expect(body.get("message")).toBe("Please improve the chapter navigation.");
  expect(body.get("_subject")).toBe("Connecticut General Statutes feedback");
});

test("Clear Data actions require confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cgs.bookmarks.v1", JSON.stringify([{ id: "saved", href: "#/t/02c/c/028a/s/2c-21" }]));
    localStorage.setItem("cgs.recents.v1", JSON.stringify([{ id: "viewed", type: "statute", title: "Viewed", href: "#/t/02c/c/028a/s/2c-21", viewedAt: new Date().toISOString() }]));
    localStorage.setItem("cgs.search-history.v1", JSON.stringify([{ query: "law", href: "#/search?q=law", searchedAt: new Date().toISOString() }]));
  });
  await openApp(page, "#/t/02c/c/028a/s/2c-21");
  await page.getByRole("button", { name: "Settings" }).click();
  const menu = page.locator(".clear-data-menu");
  await expect(menu.getByRole("button", { name: /Clear bookmarks/ })).toBeHidden();
  await menu.locator("summary").click();
  for (const [buttonName, storageKey] of [
    ["Clear bookmarks", "cgs.bookmarks.v1"],
    ["Clear recent history", "cgs.recents.v1"],
    ["Clear search history", "cgs.search-history.v1"]
  ]) {
    const button = menu.getByRole("button", { name: new RegExp(buttonName) });
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Clear data?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).length, storageKey)).toBeGreaterThan(0);
    await button.click();
    await dialog.getByRole("button", { name: "Clear data" }).click();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).length, storageKey)).toBe(0);
    await expect(button).toBeDisabled();
  }
});

test("mobile chapter sheet closes and restores focus", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "The chapter sheet is a mobile reader control.");
  await openApp(page, "#/t/17b/c/319v/s/17b-238");
  const trigger = page.getByRole("button", { name: "Browse chapter" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Chapter 319v sections" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Boolean full-text search highlights phrase matches and can show more", async ({ page }) => {
  await openApp(page, "#/search?q=%22Effective%20January%22");
  await expect(page.locator("#search-status")).toContainText(/Showing 50 of [\d,]+ results/);
  await expect(page.locator("#results mark").first()).toHaveText(/Effective January/i);
  const more = page.getByRole("button", { name: /Show 50 more results/ });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator("#search-status")).toContainText(/Showing 100 of \d+ results/);
});

test("Search v2 preserves filters, explains the query, searches within results, and records history", async ({ page }) => {
  await openApp(page, "#/search?q=public&title=title-01&field=heading&sort=citation");
  await expect(page.locator("#search-title")).toHaveValue("title-01");
  await expect(page.locator("#search-field")).toHaveValue("heading");
  await expect(page.locator("#search-sort")).toHaveValue("citation");
  await expect(page.getByRole("heading", { level: 2, name: "public" })).toBeVisible();
  await expect(page.locator("#search-status")).toContainText(/Showing|No results/);

  await page.locator("#search-within-query").fill("records");
  await page.locator("[data-search-within]").getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/within=records/);
  await expect(page.getByRole("heading", { level: 2, name: "public AND records" })).toBeVisible();
  await page.locator(".search-history").click();
  await expect(page.locator(".search-history-list a").first()).toHaveAttribute("href", /within=records/);
});

test("bookmarks remain available on the device-local bookmarks page", async ({ page }) => {
  await openApp(page, "#/t/01/c/006/s/1-34");
  await page.getByRole("button", { name: /Bookmark/ }).click();
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("link", { name: /^Bookmarks/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bookmarks" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sec\. 1-34/ })).toBeVisible();
});

test("a targeted statute paragraph exposes and copies its citation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          window.__copiedCitation = value;
        }
      }
    });
  });
  await openApp(page, "#/t/01/c/006/s/1-34/p/1");

  const targeted = page.locator("#subsection-1");
  const copyCitation = targeted.getByRole("button", { name: "Copy C.G.S. § 1-34(1)" });
  await expect(targeted).toHaveClass(/subsection-target/);
  await expect(copyCitation).toBeVisible();
  await expect(page.locator("#subsection-2 .copy-citation")).toBeHidden();

  await copyCitation.click();
  await expect(copyCitation).toHaveText("Copied");
  await expect(page.locator(".action-status")).toHaveText("C.G.S. § 1-34(1) copied.");
  await expect.poll(() => page.evaluate(() => window.__copiedCitation)).toBe("C.G.S. § 1-34(1)");
});

test("print mode keeps statute text and removes application chrome", async ({ page }) => {
  await openApp(page, "#/t/01/c/006/s/1-34");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.locator(".context-column").first()).toBeHidden();
  await expect(page.locator("article.provision .statute-text")).toBeVisible();
});

test("the search shortcut moves focus to the omnisearch field", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("/");
  await expect(page.locator("#global-query")).toBeFocused();
});
