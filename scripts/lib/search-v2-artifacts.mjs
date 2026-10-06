import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyChapterOverlay } from "./supplement-overlay.mjs";

function comparableNumber(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^0+(?=\d)/, "");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(root, relativePath, value, { pretty = false } = {}) {
  const file = path.join(root, ...relativePath.split("/"));
  const bytes = Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return {
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function latestSupplement(supplementsDir) {
  if (!(await stat(supplementsDir).catch(() => null))?.isDirectory()) return null;
  const editions = (await readdir(supplementsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => right - left);
  if (!editions.length) return null;
  const editionYear = editions[0];
  return {
    editionYear,
    root: path.join(supplementsDir, String(editionYear)),
    manifest: await readJson(path.join(supplementsDir, String(editionYear), "manifest.json"))
  };
}

function auxiliaryDocument(section) {
  return {
    id: section.id,
    history: section.content?.history ?? [],
    annotations: (section.content?.annotations ?? []).map((annotation) => annotation.text).filter(Boolean)
  };
}

function sectionRouteKey(section) {
  return section.citation ?? section.citations?.[0] ?? section.id;
}

// Maps each citation to the chapter and route key of its section, so the reader
// can link cross-references without downloading a title's full-text search shard.
function addCitations(citations, chapterNumber, sections) {
  for (const section of sections) {
    const route = [chapterNumber, sectionRouteKey(section)];
    for (const citation of section.citations ?? [section.citation].filter(Boolean)) {
      citations[String(citation).toLowerCase()] = route;
    }
  }
}

export async function generateSearchV2Artifacts({ catalog, dataDirectory, supplementsDir, outputDir, generatedAt }) {
  const supplement = await latestSupplement(supplementsDir);
  const supplementTitles = new Map((supplement?.manifest?.titles ?? []).map((title) => [title.id, title]));
  const catalogTitles = new Map(catalog.titles.map((title) => [title.id, title]));
  const titleIds = [...new Set([...catalogTitles.keys(), ...supplementTitles.keys()])];
  const shards = [];
  const citationShards = [];
  let documentCount = 0;

  for (const titleId of titleIds) {
    const title = catalogTitles.get(titleId);
    const supplementTitle = supplementTitles.get(titleId);
    const overlayEntries = [...(supplementTitle?.chapters ?? [])];
    const usedOverlays = new Set();
    const documents = [];
    const citations = {};

    for (const chapterEntry of title?.chapters ?? []) {
      const baseChapter = await readJson(path.join(dataDirectory, ...chapterEntry.path.split("/")));
      const overlayEntry = overlayEntries.find((entry) =>
        entry.id === chapterEntry.id || comparableNumber(entry.number) === comparableNumber(chapterEntry.number));
      let chapter = baseChapter;
      if (overlayEntry) {
        usedOverlays.add(overlayEntry.id);
        const overlay = await readJson(path.join(supplement.root, ...overlayEntry.path.split("/")));
        chapter = applyChapterOverlay(baseChapter, overlay, supplement.editionYear).chapter;
      }
      documents.push(...chapter.sections.map(auxiliaryDocument));
      addCitations(citations, chapterEntry.number, chapter.sections);
    }

    for (const overlayEntry of overlayEntries.filter((entry) => !usedOverlays.has(entry.id))) {
      const overlay = await readJson(path.join(supplement.root, ...overlayEntry.path.split("/")));
      const chapter = applyChapterOverlay(null, overlay, supplement.editionYear).chapter;
      documents.push(...chapter.sections.map(auxiliaryDocument));
      addCitations(citations, chapter.number ?? overlayEntry.number, chapter.sections);
    }

    const relativePath = `${titleId}.json`;
    const artifact = await writeJson(outputDir, relativePath, {
      schemaVersion: catalog.schemaVersion,
      title: {
        id: titleId,
        number: title?.number ?? supplementTitle?.number,
        name: title?.name ?? supplementTitle?.name
      },
      documents
    });
    shards.push({ titleId, ...artifact, documentCount: documents.length });
    documentCount += documents.length;
    const citationArtifact = await writeJson(outputDir, `citations/${titleId}.json`, {
      schemaVersion: catalog.schemaVersion,
      titleId,
      sections: citations
    });
    citationShards.push({ titleId, ...citationArtifact });
  }

  const manifest = {
    schemaVersion: catalog.schemaVersion,
    generatedAt,
    supplementEditionYear: supplement?.editionYear ?? null,
    counts: { titles: shards.length, documents: documentCount },
    shards,
    citationShards
  };
  await writeJson(outputDir, "manifest.json", manifest, { pretty: true });
  return manifest;
}
