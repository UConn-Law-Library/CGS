// Capture the locally built prototype; does not contact or publish to production.
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const output = "reports/modernization";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [device, width, height] of [["desktop", 1440, 1000], ["tablet", 768, 1024], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    for (const [name, route] of [["home", "#/"], ["reader", "#/t/01/c/004/s/1-24"], ["search", "#/search?q=oaths&title=title-01&chapter=004"]]) {
      await page.goto(`http://127.0.0.1:4173/${route}`);
      await page.locator("main:not(.loading):not(.error) h1").waitFor();
      if (name === "search") await page.waitForFunction(() => document.querySelector("#search-status")?.textContent.startsWith("Showing"));
      if (name === "reader") await page.waitForFunction(() => !document.querySelector("[data-amendments-status]")?.textContent.includes("loading"));
      // Route focus is tested separately. Show the resting visual state here.
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({ animations: "disabled", path: `${output}/${device}-${name}.png` });
      if (name === "reader") {
        await page.evaluate(() => document.documentElement.dataset.theme = "dark");
        await page.screenshot({ animations: "disabled", path: `${output}/${device}-reader-dark.png` });
        await page.evaluate(() => document.documentElement.dataset.theme = "light");
        if (device === "mobile") {
          await page.getByRole("button", { name: "Browse chapter", exact: true }).click();
          await page.getByLabel("Filter chapter sections", { exact: true }).fill("1-25");
          await page.screenshot({ animations: "disabled", path: `${output}/mobile-chapter-sheet.png` });
        }
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`Saved prototype screenshots to ${output}/`);
