import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEditionFixture } from "../scripts/lib/edition-fixture.mjs";
import { listFiles, renderRolloverSummary, rolloverEdition, treeDigest, validateStatuteArchives } from "../scripts/lib/edition-archive.mjs";
import { planSupplementRebind } from "../scripts/lib/supplement-retirement.mjs";
import { importSupplement } from "../scripts/lib/supplement-importer.mjs";
import { validateCorpus } from "../scripts/lib/validator.mjs";
import { validateSupplement } from "../scripts/lib/supplement-validator.mjs";

const schemaDir = path.resolve("schemas");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-rollover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, ...(await buildEditionFixture(root)) };
}

const exists = async (target) => Boolean(await stat(target).catch(() => null));

test("a new revision archives the outgoing revision and its supplement byte for byte", async (t) => {
  const { published, candidate } = await fixture(t);
  const before = await treeDigest(published);
  const result = await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
  assert.equal(result.action, "archived");
  assert.equal(result.outgoingYear, 2025);
  assert.equal(result.incomingYear, 2027);

  // The published data is untouched, and every archived file is the published file.
  assert.deepEqual(await treeDigest(published), before);
  const archive = path.join(candidate, "editions", "statutes", "2025");
  const archived = new Map(await treeDigest(archive));
  const outgoing = new Map(before);
  for (const [file, digest] of archived) {
    if (file === "edition.json") continue;
    assert.equal(digest, outgoing.get(file), `${file} must be the published bytes`);
  }
  for (const file of outgoing.keys()) {
    if (/^(catalog\.json|manifest\.json|chapters\/|search\/|supplements\/2026\/)/.test(file)) assert.ok(archived.has(file), `${file} must be archived`);
  }

  const record = JSON.parse(await readFile(path.join(archive, "edition.json"), "utf8"));
  assert.equal(record.label, "General Statutes revised to January 1, 2025, with the 2026 Supplement");
  assert.deepEqual(record.supplementYears, [2026]);
  assert.equal(record.legislationThrough, 2025);
  assert.equal(record.supersededBy.revisionYear, 2027);
  // The new revision joins the reviewed list of published editions.
  const listed = JSON.parse(await readFile(path.join(candidate, "editions", "published.json"), "utf8"));
  assert.deepEqual(listed.editions.at(-1), { year: 2027, kind: "revision", url: "https://www.cga.ct.gov/2027/pub/titles.htm", verifiedFrom: "https://www.cga.ct.gov/current/pub/titles.htm", heading: "Revised to January 1, 2027" });
  assert.deepEqual(record.officialSources, [{ from: "https://www.cga.ct.gov/current/pub/", to: "https://www.cga.ct.gov/2025/pub/" }]);

  // The archive validates as its own corpus, with the supplement bound to the archived base.
  assert.deepEqual((await validateStatuteArchives({ dataDir: candidate, schemaDir })).errors, []);
  // The current corpus still retires the supplement from the active view.
  assert.deepEqual(await planSupplementRebind({ supplementsDir: path.join(published, "supplements"), baseDataDir: candidate }), { baseRevisionYear: 2027, rebind: [], retire: [2026] });
  const summary = renderRolloverSummary(result);
  assert.match(summary, /## Edition rollover/);
  assert.match(summary, /archives the outgoing 2025 revision and the 2026 Supplement under `public\/data\/editions\/statutes\/2025`/);
  assert.match(summary, /#\/editions\/2025/);
});

// The corpus workflow's real order: import, validate the bare candidate, carry editions forward
// (archiving on a new revision), stage, and validate again.
test("the corpus refresh order validates a bare candidate and then the carried-forward one", async (t) => {
  const { published, candidate } = await fixture(t);
  const validate = (dataDir) => spawnSync(process.execPath, ["scripts/validate.mjs", "--data", dataDir, "--schemas", schemaDir], { encoding: "utf8" });
  const bare = validate(candidate);
  assert.equal(bare.status, 0, bare.stderr);
  await mkdir(path.join(published, "editions"), { recursive: true });
  await writeFile(path.join(published, "editions", "published.json"), `${JSON.stringify({ schemaVersion: "1.0.0", editions: [
    { year: 2025, kind: "revision", url: "https://www.cga.ct.gov/2025/pub/titles.htm" },
    { year: 2026, kind: "supplement", url: "https://www.cga.ct.gov/2026/sup/titles.htm" }
  ] }, null, 2)}\n`, "utf8");
  assert.equal(validate(published).status, 0);
  await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
  const staged = validate(candidate);
  assert.equal(staged.status, 0, staged.stderr);
  assert.match(staged.stdout, /1 archived statute edition/);
  // An editions directory that lost its list fails.
  await rm(path.join(candidate, "editions", "published.json"));
  assert.match(validate(candidate).stderr, /editions\/published\.json is missing/);
});

test("rerunning the rollover is a no-op that produces the same bytes", async (t) => {
  const { published, candidate } = await fixture(t);
  await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
  const first = await treeDigest(candidate);
  const again = await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
  assert.equal(again.action, "unchanged");
  assert.deepEqual(await treeDigest(candidate), first);

  // A rerun from a fresh candidate (a new workflow run) writes identical archive bytes.
  const { root } = await fixture(t);
  const fresh = path.join(root, "candidate");
  await rolloverEdition({ publishedDir: published, candidateDir: fresh, schemaDir });
  assert.deepEqual(await treeDigest(path.join(fresh, "editions")), await treeDigest(path.join(candidate, "editions")));
});

test("an ordinary refresh carries the archived editions forward unchanged", async (t) => {
  const { root, published, candidate } = await fixture(t);
  await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
  // After the rollover merges, the 2027 revision is published with its archive...
  const merged = path.join(root, "merged");
  await cp(candidate, merged, { recursive: true });
  const archived = await treeDigest(path.join(merged, "editions"));
  // ...and next Monday's refresh builds a fresh 2027 candidate with no editions directory.
  const next = path.join(root, "next");
  await cp(candidate, next, { recursive: true });
  await rm(path.join(next, "editions"), { recursive: true });
  const result = await rolloverEdition({ publishedDir: merged, candidateDir: next, schemaDir });
  assert.equal(result.action, "none");
  assert.deepEqual(await treeDigest(path.join(next, "editions")), archived);
  assert.equal(renderRolloverSummary(result), null);
});

test("a published pair that fails validation is not archived and nothing is written", async (t) => {
  const { published, candidate } = await fixture(t);
  const chapter = path.join(published, "supplements", "2026", "chapters", "001.json");
  await writeFile(chapter, (await readFile(chapter, "utf8")).replace("As amended by the 2026 Supplement.", "Tampered."), "utf8");
  await assert.rejects(
    () => rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir }),
    /The published 2026 Supplement does not validate against the 2025 revision, so it was not archived/
  );
  assert.equal(await exists(path.join(candidate, "editions", "statutes", "2025")), false);
  assert.deepEqual((await listFiles(path.join(candidate, "editions"))).filter((file) => file.includes("partial")), []);
  // The published edition is still publishable as it was.
  assert.deepEqual((await validateCorpus({ dataDir: published, schemaDir })).errors, []);
});

