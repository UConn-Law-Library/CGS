#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateSecondaryRefresh, renderSecondaryReview } from "./lib/secondary-policy.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error("Expected --flag value pairs");
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

async function json(file) { return JSON.parse(await readFile(path.resolve(file), "utf8")); }

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.report || !args.policy) throw new Error("Usage: npm run review:secondary -- --report <diff.json> --policy <policy.json> [--summary <file>]");
  const report = await json(args.report);
  const evaluation = evaluateSecondaryRefresh(report, await json(args.policy));
  const summary = renderSecondaryReview(report, evaluation);
  if (args.summary) {
    const target = path.resolve(args.summary);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, summary);
  }
  process.stdout.write(summary);
  if (!evaluation.passed) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
