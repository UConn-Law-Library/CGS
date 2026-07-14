#!/usr/bin/env node
import path from "node:path";
import { importSupplement } from "./lib/supplement-importer.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const year = valueAfter("--year");
  const result = await importSupplement({
    inputDir: path.resolve(valueAfter("--input") ?? ".crawl/supplement"),
    outputDir: path.resolve(valueAfter("--output") ?? (year ? `public/data/supplements/${year}` : ".crawl/supplement-canonical")),
    baseDataDir: path.resolve(valueAfter("--base") ?? "public/data"),
    editionYear: year ? Number(year) : undefined,
    generatedAt: valueAfter("--generated-at") ?? undefined
  });
  console.log(`Imported ${result.editionYear} supplement: ${result.replacements} replacements and ${result.additions} additions.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
