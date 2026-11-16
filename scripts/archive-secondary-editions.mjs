#!/usr/bin/env node
// Run by the secondary-source refresh after its candidate passes review. It keeps the source PDFs
// of the candidate's editions, and archives any published edition the candidate replaces with a
// different publication. A citation rebind against new statutes never reaches this script.
//
//   node scripts/archive-secondary-editions.mjs --data public/data --candidate .crawl/secondary/canonical \
//     --sources .crawl/secondary/sources/manifest.json [--summary report.md] [--github-output file]
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { archiveSecondaryEditions, renderSecondaryEditionsSummary, retainSourceFiles } from "./lib/secondary-editions.mjs";

function valueAfter(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

try {
  const dataDir = path.resolve(valueAfter("--data", "public/data"));
  const candidateDir = path.resolve(valueAfter("--candidate"));
  const results = await archiveSecondaryEditions({ dataDir, candidateDir, schemaDir: path.resolve(valueAfter("--schemas", "schemas")) });
  const retained = await retainSourceFiles({ dataDir, candidateDir, capturesManifest: valueAfter("--sources") });
  const changed = results.some((result) => result.action === "archived") || retained.length > 0;
  for (const result of results) console.log(`${result.kind}: ${result.action} (${result.label}, ${result.id})`);
  console.log(`Retained ${retained.length} new source PDF(s).`);
  const summary = renderSecondaryEditionsSummary(results, retained);
  const summaryPath = valueAfter("--summary");
  if (summary && summaryPath) await writeFile(summaryPath, summary, "utf8");
  const output = valueAfter("--github-output");
  if (output) await appendFile(output, `changed=${changed}\n`, "utf8");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
