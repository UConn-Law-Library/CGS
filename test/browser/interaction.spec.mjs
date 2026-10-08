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

test("the effective-date view lists Public Act sections by date and opens only those sections", async ({ page }) => {
  await openApp(page, "#/acts");
  await page.getByRole("navigation", { name: "Acts view" }).getByRole("link", { name: "By effective date" }).click();
  await expect(page).toHaveURL(/#\/acts\?view=effective$/);
  await expect(page.getByRole("status").filter({ hasText: /^Showing all \d+ effective dates in \d+ Public Acts\.$/ })).toBeVisible();
  const table = page.locator(".acts-effective-table");
  await expect(table.locator("thead th[aria-sort]")).toHaveText(/^Effective/);
  const actHeading = table.getByRole("link", { name: /^Public Act/ });
  await actHeading.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  await actHeading.click();
  await expect(page).toHaveURL(/#\/acts\?view=effective&sort=act$/);
  // Sorting keeps the reader's place and focus on the heading.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect(actHeading).toBeFocused();
  await table.getByRole("link", { name: /^Public Act/ }).click();
  await expect(page).toHaveURL(/#\/acts\?view=effective&sort=act&order=desc$/);
  await expect(table.locator("thead th[aria-sort=descending]")).toHaveText(/^Public Act/);
  await expect(table.locator("tbody th").first()).toHaveText("P.A. 26-151");
  await page.getByLabel("Effective").selectOption({ label: "July 1, 2026" });
  await page.getByLabel("Search Public Acts").fill("PA 26-150");
  const apply = page.getByRole("button", { name: "Apply" });
  await apply.click();
  await expect(page).toHaveURL(/#\/acts\?view=effective&q=PA%2026-150&sort=act&order=desc&on=2026-07-01$/);
  // Filtering keeps the form where the reader left it.
  await expect(apply).toBeFocused();
  await expect(apply).toBeInViewport();
  const row = page.getByRole("row").filter({ hasText: "P.A. 26-150" });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("cell").nth(0)).toHaveText("July 1, 2026");
  await expect(row.getByRole("cell").nth(1)).toHaveText("An act adopting the integrated setting standard of the Americans with Disabilities Act for public entities.");
  await row.getByRole("link", { name: "Secs. 1–2" }).click();

  await expect(page).toHaveURL(/#\/acts\/2026-regular\/pa-150\?sections=1-2$/);
  await expect(page.getByRole("status").filter({ hasText: "Showing Secs. 1–2 of" })).toContainText("Effective July 1, 2026");
  await expect(page.locator("#sec-1")).toBeVisible();
  await page.getByRole("link", { name: "Show the whole act" }).click();
  await expect(page).toHaveURL(/#\/acts\/2026-regular\/pa-150$/);
  await expect(page.locator(".act-selection")).toHaveCount(0);
});

test("act text search opens the act with matches highlighted, sections, and statute links", async ({ page }) => {
  await openApp(page, "#/acts");
  await page.getByLabel("Search acts").fill("reverse vending machine");
  await page.getByRole("button", { name: "Apply" }).click();
  const row = page.getByRole("row").filter({ hasText: "P.A. 26-2" });
  await expect(row.getByText("Search words appear in the act's text")).toBeVisible();
  await row.getByRole("link", { name: /REDEMPTION OF OUT-OF-STATE BEVERAGE CONTAINERS/ }).click();
  await expect(page).toHaveURL(/#\/acts\/2026-regular\/pa-2\?q=reverse%20vending%20machine$/);
  await expect(page.getByRole("heading", { level: 1, name: "P.A. 26-2" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /matches for “reverse vending machine” highlighted/ })).toBeVisible();
  const text = page.locator("[data-act-text]");
  await expect(text.locator("mark").first()).toBeInViewport();
  await expect(text.locator("ins").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Official PDF" })).toHaveAttribute("href", /2026PA-00002-R00SB-00299-PA\.pdf$/);

  await page.locator(".act-sections").getByRole("link", { name: "Sec. 3", exact: true }).click();
  await expect(page).toHaveURL(/\?section=3&q=/);
  await expect(page.locator("#sec-3")).toBeFocused();
  await expect(page.locator("#sec-3")).toBeInViewport();

  await page.locator("#sec-1").getByRole("link", { name: "22a-245", exact: true }).click();
  await expect(page).toHaveURL(/#\/t\/22a\/c\/446d\/s\/22a-245$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 22a-245\./ })).toBeVisible();
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
    - paragraph: Browse and search the statutes, the official subject index, the Judicial Branch infraction schedule, and recent Public and Special Acts. Save frequently used material on this device.
  `);
  for (const name of ["Statutes", "Index", "Infractions", "Acts", "Bookmarks", "Settings"]) {
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
  // The build embeds history from its own checkout, which may hold only a few
  // commits (pull-request merge builds in CI expose three), so expect what it embedded.
  const embedded = await page.evaluate(async () => (await import("/release.js")).RECENT_UPDATES.map(({ title }) => title));
  await expect(recent.locator("li")).toHaveCount(Math.min(3, embedded.length));
  await expect(recent.getByRole("heading", { level: 3 }).first()).toHaveText(embedded[0]);
  await expect(recent.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(recent.getByRole("link").first()).toHaveAttribute("href", /^https:\/\/github\.com\/UConn-Law-Library\/CGS\/commit\/[a-f0-9]{40}$/);
  await updates.screenshot({ path: testInfo.outputPath("recent-updates.png") });
  const earlier = updates.getByRole("list", { name: "Earlier updates", exact: true });
  if (embedded.length <= 3) {
    await expect(updates.locator("summary")).toHaveCount(0);
    return;
  }
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

test("offline feedback stays in the dialog instead of leaving the app", async ({ page, context }) => {
  let posted = false;
  await page.route("https://formsubmit.co/**", (route) => { posted = true; return route.abort(); });
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Submit feedback/ }).click();
  const dialog = page.getByRole("dialog", { name: "Submit feedback" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Jane Reader");
  await dialog.getByRole("textbox", { name: "Email" }).fill("jane@example.edu");
  await dialog.getByRole("textbox", { name: "Feedback" }).fill("Kept while offline.");
  await context.setOffline(true);
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/offline.*still here/i);
  await expect(dialog.getByRole("textbox", { name: "Feedback" })).toHaveValue("Kept while offline.");
  expect(posted).toBe(false);
  await context.setOffline(false);
});

test("focus rings and form field edges reach 3:1 against their surfaces in every theme", async ({ page }) => {
  await openApp(page, "#/acts");
  const ratio = (locator, property) => locator.evaluate((element, colorProperty) => {
    const luminance = (value) => value.match(/[\d.]+/g).slice(0, 3).map((part) => {
      const channel = Number(part) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    let surface = element.parentElement;
    while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
    const back = luminance(getComputedStyle(surface ?? document.body).backgroundColor);
    const edge = luminance(getComputedStyle(element)[colorProperty]);
    return (Math.max(back, edge) + .05) / (Math.min(back, edge) + .05);
  }, property);
  const field = page.locator("main select").first();
  for (const theme of ["light", "dark", "oled"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    expect(await ratio(field, "borderTopColor"), `${theme} field edge`).toBeGreaterThanOrEqual(3);
    await field.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await field.evaluate((element) => element.matches(":focus-visible") && getComputedStyle(element).outlineStyle)).toBe("solid");
    expect(await ratio(field, "outlineColor"), `${theme} focus ring`).toBeGreaterThanOrEqual(3);
  }
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

test("a statute section loads without full-text search or subject-index shards", async ({ page }) => {
  const requested = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await openApp(page, "#/t/17b/c/319v/s/17b-238");
  const statute = page.locator("article.provision .statute-text");
  await expect(statute.getByRole("link", { name: "17b-239", exact: true }).first()).toHaveAttribute("href", "#/t/17b/c/319v/s/17b-239");
  expect(requested.filter((path) => /\/data\/search\/title-|\/statutes-index\/(?!manifest)/.test(path))).toEqual([]);
  // Each data file arrives once: the early chapter request is the one the page uses.
  const dataRequests = requested.filter((path) => path.includes("/data/"));
  expect(dataRequests.filter((path, index) => dataRequests.indexOf(path) !== index)).toEqual([]);
  expect(dataRequests).toContain("/data/chapters/319v.json");

  const indexGroup = page.locator("details[data-deferred-index]");
  await indexGroup.locator("summary").click();
  await expect(page.locator("[data-linked-index] .secondary-record").first()).toBeVisible();
  expect(requested.some((path) => /\/statutes-index\/(?!manifest)/.test(path))).toBe(true);
});

test("keyboard navigation moves focus to the new page heading", async ({ page }) => {
  await openApp(page);
  await page.locator('.app-nav a[href="#/acts"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Public and Special Acts" })).toBeFocused();
});

test("choosing a section from the pane keeps focus in the pane and announces the page", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Navigation panes are desktop only.");
  await openApp(page, "#/t/17b/c/319v/s/17b-238");
  await page.locator('.sections-column a[href="#/t/17b/c/319v/s/17b-239"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /Sec\. 17b-239\./ })).toBeVisible();
  await expect(page.locator('.sections-column a[href="#/t/17b/c/319v/s/17b-239"]')).toBeFocused();
  await expect(page.locator("[data-route-announcer]")).toHaveText(/Sec\. 17b-239/);
});

test("Settings closes with Escape or a click outside the panel", async ({ page }) => {
  await openApp(page);
  const button = page.getByRole("button", { name: "Settings" });
  const panel = page.getByRole("dialog", { name: "Settings" });
  await button.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  // On phones the open panel covers the page, so press outside it directly.
  await page.locator("main").dispatchEvent("pointerdown");
  await expect(panel).toBeHidden();
});

test("narrower desktop windows give the reading column room by dropping outer panes", async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo), "Contextual rails are a desktop presentation.");
  await openApp(page, "#/t/17b/c/319v/s/17b-238");
  const panes = page.locator(".context-column");
  await expect(panes).toHaveCount(3);
  for (const pane of await panes.all()) await expect(pane).toBeVisible();
  const layout = () => page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reading: document.querySelector("main").getBoundingClientRect().width,
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize)
  }));
  // A window resize refits the panes without a new render.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator(".titles-column")).toBeHidden();
  await expect(page.locator(".chapters-column")).toBeHidden();
  await expect(page.locator(".sections-column")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Chapter 319v" })).toBeVisible();
  let measured = await layout();
  expect(measured.overflow).toBe(0);
  expect(measured.reading).toBeGreaterThanOrEqual(33.5 * measured.rem);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.locator(".context-column:not([hidden])")).toHaveCount(2);
  measured = await layout();
  expect(measured.overflow).toBe(0);
  expect(measured.reading).toBeGreaterThanOrEqual(33.5 * measured.rem);
});

test("the bottom bar keeps its labels on 360px and 375px phones", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Checks the phone layout.");
  for (const width of [360, 375]) {
    await page.setViewportSize({ width, height: 780 });
    await openApp(page);
    for (const item of await page.locator(".app-nav > a, .app-nav > button").all()) {
      const fit = await item.evaluate((element) => {
        const label = element.querySelector("span:nth-child(2)").getBoundingClientRect();
        return { label: label.width, item: element.getBoundingClientRect().width };
      });
      expect(fit.label, `label shown at ${width}px`).toBeGreaterThan(10);
      expect(fit.label, `label fits its column at ${width}px`).toBeLessThanOrEqual(fit.item);
    }
  }
});

test("a subsection link opens with the subsection clear of the sticky header and panes", async ({ page }, testInfo) => {
  await openApp(page, "#/t/17b/c/319v/s/17b-238/p/b");
  const target = page.locator(".statute-paragraph.subsection-target");
  await expect(target).toBeVisible();
  const layout = await page.evaluate(() => {
    const header = document.querySelector(".site-header").getBoundingClientRect().bottom;
    const tools = document.querySelector(".mobile-reader-tools");
    const covered = tools && getComputedStyle(tools).display !== "none" ? Math.max(header, tools.getBoundingClientRect().bottom) : header;
    const pane = document.querySelector(".context-column:not([hidden])");
    return {
      covered,
      target: document.querySelector(".subsection-target").getBoundingClientRect().top,
      paneTop: pane && getComputedStyle(pane).display !== "none" ? pane.getBoundingClientRect().top : null,
      header
    };
  });
  expect(layout.target).toBeGreaterThanOrEqual(layout.covered);
  if (!isMobileProject(testInfo)) expect(Math.round(layout.paneTop)).toBe(Math.round(layout.header));
});

test("the header and pages reflow without sideways scrolling at 200% text", async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), "Checks the phone layout.");
  for (const route of ["#/t/17b/c/319v/s/17b-238", "#/search?q=negligence", "#/index", "#/infractions"]) {
    await openApp(page, route);
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expect(page.locator(".site-header")).toHaveCSS("position", "relative");
  }
});
