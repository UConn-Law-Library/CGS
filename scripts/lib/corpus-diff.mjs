import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function provisionKey(section) {
  if (section.citation) return `citation:${section.citation.toLowerCase()}`;
  if (section.citations?.length) return `group:${section.citations.map((value) => value.toLowerCase()).join("|")}`;
  return `id:${section.id}`;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function snapshot(section, title, chapter) {
  return {
    key: provisionKey(section),
    id: section.id,
    citation: section.citation,
    citations: section.citations,
    heading: section.heading,
    status: section.status,
    titleId: title.id,
    titleNumber: title.number,
    chapterId: chapter.id,
    chapterNumber: chapter.number,
    sourceUrl: section.sourceUrl,
    contentHash: digest(section.content),
    section
  };
}

function titleSnapshot(title) {
  return {
    id: title.id,
    number: title.number,
    name: title.name,
    sourceUrl: title.sourceUrl,
    searchPath: title.searchPath
  };
}

function chapterSnapshot(chapter, title) {
  return {
    id: chapter.id,
    number: chapter.number,
    name: chapter.name,
    titleId: title.id,
    path: chapter.path,
    sourceUrl: chapter.sourceUrl,
    sectionCount: chapter.sectionCount
  };
}

async function loadCorpus(dataDir, titleIds) {
  const root = path.resolve(dataDir);
  const catalog = await readJson(path.join(root, "catalog.json"));
  const titles = new Map();
  const chapters = new Map();
  const provisions = new Map();
  for (const title of catalog.titles) {
    if (titleIds?.size && !titleIds.has(title.id)) continue;
    if (titles.has(title.id)) throw new Error(`Duplicate title ID ${title.id} in ${root}`);
    titles.set(title.id, titleSnapshot(title));
    for (const chapterEntry of title.chapters) {
      if (chapters.has(chapterEntry.id)) throw new Error(`Duplicate chapter ID ${chapterEntry.id} in ${root}`);
      chapters.set(chapterEntry.id, chapterSnapshot(chapterEntry, title));
      const chapter = await readJson(path.join(root, chapterEntry.path));
      for (const section of chapter.sections) {
        const value = snapshot(section, title, chapter);
        if (provisions.has(value.key)) {
          throw new Error(`Duplicate stable provision key ${value.key} in ${root}`);
        }
        provisions.set(value.key, value);
      }
    }
  }
  return { catalog, titles, chapters, provisions };
}

function publicSnapshot(value) {
  const { section, contentHash, ...result } = value;
  return result;
}

function changedFields(before, after) {
  const changes = [];
  if (before.titleId !== after.titleId || before.chapterId !== after.chapterId) changes.push("location");
  if (before.id !== after.id || before.citation !== after.citation || JSON.stringify(before.citations) !== JSON.stringify(after.citations)) changes.push("identifier");
  if (before.heading !== after.heading) changes.push("heading");
  if (before.status !== after.status) changes.push("status");
  if (before.sourceUrl !== after.sourceUrl) changes.push("sourceUrl");
  if (before.contentHash !== after.contentHash) changes.push("content");
  return changes;
}

function sortByKey(values) {
  return values.sort((left, right) => collator.compare(left.key ?? left.id, right.key ?? right.id));
}

function diffMetadata(before, after, fields) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, current] of after) {
    const previous = before.get(key);
    if (!previous) {
      added.push(current);
      continue;
    }
    const changes = fields.filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(current[field]));
    if (changes.length) changed.push({ key, changes, before: previous, after: current });
  }
  for (const [key, previous] of before) {
    if (!after.has(key)) removed.push(previous);
  }
  return {
    added: sortByKey(added),
    removed: sortByKey(removed),
    changed: sortByKey(changed)
  };
}

