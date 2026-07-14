#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffCorpora, renderDiffMarkdown } from "./lib/corpus-diff.mjs";

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

async function writeOutput(file, content) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  console.log(`Wrote ${target}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.before || !args.after) throw new Error("Usage: npm run diff:corpus -- --before <data-dir> --after <data-dir> [--json <file>] [--markdown <file>]");
  const titleIds = args.titles
    ? args.titles.split(",").map((value) => {
        const normalized = value.trim().toLowerCase().replace(/^title-/, "");
        const match = /^(\d+)([a-z]*)$/.exec(normalized);
        return `title-${match ? match[1].padStart(2, "0") + match[2] : normalized}`;
      })
    : undefined;
  const report = await diffCorpora({ beforeDir: args.before, afterDir: args.after, titleIds });
  const markdown = renderDiffMarkdown(report);
  if (args.json) await writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`);
  if (args.markdown) await writeOutput(args.markdown, markdown);
  if (!args.json && !args.markdown) process.stdout.write(markdown);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
