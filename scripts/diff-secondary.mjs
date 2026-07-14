#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffSecondarySources, renderSecondaryDiffMarkdown } from "./lib/secondary-diff.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error("Expected --flag value pairs");
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

async function output(file, value) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.before || !args.after) throw new Error("Usage: npm run diff:secondary -- --before <secondary-dir> --after <secondary-dir> [--json <file>] [--markdown <file>]");
  const report = await diffSecondarySources({ beforeDir: args.before, afterDir: args.after });
  const markdown = renderSecondaryDiffMarkdown(report);
  if (args.json) await output(args.json, `${JSON.stringify(report, null, 2)}\n`);
  if (args.markdown) await output(args.markdown, markdown);
  if (!args.json && !args.markdown) process.stdout.write(markdown);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
