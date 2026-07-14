#!/usr/bin/env node
import path from "node:path";
import { validateCorpus } from "./lib/validator.mjs";
import { validateSupplements } from "./lib/supplement-validator.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const dataDir = path.resolve(valueAfter("--data") ?? "public/data");
  const schemaDir = path.resolve(valueAfter("--schemas") ?? "schemas");
  const result = await validateCorpus({
    dataDir,
    schemaDir
  });
  const supplements = await validateSupplements({
    supplementsDir: path.join(dataDir, "supplements"),
    baseDataDir: dataDir,
    schemaDir
  });
  const errors = [...result.errors, ...supplements.errors];
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${result.counts.titles} titles, ${result.counts.chapters} chapters, ${result.counts.sections} provisions, and ${supplements.editions} supplement editions.`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