test("an archived edition is never replaced with different bytes", async (t) => {
  const { published, candidate } = await fixture(t);
  await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
  const record = path.join(candidate, "editions", "statutes", "2025", "edition.json");
  await writeFile(record, (await readFile(record, "utf8")).replace("with the 2026 Supplement", "edited"), "utf8");
  await assert.rejects(() => rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir }), /already exists with different contents/);
});

test("rollover refuses an older or even-year candidate", async (t) => {
  const { published, candidate } = await fixture(t);
  await assert.rejects(() => rolloverEdition({ publishedDir: candidate, candidateDir: published, schemaDir }), /older than the published 2027 revision/);
  const catalogPath = path.join(candidate, "catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.source.revisionYear = 2026;
  await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`, "utf8");
  await assert.rejects(() => rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir }), /full revisions in odd-numbered years/);
});

test("validation catches a tampered archive and an archive newer than the active revision", async (t) => {
  const { published, candidate } = await fixture(t);
  await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
  const chapter = path.join(candidate, "editions", "statutes", "2025", "chapters", "001.json");
  await writeFile(chapter, `${await readFile(chapter, "utf8")} `, "utf8");
  assert.match((await validateStatuteArchives({ dataDir: candidate, schemaDir })).errors.join("\n"), /editions\/statutes\/2025\/chapters\/001\.json: byte length does not match manifest/);
  // Archiving into the published 2025 data (as if it were the active edition) is rejected.
  await cp(path.join(candidate, "editions"), path.join(published, "editions"), { recursive: true });
  assert.match((await validateStatuteArchives({ dataDir: published, schemaDir })).errors.join("\n"), /must be older than the active 2025 revision/);
});

test("a supplement is bound to the revision published the year before it", async (t) => {
  const { root, published } = await fixture(t);
  const manifestPath = path.join(published, "supplements", "2026", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.editionYear = 2028;
  const moved = path.join(root, "supplement-2028");
  await cp(path.dirname(manifestPath), moved, { recursive: true });
  await writeFile(path.join(moved, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  assert.match((await validateSupplement({ supplementDir: moved, baseDataDir: published, schemaDir })).errors.join("\n"),
    /the 2028 Supplement is read with the 2027 revision, but the base corpus is revised to January 1, 2025/);
  const input = path.join(root, "input-2028");
  await cp(path.join(root, "input-supplement"), input, { recursive: true });
  const index = JSON.parse(await readFile(path.join(input, "titles_index.json"), "utf8"));
  index.source.supplement_year = 2028;
  index.source.revision_year = 2028;
  await writeFile(path.join(input, "titles_index.json"), JSON.stringify(index), "utf8");
  await assert.rejects(() => importSupplement({ inputDir: input, outputDir: path.join(root, "rejected"), baseDataDir: published, editionYear: 2028 }),
    /read with the 2027 revision/);
});
