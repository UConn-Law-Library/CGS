#!/usr/bin/env node
import path from "node:path";
import { validateSupplement } from "./lib/supplement-validator.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const result = await validateSupplement({
    supplementDir: path.resolve(valueAfter("--data") ?? ".crawl/supplement-canonical"),
    baseDataDir: path.resolve(valueAfter("--base") ?? "public/data"),
    schemaDir: path.resolve(valueAfter("--schemas") ?? "schemas")
  });
  if (result.errors.length) {
    console.error(result.errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${result.editionYear} supplement: ${result.counts.replacements} replacements and ${result.counts.additions} additions.`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
