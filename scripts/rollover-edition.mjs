#!/usr/bin/env node
// Carries the published editions into a corpus-refresh candidate and, when the candidate is a newer
// full revision, archives the outgoing revision and the supplements it supersedes.
//
//   node scripts/rollover-edition.mjs --published public/data --candidate .crawl/refresh/canonical \
//     [--summary report.md] [--schemas schemas]
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderRolloverSummary, rolloverEdition } from "./lib/edition-archive.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const result = await rolloverEdition({
    publishedDir: path.resolve(valueAfter("--published") ?? "public/data"),
    candidateDir: path.resolve(valueAfter("--candidate") ?? ".crawl/refresh/canonical"),
    schemaDir: path.resolve(valueAfter("--schemas") ?? "schemas")
  });
  const summary = renderRolloverSummary(result);
  const summaryPath = valueAfter("--summary");
  if (summary && summaryPath) await writeFile(summaryPath, summary, "utf8");
  if (result.action === "none") console.log(`No rollover: the candidate is the ${result.incomingYear} revision, as published. Published editions carried forward.`);
  else console.log(`${result.action === "archived" ? "Archived" : "Already archived"}: ${result.record.label} (${result.files} files), superseded by the ${result.incomingYear} revision.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
