#!/usr/bin/env node
// Rehearses an edition rollover with a real earlier edition pair: imports a crawled full revision
// and its supplement as the "published" data, takes the published public/data revision as the
// candidate, and runs the same rollover the corpus-refresh workflow runs. Nothing under
// public/data is written.
//
//   node scripts/rehearse-rollover.mjs --revision .crawl/rehearsal/legacy-2023 \
//     --supplement .crawl/rehearsal/legacy-2024 --output .crawl/rehearsal/run
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { importLegacy } from "./lib/importer.mjs";
import { importSupplement } from "./lib/supplement-importer.mjs";
import { validateCorpus } from "./lib/validator.mjs";
import { validateSupplement } from "./lib/supplement-validator.mjs";
import { renderRolloverSummary, rolloverEdition, treeDigest, validateStatuteArchives } from "./lib/edition-archive.mjs";
import { planSupplementRebind, renderRetirementSummary } from "./lib/supplement-retirement.mjs";

function valueAfter(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

const schemaDir = path.resolve("schemas");
const revisionInput = path.resolve(valueAfter("--revision"));
const supplementInput = path.resolve(valueAfter("--supplement"));
const output = path.resolve(valueAfter("--output", ".crawl/rehearsal/run"));
const current = path.resolve(valueAfter("--current", "public/data"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

const revisionIndex = JSON.parse(await readFile(path.join(revisionInput, "titles_index.json"), "utf8"));
const supplementIndex = JSON.parse(await readFile(path.join(supplementInput, "titles_index.json"), "utf8"));
const revisionYear = revisionIndex.source.revision_year;
const supplementYear = supplementIndex.source.supplement_year;
console.log(`Rehearsing: the ${revisionYear} revision with the ${supplementYear} Supplement, superseded by ${current}.`);

await rm(output, { recursive: true, force: true });
const published = path.join(output, "published");
const candidate = path.join(output, "candidate");
await importLegacy({ inputDir: revisionInput, outputDir: published, generatedAt: revisionIndex.source.generated_at_utc, revisionYear });
await importSupplement({
  inputDir: supplementInput,
  outputDir: path.join(published, "supplements", String(supplementYear)),
  baseDataDir: published,
  editionYear: supplementYear,
  generatedAt: supplementIndex.source.generated_at_utc
});
const baseCheck = await validateCorpus({ dataDir: published, schemaDir });
const supplementCheck = await validateSupplement({ supplementDir: path.join(published, "supplements", String(supplementYear)), baseDataDir: published, schemaDir });
if (baseCheck.errors.length || supplementCheck.errors.length) fail([...baseCheck.errors, ...supplementCheck.errors].slice(0, 20).join("\n"));
console.log(`Published pair: ${baseCheck.counts.chapters} chapters, ${baseCheck.counts.sections} provisions; ${supplementCheck.counts.chapters} supplement chapters (${supplementCheck.counts.replacements} replacements, ${supplementCheck.counts.additions} additions).`);

// The candidate is the revision published now, as a fresh crawl would produce it.
await mkdir(candidate, { recursive: true });
for (const entry of ["catalog.json", "manifest.json", "chapters", "search"]) {
  await cp(path.join(current, entry), path.join(candidate, entry), { recursive: true });
}

const first = await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
if (first.action !== "archived") fail(`Expected an archive, got ${first.action}`);
const bytes = await treeDigest(path.join(candidate, "editions"));
const second = await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
if (second.action !== "unchanged" || JSON.stringify(await treeDigest(path.join(candidate, "editions"))) !== JSON.stringify(bytes)) {
  fail("A rerun changed the archive");
}
const archives = await validateStatuteArchives({ dataDir: candidate, schemaDir });
if (archives.errors.length) fail(archives.errors.slice(0, 20).join("\n"));
const plan = await planSupplementRebind({ supplementsDir: path.join(published, "supplements"), baseDataDir: candidate });

const report = [renderRolloverSummary(first), renderRetirementSummary(plan) ?? ""].join("\n");
await writeFile(path.join(output, "rollover.md"), report, "utf8");
console.log(report);
console.log(`Archive validated; rerun was a no-op. Serve it with: node scripts/build-site.mjs --editions-overlay ${path.relative(process.cwd(), path.join(candidate, "editions"))}`);
