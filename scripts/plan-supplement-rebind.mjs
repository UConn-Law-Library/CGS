#!/usr/bin/env node
// Prints, one per line, the published supplement years a corpus refresh must rebind to the
// candidate base, and writes a summary of any supplements the candidate revision supersedes.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { planSupplementRebind, renderRetirementSummary } from "./lib/supplement-retirement.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const plan = await planSupplementRebind({
    supplementsDir: path.resolve(valueAfter("--supplements") ?? "public/data/supplements"),
    baseDataDir: path.resolve(valueAfter("--base") ?? "public/data")
  });
  const summary = renderRetirementSummary(plan);
  const summaryPath = valueAfter("--summary");
  if (summary && summaryPath) await writeFile(summaryPath, summary, "utf8");
  for (const year of plan.retire) {
    console.error(`Retiring the ${year} Supplement: the candidate base is revised to January 1, ${plan.baseRevisionYear}.`);
  }
  for (const year of plan.rebind) console.log(year);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
