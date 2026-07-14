#!/usr/bin/env node
import path from "node:path";
import { validateCorpus } from "./lib/validator.mjs";
import { validateSupplements } from "./lib/supplement-validator.mjs";
import { validateSecondarySources } from "./lib/secondary-validator.mjs";

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
  const secondary = await validateSecondarySources({
    secondaryDir: path.join(dataDir, "secondary"),
    baseDataDir: dataDir,
    schemaDir
  });
  const errors = [...result.errors, ...supplements.errors, ...secondary.errors];
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${result.counts.titles} titles, ${result.counts.chapters} chapters, ${result.counts.sections} provisions, ${supplements.editions} supplement editions, ${secondary.counts.infractions} infractions, and ${secondary.counts.indexHeadings} index headings.`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
