#!/usr/bin/env node
// Imports a crawled supplement against the exact revision it is read with, validates it, and
// writes the review summary for its draft pull request. With --stage it also copies the edition
// into the data directory and records it in editions/published.json.
//
//   node scripts/prepare-supplement.mjs --source .crawl/supplement/legacy --base public/data \
//     --year 2028 --output .crawl/supplement/canonical --summary report.md \
//     [--discovery discovery.json] [--stage]
import { createHash } from "node:crypto";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importSupplement } from "./lib/supplement-importer.mjs";
import { validateSupplement } from "./lib/supplement-validator.mjs";
import { recordPublishedEdition } from "./lib/edition-archive.mjs";

function valueAfter(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

export function renderSupplementSummary({ manifest, catalog, baseManifestSha256, discovery, errors }) {
  const year = manifest.editionYear;
  const counts = manifest.counts;
  const rows = manifest.titles.map((title) => {
    const replacements = title.chapters.reduce((sum, chapter) => sum + chapter.replacementCount, 0);
    const additions = title.chapters.reduce((sum, chapter) => sum + chapter.additionCount, 0);
    return `| ${title.number.replace(/^0+(?=\d)/, "")} | ${title.chapters.length} | ${replacements} | ${additions} |`;
  });
  return [
    `# The ${year} Supplement`,
    "",
    "This draft was prepared by the supplement discovery workflow. It never writes directly to main.",
    "",
    "## Source",
    "",
    `- Official edition: [${year} Supplement to the General Statutes of Connecticut](${manifest.source.url})`,
    `- Verified on the titles page: "${discovery?.heading ?? `Revised to January 1, ${year}`}", prepared under the direction of the Legislative Commissioners' Office, for use with the General Statutes revised to January 1, ${year - 1}.`,
    `- Captured: ${manifest.source.retrievedAt}`,
    `- Read with: the ${catalog.source.revisionYear} revision in \`public/data\` (generated ${catalog.generatedAt}, manifest SHA-256 \`${baseManifestSha256.slice(0, 12)}\`).`,
    "",
    "## Counts",
    "",
    `${counts.titles} titles, ${counts.chapters} chapters, ${counts.sections} provisions: ${counts.replacements} replace a provision of the ${year - 1} revision and ${counts.additions} are new.`,
    "",
    "| Title | Chapters | Replacements | Additions |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Review",
    "",
    errors.length ? `Validation failed:\n\n${errors.slice(0, 50).map((error) => `- ${error}`).join("\n")}` : "Import and validation passed: every overlay chapter and search patch was recomputed against the base, and the edition is bound to the base above.",
    "",
    `This pull request adds \`public/data/supplements/${year}\` and lists the ${year} Supplement in \`public/data/editions/published.json\`, which the guide's publication timeline reads. Spot-check several replaced and new sections against the official pages, and the Compare view in the preview, before marking it ready.`,
    ""
  ].join("\n");
}

async function main() {
  const source = path.resolve(valueAfter("--source"));
  const base = path.resolve(valueAfter("--base", "public/data"));
  const year = Number(valueAfter("--year"));
  const output = path.resolve(valueAfter("--output", `.crawl/supplement/canonical`));
  const summaryPath = valueAfter("--summary");
  const discoveryPath = valueAfter("--discovery");
  const schemaDir = path.resolve("schemas");
  const discovery = discoveryPath ? JSON.parse(await readFile(discoveryPath, "utf8")) : null;

  await rm(output, { recursive: true, force: true });
  await importSupplement({ inputDir: source, outputDir: output, baseDataDir: base, editionYear: year });
  const { errors } = await validateSupplement({ supplementDir: output, baseDataDir: base, schemaDir });
  const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
  const catalog = JSON.parse(await readFile(path.join(base, "catalog.json"), "utf8"));
  const baseManifestSha256 = createHash("sha256").update(await readFile(path.join(base, "manifest.json"))).digest("hex");
  const summary = renderSupplementSummary({ manifest, catalog, baseManifestSha256, discovery, errors });
  if (summaryPath) await writeFile(summaryPath, summary, "utf8");
  if (errors.length) {
    console.error(errors.slice(0, 50).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Imported and validated the ${year} Supplement: ${manifest.counts.chapters} chapters, ${manifest.counts.replacements} replacements, ${manifest.counts.additions} additions.`);
  if (process.argv.includes("--stage")) {
    const target = path.join(base, "supplements", String(year));
    await rm(target, { recursive: true, force: true });
    await cp(output, target, { recursive: true });
    await recordPublishedEdition(base, {
      year,
      kind: "supplement",
      url: manifest.source.url,
      verifiedFrom: manifest.source.url,
      heading: discovery?.heading ?? `Revised to January 1, ${year}`
    });
    console.log(`Staged ${path.relative(process.cwd(), target)} and listed the ${year} Supplement as published.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
