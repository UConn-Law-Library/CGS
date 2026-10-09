import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAmendmentIndex } from "../../src/act-amendments.js";

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Derives data/acts/amendments.json (which statute sections each listed Public Act amends or
// repeals) from the published act texts. Like the search shards it is derived, never
// authoritative, so it is rebuilt on every deploy rather than checked in.
export async function generateActAmendments({ actsDir, outputDir }) {
  const manifest = await readJsonIfPresent(path.join(actsDir, "manifest.json"));
  const sessions = [];
  for (const entry of manifest?.sessions ?? []) {
    const { acts } = JSON.parse(await readFile(path.join(actsDir, ...entry.path.split("/")), "utf8"));
    const texts = new Map(await Promise.all(acts.filter((act) => act.text).map(async (act) =>
      [act.id, JSON.parse(await readFile(path.join(actsDir, ...act.text.path.split("/")), "utf8"))])));
    sessions.push({ entry, acts, texts });
  }
  const index = buildAmendmentIndex(sessions, manifest?.generatedAt ?? null);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "amendments.json"), `${JSON.stringify(index)}\n`, "utf8");
  return index;
}
