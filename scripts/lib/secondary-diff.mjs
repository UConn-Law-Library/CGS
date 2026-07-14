import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SAMPLE_LIMIT = 50;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withoutResolution(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "resolution" || key === "authorityResolution" ? undefined : item));
}

function resolutions(value) {
  const result = [];
  function visit(current, currentPath) {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}/${index}`));
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      const itemPath = `${currentPath}/${key}`;
      if (key === "resolution" || key === "authorityResolution") result.push([itemPath, item]);
      else visit(item, itemPath);
    }
  }
  visit(value, "");
  return result;
}

function snapshot(value, label) {
  return {
    id: value.id,
    label,
    contentHash: digest(withoutResolution(value)),
    resolutionHash: digest(resolutions(value))
  };
}

async function loadSecondary(directory) {
  const root = path.resolve(directory);
  const manifest = await readJson(path.join(root, "manifest.json"));
  const infractionsManifest = await readJson(path.join(root, "infractions", "manifest.json"));
  const indexManifest = await readJson(path.join(root, "statutes-index", "manifest.json"));
  const feeRulesArtifact = await readJson(path.join(root, "infractions", "fee-rules.json"));
  const infractions = new Map();
  for (const shard of infractionsManifest.shards) {
    const artifact = await readJson(path.join(root, "infractions", shard.path));
    for (const entry of artifact.entries) infractions.set(entry.id, snapshot(entry, `${entry.citation}: ${entry.description}`));
  }
  const feeRules = new Map(feeRulesArtifact.rules.map((rule) => [rule.id, snapshot(rule, `${rule.authorityCitation}: ${rule.description}`)]));
  const indexHeadings = new Map();
  const indexEntries = new Map();
  for (const shard of indexManifest.shards) {
    const artifact = await readJson(path.join(root, "statutes-index", shard.path));
    for (const heading of artifact.headings) {
      indexHeadings.set(heading.id, snapshot({ ...heading, items: undefined }, heading.label));
      for (const entry of heading.items) indexEntries.set(entry.id, snapshot(entry, `${heading.label}: ${entry.text}`));
    }
  }
  return {
    generatedAt: manifest.generatedAt,
    counts: {
      infractions: infractions.size,
      feeRules: feeRules.size,
      feeRuleReferences: infractionsManifest.counts.feeRuleReferences,
      feeRuleResolved: infractionsManifest.counts.feeRuleResolved,
      indexHeadings: indexHeadings.size,
      indexItems: indexEntries.size,
      indexReferences: indexManifest.counts.references,
      indexResolved: indexManifest.counts.resolved,
      infractionsResolved: infractionsManifest.counts.resolved
    },
    collections: { infractions, feeRules, indexHeadings, indexEntries }
  };
}

function diffCollection(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  let resolutionChanged = 0;
  for (const [id, current] of after) {
    const previous = before.get(id);
    if (!previous) added.push(current);
    else if (previous.contentHash !== current.contentHash || previous.resolutionHash !== current.resolutionHash) {
      const fields = [];
      if (previous.contentHash !== current.contentHash) fields.push("content");
      if (previous.resolutionHash !== current.resolutionHash) {
        fields.push("resolution");
        resolutionChanged += 1;
      }
      changed.push({ id, label: current.label, fields });
    }
  }
  for (const [id, previous] of before) if (!after.has(id)) removed.push(previous);
  const sort = (values) => values.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  sort(added); sort(removed); sort(changed);
  return {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    resolutionChanged,
    samples: {
      added: added.slice(0, SAMPLE_LIMIT).map(({ id, label }) => ({ id, label })),
      removed: removed.slice(0, SAMPLE_LIMIT).map(({ id, label }) => ({ id, label })),
      changed: changed.slice(0, SAMPLE_LIMIT)
    }
  };
}

export async function diffSecondarySources({ beforeDir, afterDir }) {
  const before = await loadSecondary(beforeDir);
  const after = await loadSecondary(afterDir);
  const changes = Object.fromEntries(Object.keys(before.collections).map((key) => [
    key, diffCollection(before.collections[key], after.collections[key])
  ]));
  return {
    schemaVersion: "1.0.0",
    before: { generatedAt: before.generatedAt, counts: before.counts },
    after: { generatedAt: after.generatedAt, counts: after.counts },
    changes
  };
}

export function renderSecondaryDiffMarkdown(report) {
  const lines = [
    "# CGS secondary-source diff", "",
    `Before: ${report.before.generatedAt}`, "", `After: ${report.after.generatedAt}`, "",
    "| Dataset | Before | After | Added | Removed | Changed | Resolution changes |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];
  const datasets = [
    ["Infractions", "infractions", "infractions"],
    ["Fee rules", "feeRules", "feeRules"],
    ["Index headings", "indexHeadings", "indexHeadings"],
    ["Index entries", "indexItems", "indexEntries"]
  ];
  for (const [label, countKey, changeKey] of datasets) {
    const change = report.changes[changeKey];
    lines.push(`| ${label} | ${report.before.counts[countKey].toLocaleString("en-US")} | ${report.after.counts[countKey].toLocaleString("en-US")} | ${change.added} | ${change.removed} | ${change.changed} | ${change.resolutionChanged} |`);
  }
  for (const [label, , changeKey] of datasets) {
    const samples = report.changes[changeKey].samples;
    for (const kind of ["added", "removed", "changed"]) {
      if (!samples[kind].length) continue;
      lines.push("", `## ${label} ${kind} (first ${SAMPLE_LIMIT})`, "");
      for (const item of samples[kind]) lines.push(`- ${item.label} (${item.id})${item.fields ? ` — ${item.fields.join(", ")}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
