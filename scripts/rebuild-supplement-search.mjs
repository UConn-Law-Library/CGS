#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyChapterOverlay } from "./lib/supplement-overlay.mjs";
import { createSupplementSearchPatch } from "./lib/supplement-search.mjs";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return {
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function rebuild({ supplementDir, baseDataDir }) {
  const root = path.resolve(supplementDir);
  const base = path.resolve(baseDataDir);
  const manifest = await readJson(path.join(root, "manifest.json"));
  const catalog = await readJson(path.join(base, "catalog.json"));
  const baseTitles = new Map(catalog.titles.map((title) => [title.id, title]));
  const searchArtifacts = [];

  for (const title of manifest.titles) {
    const baseChapters = new Map((baseTitles.get(title.id)?.chapters ?? []).map((chapter) => [chapter.id, chapter]));
    const removedDocumentIds = [];
    const documents = [];
    for (const entry of title.chapters) {
      const overlayChapter = await readJson(path.join(root, ...entry.path.split("/")));
      const baseEntry = baseChapters.get(entry.id);
      const baseChapter = baseEntry ? await readJson(path.join(base, baseEntry.path)) : null;
      const consolidated = applyChapterOverlay(baseChapter, overlayChapter, manifest.editionYear);
      const searchPatch = createSupplementSearchPatch(baseChapter, consolidated, manifest.editionYear);
      removedDocumentIds.push(...searchPatch.removedDocumentIds);
      documents.push(...searchPatch.documents);
    }
    title.searchPath = `search/${title.id}.json`;
    searchArtifacts.push(await writeJson(root, title.searchPath, {
      schemaVersion: manifest.schemaVersion,
      editionYear: manifest.editionYear,
      title: { id: title.id, number: title.number, name: title.name },
      removedDocumentIds,
      documents
    }));
  }

  manifest.artifacts = [
    ...manifest.artifacts.filter((artifact) => artifact.path.startsWith("chapters/")),
    ...searchArtifacts
  ].sort((left, right) => collator.compare(left.path, right.path));
  await writeJson(root, "manifest.json", manifest);
  return { editionYear: manifest.editionYear, titles: manifest.titles.length, searchDocuments: searchArtifacts.length };
}

try {
  const year = valueAfter("--year") ?? "2026";
  const result = await rebuild({
    supplementDir: valueAfter("--data") ?? `public/data/supplements/${year}`,
    baseDataDir: valueAfter("--base") ?? "public/data"
  });
  console.log(`Rebuilt ${result.editionYear} supplement search patches for ${result.titles} titles.`);
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
