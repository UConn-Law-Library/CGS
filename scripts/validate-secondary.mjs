#!/usr/bin/env node
import path from "node:path";
import { validateSecondarySources } from "./lib/secondary-validator.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const result = await validateSecondarySources({
    secondaryDir: path.resolve(valueAfter("--data") ?? ".crawl/secondary/canonical"),
    baseDataDir: path.resolve(valueAfter("--base") ?? "public/data"),
    schemaDir: path.resolve(valueAfter("--schemas") ?? "schemas")
  });
  if (!result.present) throw new Error("Secondary-source directory does not exist");
  if (result.errors.length) {
    console.error(result.errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
  console.log(`Validated ${result.counts.infractions} infractions, ${result.counts.feeRules} fee rules, and ${result.counts.indexHeadings} index headings.`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