export async function diffCorpora({ beforeDir, afterDir, titleIds }) {
  if (!beforeDir || !afterDir) throw new Error("beforeDir and afterDir are required");
  const selectedTitles = titleIds?.length ? new Set(titleIds) : null;
  const before = await loadCorpus(beforeDir, selectedTitles);
  const after = await loadCorpus(afterDir, selectedTitles);
  const titleChanges = diffMetadata(before.titles, after.titles, ["number", "name", "sourceUrl", "searchPath"]);
  const chapterChanges = diffMetadata(before.chapters, after.chapters, ["number", "name", "titleId", "path", "sourceUrl", "sectionCount"]);
  const added = [];
  const removed = [];
  const changed = [];
  const statusTransitions = [];

  for (const [key, current] of after.provisions) {
    const previous = before.provisions.get(key);
    if (!previous) {
      added.push(publicSnapshot(current));
      continue;
    }
    const fields = changedFields(previous, current);
    if (fields.length) {
      const entry = {
        key,
        changes: fields,
        before: publicSnapshot(previous),
        after: publicSnapshot(current)
      };
      changed.push(entry);
      if (fields.includes("status")) {
        statusTransitions.push({
          key,
          citation: current.citation,
          heading: current.heading,
          from: previous.status,
          to: current.status
        });
      }
    }
  }
  for (const [key, previous] of before.provisions) {
    if (!after.provisions.has(key)) removed.push(publicSnapshot(previous));
  }

  sortByKey(added);
  sortByKey(removed);
  sortByKey(changed);
  sortByKey(statusTransitions);
  return {
    schemaVersion: "1.0.0",
    before: {
      generatedAt: before.catalog.generatedAt,
      counts: { ...before.catalog.counts, provisionsRead: before.provisions.size }
    },
    after: {
      generatedAt: after.catalog.generatedAt,
      counts: { ...after.catalog.counts, provisionsRead: after.provisions.size }
    },
    summary: {
      titlesAdded: titleChanges.added.length,
      titlesRemoved: titleChanges.removed.length,
      titlesChanged: titleChanges.changed.length,
      chaptersAdded: chapterChanges.added.length,
      chaptersRemoved: chapterChanges.removed.length,
      chaptersChanged: chapterChanges.changed.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      statusTransitions: statusTransitions.length
    },
    structure: {
      titles: titleChanges,
      chapters: chapterChanges
    },
    added,
    removed,
    changed,
    statusTransitions
  };
}

function displayCitation(value) {
  return value.citation ?? value.citations?.join("–") ?? value.id;
}

export function renderDiffMarkdown(report) {
  const lines = [
    "# CGS corpus diff",
    "",
    `Before: ${report.before.generatedAt} (${report.before.counts.provisionsRead.toLocaleString("en-US")} provisions)`,
    "",
    `After: ${report.after.generatedAt} (${report.after.counts.provisionsRead.toLocaleString("en-US")} provisions)`,
    "",
    "| Change | Count |",
    "| --- | ---: |",
    `| Titles added | ${report.summary.titlesAdded} |`,
    `| Titles removed | ${report.summary.titlesRemoved} |`,
    `| Titles changed | ${report.summary.titlesChanged} |`,
    `| Chapters added | ${report.summary.chaptersAdded} |`,
    `| Chapters removed | ${report.summary.chaptersRemoved} |`,
    `| Chapters changed | ${report.summary.chaptersChanged} |`,
    `| Added | ${report.summary.added} |`,
    `| Removed | ${report.summary.removed} |`,
    `| Changed | ${report.summary.changed} |`,
    `| Status transitions | ${report.summary.statusTransitions} |`,
    ""
  ];
  const sections = [
    ["Titles added", report.structure.titles.added, (item) => `- Title ${item.number} — ${item.name}`],
    ["Titles removed", report.structure.titles.removed, (item) => `- Title ${item.number} — ${item.name}`],
    ["Titles changed", report.structure.titles.changed, (item) => `- Title ${item.after.number} — ${item.changes.join(", ")}: ${item.after.name}`],
    ["Chapters added", report.structure.chapters.added, (item) => `- Chapter ${item.number} — ${item.name} (${item.titleId})`],
    ["Chapters removed", report.structure.chapters.removed, (item) => `- Chapter ${item.number} — ${item.name} (${item.titleId})`],
    ["Chapters changed", report.structure.chapters.changed, (item) => `- Chapter ${item.after.number} — ${item.changes.join(", ")}: ${item.after.name}`],
    ["Status transitions", report.statusTransitions, (item) => `- ${displayCitation(item)} — ${item.from} → ${item.to}: ${item.heading}`],
    ["Added", report.added, (item) => `- ${displayCitation(item)} — ${item.heading} (${item.chapterId})`],
    ["Removed", report.removed, (item) => `- ${displayCitation(item)} — ${item.heading} (${item.chapterId})`],
    ["Changed", report.changed, (item) => `- ${displayCitation(item.after)} — ${item.changes.join(", ")}: ${item.after.heading}`]
  ];
  for (const [heading, items, format] of sections) {
    if (!items.length) continue;
    lines.push(`## ${heading}`, "", ...items.map(format), "");
  }
  return `${lines.join("\n")}\n`;
}
