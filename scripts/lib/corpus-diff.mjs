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

async function loadCorpus(dataDir, titleIds) {
  const root = path.resolve(dataDir);
  const catalog = await readJson(path.join(root, "catalog.json"));
  const provisions = new Map();
  for (const title of catalog.titles) {
    if (titleIds?.size && !titleIds.has(title.id)) continue;
    for (const chapterEntry of title.chapters) {
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
  return { catalog, provisions };
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
  return values.sort((left, right) => collator.compare(left.key, right.key));
}

export async function diffCorpora({ beforeDir, afterDir, titleIds }) {
  if (!beforeDir || !afterDir) throw new Error("beforeDir and afterDir are required");
  const selectedTitles = titleIds?.length ? new Set(titleIds) : null;
  const before = await loadCorpus(beforeDir, selectedTitles);
  const after = await loadCorpus(afterDir, selectedTitles);
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
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      statusTransitions: statusTransitions.length
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
    `| Added | ${report.summary.added} |`,
    `| Removed | ${report.summary.removed} |`,
    `| Changed | ${report.summary.changed} |`,
    `| Status transitions | ${report.summary.statusTransitions} |`,
    ""
  ];
  const sections = [
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
