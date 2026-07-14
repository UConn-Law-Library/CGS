#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateCorpusRefresh, renderRefreshSummary } from "./lib/refresh-policy.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error(`Expected --flag value, received ${flag ?? "end of input"}`);
    args[flag.slice(2)] = value;
  }
  return args;
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

async function writeOutput(file, value) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.report || !args.policy) {
    throw new Error("Usage: node scripts/check-corpus-refresh.mjs --report <diff.json> --policy <policy.json> [--summary <summary.md>] [--state <state.json>] [--github-output <file>]");
  }
  const report = await readJson(args.report);
  const policy = await readJson(args.policy);
  const evaluation = evaluateCorpusRefresh(report, policy);
  const summary = renderRefreshSummary(report, evaluation);
  if (args.summary) await writeOutput(args.summary, summary);
  if (args.state) await writeOutput(args.state, `${JSON.stringify(evaluation, null, 2)}\n`);
  if (args["github-output"]) {
    await appendFile(path.resolve(args["github-output"]), `has_changes=${evaluation.hasChanges}\nreview_passed=${evaluation.passed}\n`);
  }
  process.stdout.write(summary);
  if (!evaluation.passed) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
