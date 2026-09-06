import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRecentUpdates } from "../scripts/lib/site-updates.mjs";
import { renderSiteUpdates } from "../src/site-updates.js";
import { shellInputs } from "../scripts/lib/pwa-build.mjs";

const commit = (letter) => letter.repeat(40);
const log = [
  `${commit("a")}\t2026-09-05\tFix missing statute links`,
  `${commit("b")}\t2026-09-04\tUpdate .gitignore`,
  `${commit("c")}\t2026-09-03\tAdd Public Act links`,
  `${commit("d")}\t2026-09-02\tRefresh source data`
].join("\n");

test("generates bounded updates with curated summaries and automatic future entries", () => {
  const updates = buildRecentUpdates(log, {
    [commit("a")]: { title: "Follow citation ranges", summary: "Both endpoints are clickable.", category: "Bug fix" },
    [commit("b")]: { hidden: true },
    [commit("e")]: { title: "An update outside this checkout" }
  }, 2);
  assert.deepEqual(updates, [
    { commit: commit("a"), date: "2026-09-05", title: "Follow citation ranges", summary: "Both endpoints are clickable.", category: "Bug fix" },
    { commit: commit("c"), date: "2026-09-03", title: "Add Public Act links", summary: "", category: "Enhancement" }
  ]);
  assert.equal(buildRecentUpdates(log)[3].category, "Maintenance");
  assert.deepEqual(buildRecentUpdates(""), []);
  assert.deepEqual(buildRecentUpdates("invalid\t2026-09-05\tMissing commit\n"), []);
});

test("shows the latest three entries with expandable earlier updates and commit links", () => {
  const html = renderSiteUpdates(buildRecentUpdates(log));
  assert.match(html, /<h2 id="about-updates-heading">Recent updates<\/h2>/);
  const [latest, earlier] = html.split('<details class="about-updates-more">');
  assert.equal((latest.match(/<li class="about-update">/g) ?? []).length, 3);
  assert.equal((earlier.match(/<li class="about-update">/g) ?? []).length, 1);
  assert.match(earlier, /Show 1 earlier update<\/summary>/);
  assert.match(html, /<time datetime="2026-09-05">Sep 5, 2026<\/time>/);
  assert.match(html, new RegExp(`href="https://github.com/UConn-Law-Library/CGS/commit/${commit("a")}"`));
  assert.match(html, /View full commit history on GitHub/);
});

test("escapes commit text and provides an empty-state history link", () => {
  const html = renderSiteUpdates([{ commit: commit("a"), date: "2026-09-05", category: "Bug fix", title: '<script>alert("x")</script>', summary: "A & B" }]);
  assert.doesNotMatch(html, /<script>|<details/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(renderSiteUpdates(), /Update details are unavailable/);
  assert.doesNotMatch(renderSiteUpdates(), /<ol|<details/);
});

test("caches and fingerprints the changelog renderer with its embedded release data", async () => {
  const worker = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");
  for (const file of ["release.js", "site-updates.js"]) {
    assert.ok(shellInputs.includes(file));
    assert.ok(worker.includes(`"./${file}"`));
  }
});

test("build and browser deployment jobs fetch history for the embedded changelog", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  for (const job of ["build", "browser"]) {
    assert.match(workflow, new RegExp(`\n  ${job}:[\\s\\S]*?steps:\\s+- uses: actions/checkout@v4\\s+with:\\s+fetch-depth: 0`));
  }
});
