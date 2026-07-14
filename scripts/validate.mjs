#!/usr/bin/env node
import path from "node:path";
import { validateCorpus } from "./lib/validator.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const result = await validateCorpus({
    dataDir: path.resolve(valueAfter("--data") ?? "public/data"),
    schemaDir: path.resolve(valueAfter("--schemas") ?? "schemas")
  });
  if (result.errors.length) {
    console.error(result.errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${result.counts.titles} titles, ${result.counts.chapters} chapters, and ${result.counts.sections} provisions.`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
