import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Auto theme is present before application JavaScript runs", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<html[^>]+data-theme="auto"[^>]+data-compact-lists="false"/);
});

test("reader and secondary-source surfaces use theme-aware colors", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const property of [
    "--reader-surface",
    "--amount-surface",
    "--highlight-surface",
    "--highlight-ink",
    "--warning-surface",
    "--warning-ink"
  ]) assert.match(styles, new RegExp(property));
  assert.match(styles, /\.legal-data-note[^}]+background: var\(--reader-surface\)/);
  assert.match(styles, /\.reader-sidebar \{[^}]+background: var\(--reader-surface\)/);
  assert.match(styles, /\.amounts div[^}]+background: var\(--amount-surface\)/);
  assert.doesNotMatch(styles, /:root\[data-theme="dark"\] \.legal-data-note/);
});
