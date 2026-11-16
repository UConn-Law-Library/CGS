import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { renderSupplementSummary } from "../scripts/prepare-supplement.mjs";
import { recordPublishedEdition, validatePublishedEditions } from "../scripts/lib/edition-archive.mjs";
import { buildEditionFixture } from "../scripts/lib/edition-fixture.mjs";

const workflow = await readFile(new URL("../.github/workflows/discover-supplement.yml", import.meta.url), "utf8");

test("supplement discovery is scheduled, manual, and review-gated", () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: "41 12 \* \* 4"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:\s*\n\s*group: supplement-discovery\s*\n\s*cancel-in-progress: false/);
  assert.match(workflow, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \] && \[ "\$CREATE_PULL_REQUEST" = "true" \]; then/);
  // Discovery decides; a network failure or invalid page fails the step through its exit code.
  assert.match(workflow, /python -m crawler\.cgs_crawler\.supplement_discovery[\s\S]*?--data public\/data[\s\S]*?exit "\$\{PIPESTATUS\[0\]\}"/);
  // Only an available, verified edition is crawled and imported against the published revision.
  assert.match(workflow, /Crawl, import, and validate the supplement\s*\n\s*if: steps\.discover\.outputs\.status == 'available'/);
  assert.match(workflow, /--edition supplement[\s\S]*?--supplement-year "\$YEAR"/);
  assert.match(workflow, /prepare-supplement\.mjs[\s\S]*?--base public\/data[\s\S]*?--year "\$YEAR"/);
  // A rehearsal never stages or publishes.
  assert.match(workflow, /CREATE_PULL_REQUEST: \$\{\{ github\.event_name == 'schedule' \|\| \(inputs\.create_pull_request && !inputs\.rehearse\) \}\}/);
  assert.match(workflow, /Stage and verify the supplement[\s\S]*?env\.REHEARSE != 'true'[\s\S]*?--stage[\s\S]*?npm run check/);
  // Matching artifacts on the open draft are not published again.
  assert.match(workflow, /git diff --quiet FETCH_HEAD -- public\/data[\s\S]*?Nothing to publish\.[\s\S]*?exit 0/);
  assert.doesNotMatch(workflow, /git push\s+origin\s+main/);
});

test("the pull request summary carries provenance, counts, and the review result", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-supplement-summary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { published } = await buildEditionFixture(root);
  const manifest = JSON.parse(await readFile(path.join(published, "supplements", "2026", "manifest.json"), "utf8"));
  const catalog = JSON.parse(await readFile(path.join(published, "catalog.json"), "utf8"));
  const summary = renderSupplementSummary({ manifest, catalog, baseManifestSha256: "a".repeat(64), discovery: { heading: "Revised to January 1, 2026" }, errors: [] });
  assert.match(summary, /# The 2026 Supplement/);
  assert.match(summary, /\[2026 Supplement to the General Statutes of Connecticut\]\(https:\/\/www\.cga\.ct\.gov\/2026\/sup\/titles\.htm\)/);
  assert.match(summary, /Read with: the 2025 revision in `public\/data`/);
  assert.match(summary, /1 replace a provision of the 2025 revision and 1 are new/);
  assert.match(summary, /Import and validation passed/);
  assert.match(renderSupplementSummary({ manifest, catalog, baseManifestSha256: "a".repeat(64), errors: ["boom"] }), /Validation failed:\n\n- boom/);

  // Listing the edition is idempotent, and the list must cover the published data.
  assert.match((await validatePublishedEditions({ dataDir: published, schemaDir: "schemas" })).errors.join("\n"), /published\.json is missing/);
  for (const [year, kind, part] of [[2025, "revision", "pub"], [2026, "supplement", "sup"]]) {
    assert.equal(await recordPublishedEdition(published, { year, kind, url: `https://www.cga.ct.gov/${year}/${part}/titles.htm` }), true);
  }
  assert.equal(await recordPublishedEdition(published, { year: 2026, kind: "supplement", url: "https://www.cga.ct.gov/2026/sup/titles.htm" }), false);
  assert.deepEqual((await validatePublishedEditions({ dataDir: published, schemaDir: "schemas" })).errors, []);
});

test("the published list must name the active revision and each published supplement", async () => {
  const result = await validatePublishedEditions({ dataDir: "public/data", schemaDir: "schemas" });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.editions.map((edition) => edition.year), [2023, 2024, 2025, 2026]);
});
