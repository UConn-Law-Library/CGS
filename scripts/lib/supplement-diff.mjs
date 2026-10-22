import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyChapterOverlay } from "./supplement-overlay.mjs";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));

async function snapshot(directory, baseDirectory) {
  const manifest = await read(path.join(directory, "manifest.json"));
  const base = await read(path.join(baseDirectory, "catalog.json"));
  const chapters = new Map(base.titles.flatMap((title) => title.chapters.map((chapter) => [chapter.id, chapter])));
  const records = new Map();
  for (const title of manifest.titles) for (const entry of title.chapters) {
    const overlay = await read(path.join(directory, entry.path));
    const original = chapters.get(entry.id);
    const applied = applyChapterOverlay(original ? await read(path.join(baseDirectory, original.path)) : null, overlay, manifest.editionYear);
    const classifications = new Map(applied.overlay.changes.map((change) => [change.sectionId, change.kind]));
    for (const section of overlay.sections) for (const citation of section.citations ?? [section.citation]) {
      if (records.has(citation)) throw new Error(`Duplicate supplement citation: ${citation}`);
      records.set(citation, { chapter: entry.number, classification: classifications.get(section.id),
        heading: section.heading, status: section.status, content: section.content, citations: section.citations });
    }
  }
  return { editionYear: manifest.editionYear, records };
}

export async function diffSupplement({ before, after, beforeBase, afterBase }) {
  const previous = await snapshot(before, beforeBase);
  const next = await snapshot(after, afterBase);
  if (previous.editionYear !== next.editionYear) throw new Error("Compare the same supplement edition; retirement is reviewed separately.");
  const added = [], removed = [], changed = [];
  for (const citation of [...new Set([...previous.records.keys(), ...next.records.keys()])].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    const oldValue = previous.records.get(citation), newValue = next.records.get(citation);
    if (!oldValue) added.push({ citation, after: newValue });
    else if (!newValue) removed.push({ citation, before: oldValue });
    else {
      const fields = Object.keys(oldValue).filter((key) => JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key]));
      if (fields.length) changed.push({ citation, fields, before: oldValue, after: newValue });
    }
  }
  return { editionYear: next.editionYear, beforeCount: previous.records.size, afterCount: next.records.size, added, removed, changed };
}

export function evaluateSupplementDiff(report, policy) {
  if (policy.version !== 1 || !Number.isInteger(policy.maxRemovedCitations) || policy.maxRemovedCitations < 0
    || !Number.isInteger(policy.maxClassificationChanges) || policy.maxClassificationChanges < 0) throw new Error("Invalid supplement refresh policy");
  const reasons = [];
  if (report.removed.length > policy.maxRemovedCitations) reasons.push(`${report.removed.length} citations removed`);
  const reclassified = report.changed.filter((entry) => entry.fields.includes("classification")).length;
  if (reclassified > policy.maxClassificationChanges) reasons.push(`${reclassified} replacement/addition classifications changed`);
  return { passed: reasons.length === 0, reasons };
}

export function renderSupplementDiff(report, review) {
  const lines = [`## ${report.editionYear} supplement review`, "",
    `${report.added.length} added; ${report.removed.length} removed; ${report.changed.length} changed citations.`, "",
    review.passed ? "Policy passed. Review the text changes before merging." : `Policy blocked: ${review.reasons.join("; ")}.`, ""];
  for (const [label, rows] of [["Added", report.added], ["Removed", report.removed], ["Changed", report.changed]]) {
    if (!rows.length) continue;
    lines.push(`### ${label}`, "", ...rows.slice(0, 100).map((row) => `- ${row.citation}: ${row.fields?.join(", ") ?? (row.after ?? row.before).classification}`), "");
    if (rows.length > 100) lines.push(`Showing 100 of ${rows.length}; the JSON artifact contains every record and the before/after text.`, "");
  }
  const textChanges = report.changed.filter((row) => row.fields.some((field) => ["content", "heading", "status"].includes(field)));
  if (textChanges.length) {
    const preview = (value) => JSON.stringify(value, null, 2).slice(0, 1200)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    lines.push("### Text previews", "", "The JSON artifact retains the complete before/after records. Previews are limited to ten citations and 1,200 characters per version.", "");
    for (const row of textChanges.slice(0, 10)) {
      lines.push(`**${row.citation}** (${row.before.classification} → ${row.after.classification})`, "",
        `<details><summary>Before</summary><pre>${preview(row.before)}</pre></details>`, "",
        `<details><summary>After</summary><pre>${preview(row.after)}</pre></details>`, "");
    }
  }
  return lines.join("\n") + "\n";
}
