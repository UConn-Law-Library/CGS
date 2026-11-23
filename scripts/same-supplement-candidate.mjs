#!/usr/bin/env node
// Exits 0 when a staged supplement matches the one on a git ref (the open discovery draft),
// ignoring only the capture and generation times in its manifest; 1 when they differ. Overlay
// chapters and search patches carry no timestamps, so they are compared byte for byte.
//
//   node scripts/same-supplement-candidate.mjs --ref FETCH_HEAD --year 2028 [--data public/data]
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function valueAfter(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

// The manifest without the fields a fresh crawl and import restamp.
export function comparableManifest(text) {
  const manifest = JSON.parse(text);
  delete manifest.generatedAt;
  if (manifest.source) delete manifest.source.retrievedAt;
  return JSON.stringify(manifest);
}

export async function sameSupplementCandidate({ ref, year, dataDir = "public/data", cwd = process.cwd() }) {
  const git = (args) => execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
  const relative = `${dataDir.replaceAll("\\", "/")}/supplements/${year}`;
  const listed = git(["ls-tree", "-r", "--name-only", ref, "--", relative]).toString("utf8").split("\n").filter(Boolean).sort();
  const local = (await readdir(path.resolve(cwd, relative), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(cwd, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
  if (JSON.stringify(listed) !== JSON.stringify(local)) return false;
  for (const file of [...local, `${dataDir.replaceAll("\\", "/")}/editions/published.json`]) {
    const theirs = git(["show", `${ref}:${file}`]);
    const ours = await readFile(path.resolve(cwd, file));
    if (file.endsWith(`/supplements/${year}/manifest.json`)) {
      if (comparableManifest(theirs.toString("utf8")) !== comparableManifest(ours.toString("utf8"))) return false;
    } else if (!theirs.equals(ours)) {
      return false;
    }
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const same = await sameSupplementCandidate({ ref: valueAfter("--ref", "FETCH_HEAD"), year: Number(valueAfter("--year")), dataDir: valueAfter("--data", "public/data") });
    console.log(same ? "The open draft already has these artifacts." : "The candidate differs from the open draft.");
    process.exitCode = same ? 0 : 1;
  } catch (error) {
    // No such ref or path: nothing to compare with.
    console.log(`No open draft to compare with (${error.message.split("\n")[0]}).`);
    process.exitCode = 1;
  }
}
