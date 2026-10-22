import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffSupplement, evaluateSupplementDiff, renderSupplementDiff } from "./lib/supplement-diff.mjs";

try {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  for (const key of ["before", "after", "before-base", "after-base", "policy", "json", "markdown"]) {
    if (!args[key]) throw new Error(`Missing --${key}`);
  }
  const report = await diffSupplement({ before: args.before, after: args.after, beforeBase: args["before-base"], afterBase: args["after-base"] });
  const review = evaluateSupplementDiff(report, JSON.parse(await readFile(args.policy, "utf8")));
  for (const [file, content] of [[args.json, JSON.stringify({ ...report, review }, null, 2) + "\n"], [args.markdown, renderSupplementDiff(report, review)]]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  if (!review.passed) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
