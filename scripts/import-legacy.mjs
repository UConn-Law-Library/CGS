#!/usr/bin/env node
import path from "node:path";
import { importLegacy } from "./lib/importer.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(args.input ?? "fixtures/legacy");
  const outputDir = path.resolve(args.output ?? "public/data");
  const result = await importLegacy({ inputDir, outputDir, generatedAt: args["generated-at"] });
  console.log(`Imported ${result.titles} titles, ${result.chapters} chapters, and ${result.sections} provisions.`);
  console.log(`Wrote ${result.artifacts} artifacts to ${result.outputDir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
