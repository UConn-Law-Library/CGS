import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyChapterOverlay } from "./supplement-overlay.mjs";
import { generateSupplementIndex } from "./supplement-index.mjs";
import { SECONDARY_KINDS, sourceEditionIdentity } from "./secondary-editions.mjs";

function comparableNumber(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^0+(?=d)/, "");
}

async function isDirectory(target) {
  return Boolean((await stat(target).catch(() => null))?.isDirectory());
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

function sectionRouteKey(section) {
  return section.citation ?? section.citations?.[0] ?? section.id;
}

function addCitations(citations, chapterNumber, sections) {
  for (const section of sections) {
    const route = [chapterNumber, sectionRouteKey(section)];
    for (const citation of section.citations ?? [section.citation].filter(Boolean)) citations[String(citation).toLowerCase()] = route;
  }
}

// Citation lookups for one archived edition, in the same shape as the current edition's, so a
// cross-reference in archived text opens the section in that same edition.
async function archiveCitations(archiveDir, record) {
  const catalog = await readJson(path.join(archiveDir, "catalog.json"));
  const latestYear = record.supplementYears.at(-1);
  const supplementRoot = latestYear ? path.join(archiveDir, "supplements", String(latestYear)) : null;
  const supplement = supplementRoot ? await readJson(path.join(supplementRoot, "manifest.json")) : null;
  const overlayTitles = new Map((supplement?.titles ?? []).map((title) => [title.id, title]));
  const shards = [];
  for (const titleId of new Set([...catalog.titles.map((title) => title.id), ...overlayTitles.keys()])) {
    const title = catalog.titles.find((entry) => entry.id === titleId);
    const overlayEntries = overlayTitles.get(titleId)?.chapters ?? [];
    const used = new Set();
    const citations = {};
    for (const entry of title?.chapters ?? []) {
      const base = await readJson(path.join(archiveDir, ...entry.path.split("/")));
      const overlayEntry = overlayEntries.find((candidate) => candidate.id === entry.id || comparableNumber(candidate.number) === comparableNumber(entry.number));
      let chapter = base;
      if (overlayEntry) {
        used.add(overlayEntry.id);
        chapter = applyChapterOverlay(base, await readJson(path.join(supplementRoot, ...overlayEntry.path.split("/"))), supplement.editionYear).chapter;
      }
      addCitations(citations, entry.number, chapter.sections);
    }
    for (const overlayEntry of overlayEntries.filter((entry) => !used.has(entry.id))) {
      const { chapter } = applyChapterOverlay(null, await readJson(path.join(supplementRoot, ...overlayEntry.path.split("/"))), supplement.editionYear);
      addCitations(citations, chapter.number ?? overlayEntry.number, chapter.sections);
    }
    const relative = `citations/${titleId}.json`;
    await writeJson(path.join(archiveDir, ...relative.split("/")), { titleId, sections: citations });
    shards.push({ titleId, path: relative });
  }
  return shards;
}

// The site's view of data/editions: an index of archived statute editions with what the reader
// needs to open them. It runs on the built copy in dist, so nothing derived is checked in.
// Archived search shards stay in the repository with their manifests but are not published:
// statute search covers only the active edition.
export async function buildEditions({ dataDir, generatedAt }) {
  const root = path.join(dataDir, "editions");
  const statutes = [];
  const statuteRoot = path.join(root, "statutes");
  if (await isDirectory(statuteRoot)) {
    for (const name of (await readdir(statuteRoot)).sort()) {
      const archiveDir = path.join(statuteRoot, name);
      if (!(await isDirectory(archiveDir))) continue;
      const record = await readJson(path.join(archiveDir, "edition.json"));
      await rm(path.join(archiveDir, "search"), { recursive: true, force: true });
      for (const year of record.supplementYears) await rm(path.join(archiveDir, "supplements", String(year), "search"), { recursive: true, force: true });
      await generateSupplementIndex({ supplementsDir: path.join(archiveDir, "supplements"), outputDir: path.join(archiveDir, "supplements"), generatedAt: record.base.generatedAt });
      const citationShards = await archiveCitations(archiveDir, record);
      const catalog = await readJson(path.join(archiveDir, "catalog.json"));
      statutes.push({
        id: record.id,
        label: record.label,
        revisionYear: record.revisionYear,
        supplementYears: record.supplementYears,
        legislationThrough: record.legislationThrough,
        supersededBy: record.supersededBy.revisionYear,
        retrievedAt: record.supplements.at(-1)?.retrievedAt ?? record.base.retrievedAt,
        counts: { titles: catalog.titles.length, chapters: record.base.counts.chapters, sections: record.base.counts.sections },
        officialSources: record.officialSources,
        path: `statutes/${name}/`,
        citationShards
      });
    }
  }
  statutes.sort((left, right) => right.revisionYear - left.revisionYear);
  // Archived secondary-source editions, and the current edition of each source for comparison.
  const secondary = [];
  const currentSecondary = [];
  for (const [kind, { dir }] of Object.entries(SECONDARY_KINDS)) {
    const current = await readJson(path.join(dataDir, "secondary", dir, "manifest.json")).catch(() => null);
    if (current) {
      const identity = sourceEditionIdentity(kind, current);
      currentSecondary.push({ kind, id: identity.id, label: identity.label, date: identity.date, name: current.source.name, publisher: current.source.publisher, sourceUrl: current.source.url });
    }
    const kindRoot = path.join(root, "secondary", kind);
    if (!(await isDirectory(kindRoot))) continue;
    for (const name of (await readdir(kindRoot)).sort()) {
      if (!(await isDirectory(path.join(kindRoot, name)))) continue;
      const record = await readJson(path.join(kindRoot, name, "edition.json"));
      secondary.push({
        kind,
        id: record.id,
        label: record.label,
        date: record.date,
        name: record.name,
        publisher: record.publisher,
        sourceUrl: record.sourceUrl,
        counts: record.counts,
        sources: record.sources,
        statuteSnapshot: record.statuteSnapshot,
        supersededBy: record.supersededBy,
        path: `secondary/${kind}/${name}/`
      });
    }
  }
  secondary.sort((left, right) => right.date.localeCompare(left.date));
  const index = { schemaVersion: "1.0.0", generatedAt, statutes, secondary, currentSecondary };
  await writeJson(path.join(root, "manifest.json"), index);
  return index;
}
