import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = "1.0.0";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const allowedStatuses = new Set(["active", "mixed", "obsolete", "repealed", "reserved", "transferred"]);

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function slug(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stableFallback(...parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = /^\d+$/.test(String(value))
    ? new Date(Number(value) * 1000)
    : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().replace(".000Z", "Z");
}

function normalizeAnnotations(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((annotation) => ({
      first: Boolean(annotation?.first),
      text: cleanString(annotation?.text)
    }))
    .filter((annotation) => annotation.text);
}

function normalizeSection(section, chapterNumber) {
  const citation = cleanString(section.section_key) || null;
  const grouped = section.grouped === true;
  const citations = grouped ? stringArray(section.section_keys) : citation ? [citation] : [];
  const baseId = grouped
    ? `group-${slug(citations.join("-to-")) || stableFallback(section.label, section.url)}`
    : `section-${slug(citation) || stableFallback(section.label, section.url)}`;
  const legacyStatus = cleanString(section.content?.status).toLowerCase();
  const status = legacyStatus || "active";
  if (!allowedStatuses.has(status)) {
    throw new Error(`Chapter ${chapterNumber}, ${section.label}: unsupported status ${JSON.stringify(status)}`);
  }

  const body = stringArray(section.content?.body_paragraphs);
  const normalized = {
    id: baseId,
    kind: grouped ? "group" : "section",
    citation,
    citations,
    heading: cleanString(section.label) || citation || "Untitled provision",
    sourceUrl: cleanString(section.url),
    status,
    content: {
      body,
      sourceNotes: stringArray(section.content?.source),
      history: stringArray(section.content?.history),
      annotations: normalizeAnnotations(section.content?.annotations),
      plainText: cleanString(section.content?.text) || body.join("\n\n")
    }
  };
  if (cleanString(section.source_fragment_key)) normalized.sourceAnchor = cleanString(section.source_fragment_key);
  if (cleanString(section.identifier_warning)) normalized.identifierWarning = cleanString(section.identifier_warning);
  return normalized;
}

function normalizeChapter(chapter, title) {
  const legacyNumber = cleanString(chapter.chapter_key).toLowerCase();
  const number = slug(legacyNumber);
  if (!number) throw new Error(`Title ${title.number} contains a chapter with no chapter_key`);
  const id = `chapter-${number}`;
  const seenSections = new Set();
  const sections = (chapter.sections ?? []).map((section) => {
    const normalized = normalizeSection(section, number);
    if (seenSections.has(normalized.id)) throw new Error(`Duplicate section ID ${normalized.id} in ${id}`);
    seenSections.add(normalized.id);
    if (!normalized.sourceUrl) throw new Error(`${id}/${normalized.id} has no source URL`);
    return normalized;
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    number,
    name: cleanString(chapter.name) || cleanString(chapter.label) || `Chapter ${number}`,
    title: { id: title.id, number: title.number, name: title.name },
    sourceUrl: cleanString(chapter.url),
    sections
  };
}

export function searchDocument(section, chapter) {
  return {
    id: section.id,
    citation: section.citation,
    citations: section.citations,
    heading: section.heading,
    chapter: { id: chapter.id, number: chapter.number, name: chapter.name },
    status: section.status,
    text: section.content.plainText,
    href: `?chapter=${encodeURIComponent(chapter.number)}&section=${encodeURIComponent(section.id)}`
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(file, bytes);
  return {
    path: relativePath.replaceAll(path.sep, "/"),
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function assertSafePaths(inputDir, outputDir) {
  const input = path.resolve(inputDir);
  const output = path.resolve(outputDir);
  const parsed = path.parse(output);
  if (output === parsed.root || output === process.cwd()) throw new Error(`Refusing unsafe output directory: ${output}`);
  if (input === output || input.startsWith(`${output}${path.sep}`)) {
    throw new Error("Output directory cannot be the input directory or one of its parents");
  }
}

export async function importLegacy({ inputDir, outputDir, generatedAt } = {}) {
  if (!inputDir) throw new Error("inputDir is required");
  if (!outputDir) throw new Error("outputDir is required");
  assertSafePaths(inputDir, outputDir);

  const input = path.resolve(inputDir);
  const output = path.resolve(outputDir);
  const inputInfo = await stat(input).catch(() => null);
  if (!inputInfo?.isDirectory()) throw new Error(`Legacy input directory does not exist: ${input}`);

  const names = (await readdir(input))
    .filter((name) => /^title_[0-9a-z]+\.json$/i.test(name))
    .sort(collator.compare);
  if (names.length === 0) throw new Error(`No legacy title_*.json files found in ${input}`);

  const legacyIndex = await readJson(path.join(input, "titles_index.json")).catch(() => null);
  const requestedTimestamp = generatedAt
    ?? legacyIndex?.source?.generated_at_utc
    ?? process.env.SOURCE_DATE_EPOCH
    ?? new Date().toISOString();
  const timestamp = normalizeTimestamp(requestedTimestamp);
  if (!timestamp) throw new Error(`Invalid generated-at timestamp: ${requestedTimestamp}`);
  const sourceUrl = cleanString(legacyIndex?.source?.titles_url) || "https://www.cga.ct.gov/current/pub/titles.htm";
  const source = {
    name: "Connecticut General Statutes legacy JSON",
    url: sourceUrl,
    retrievedAt: timestamp
  };

  const staging = `${output}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const artifacts = [];
  const catalogTitles = [];
  const searchShards = [];
  const seenTitles = new Set();
  const seenChapters = new Set();
  let chapterCount = 0;
  let sectionCount = 0;

  try {
    for (const name of names) {
      const legacy = await readJson(path.join(input, name));
      const number = cleanString(legacy.title_key).toLowerCase();
      const title = {
        id: `title-${slug(number)}`,
        number,
        name: cleanString(legacy.name) || cleanString(legacy.label) || `Title ${number}`
      };
      if (!number || seenTitles.has(title.id)) throw new Error(`Missing or duplicate title ID in ${name}: ${title.id}`);
      seenTitles.add(title.id);
      const chapters = (legacy.chapters ?? []).map((chapter) => normalizeChapter(chapter, title));
      const chapterEntries = [];
      const documents = [];

      for (const chapter of chapters) {
        if (seenChapters.has(chapter.id)) throw new Error(`Duplicate chapter ID across titles: ${chapter.id}`);
        seenChapters.add(chapter.id);
        if (!chapter.sourceUrl) throw new Error(`${chapter.id} has no source URL`);
        const chapterPath = `chapters/${slug(chapter.number)}.json`;
        artifacts.push(await writeJson(staging, chapterPath, chapter));
        chapterEntries.push({
          id: chapter.id,
          number: chapter.number,
          name: chapter.name,
          path: chapterPath,
          sourceUrl: chapter.sourceUrl,
          sectionCount: chapter.sections.length
        });
        documents.push(...chapter.sections.map((section) => searchDocument(section, chapter)));
        chapterCount += 1;
        sectionCount += chapter.sections.length;
      }

      const searchPath = `search/${title.id}.json`;
      artifacts.push(await writeJson(staging, searchPath, {
        schemaVersion: SCHEMA_VERSION,
        title,
        documents
      }));
      searchShards.push({ titleId: title.id, path: `${title.id}.json`, documentCount: documents.length });
      catalogTitles.push({
        ...title,
        sourceUrl: cleanString(legacy.url),
        searchPath,
        chapters: chapterEntries
      });
    }

    const counts = { titles: catalogTitles.length, chapters: chapterCount, sections: sectionCount };
    artifacts.push(await writeJson(staging, "catalog.json", {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: timestamp,
      source,
      titles: catalogTitles,
      counts
    }));
    artifacts.push(await writeJson(staging, "search/manifest.json", {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: timestamp,
      shards: searchShards
    }));
    artifacts.sort((a, b) => collator.compare(a.path, b.path));
    await writeJson(staging, "manifest.json", {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: timestamp,
      counts: { ...counts, searchDocuments: sectionCount },
      artifacts
    });

    await rm(output, { recursive: true, force: true });
    await mkdir(path.dirname(output), { recursive: true });
    await rename(staging, output);
    return { outputDir: output, ...counts, artifacts: artifacts.length + 1 };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
