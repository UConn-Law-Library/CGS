import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./json-schema.mjs";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function schemaErrors(label, value, schema) {
  return validateSchema(value, schema).map((error) => `${label} ${error}`);
}

async function loadSchemas(schemaDir) {
  const names = [
    "secondary-manifest",
    "infractions-manifest",
    "infractions-shard",
    "infractions-fee-rules",
    "statutes-index-manifest",
    "statutes-index-shard",
    "secondary-links-manifest",
    "secondary-links"
  ];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readJson(path.join(schemaDir, `${name}.schema.json`))])));
}

async function canonicalTargets(baseDir) {
  const catalog = await readJson(path.join(baseDir, "catalog.json"));
  const targets = new Map();
  for (const title of catalog.titles ?? []) {
    for (const entry of title.chapters ?? []) {
      const chapter = await readJson(path.join(baseDir, entry.path));
      for (const section of chapter.sections ?? []) {
        for (const citation of section.citations ?? []) targets.set(citation.toLowerCase(), {
          titleId: title.id,
          sectionId: section.id,
          href: `#/t/${title.number}/c/${entry.number}/s/${citation}`
        });
      }
    }
  }
  return { catalog, targets };
}

function checkResolution(errors, label, resolution, sectionCitation, targets) {
  const hasHref = Boolean(resolution?.href);
  if (["exact", "section-only"].includes(resolution?.status) !== hasHref) {
    errors.push(`${label}: resolution link/status mismatch`);
    return;
  }
  if (hasHref) {
    const target = targets.get(String(sectionCitation ?? "").toLowerCase());
    if (!target || target.href !== resolution.href) errors.push(`${label}: resolution link is not canonical (${sectionCitation})`);
  }
}

export async function validateSecondarySources({ secondaryDir, baseDataDir, schemaDir }) {
  const root = path.resolve(secondaryDir);
  if (!(await stat(root).catch(() => null))?.isDirectory()) {
    return { errors: [], present: false, counts: { infractions: 0, feeRules: 0, indexHeadings: 0, indexItems: 0 } };
  }
  const base = path.resolve(baseDataDir);
  const schemas = await loadSchemas(path.resolve(schemaDir));
  const errors = [];
  const manifest = await readJson(path.join(root, "manifest.json"));
  const infractionsManifest = await readJson(path.join(root, "infractions", "manifest.json"));
  const indexManifest = await readJson(path.join(root, "statutes-index", "manifest.json"));
  const linksManifest = await readJson(path.join(root, "links", "manifest.json"));
  errors.push(...schemaErrors("secondary/manifest.json", manifest, schemas["secondary-manifest"]));
  errors.push(...schemaErrors("secondary/infractions/manifest.json", infractionsManifest, schemas["infractions-manifest"]));
  errors.push(...schemaErrors("secondary/statutes-index/manifest.json", indexManifest, schemas["statutes-index-manifest"]));
  errors.push(...schemaErrors("secondary/links/manifest.json", linksManifest, schemas["secondary-links-manifest"]));

  const { catalog, targets } = await canonicalTargets(base);
  const baseManifestBytes = await readFile(path.join(base, "manifest.json"));
  const baseManifestSha256 = createHash("sha256").update(baseManifestBytes).digest("hex");
  if (
    manifest.base?.schemaVersion !== catalog.schemaVersion
    || manifest.base?.generatedAt !== catalog.generatedAt
    || manifest.base?.manifestSha256 !== baseManifestSha256
  ) errors.push("secondary/manifest.json: base corpus identity does not match the canonical corpus");

  const artifactByPath = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    if (artifactByPath.has(artifact.path)) errors.push(`secondary/manifest.json: duplicate artifact ${artifact.path}`);
    artifactByPath.set(artifact.path, artifact);
    const bytes = await readFile(path.join(root, ...artifact.path.split("/"))).catch((error) => {
      errors.push(`secondary/${artifact.path}: cannot be read (${error.message})`);
      return null;
    });
    if (!bytes) continue;
    if (bytes.byteLength !== artifact.bytes) errors.push(`secondary/${artifact.path}: byte length does not match manifest`);
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) errors.push(`secondary/${artifact.path}: SHA-256 does not match manifest`);
  }

  const expectedPaths = new Set(["infractions/manifest.json", "infractions/fee-rules.json", "statutes-index/manifest.json", "links/manifest.json"]);
  const infractionIds = new Set();
  let infractions = 0;
  let resolvedInfractions = 0;
  for (const shardEntry of infractionsManifest.shards ?? []) {
    const relative = `infractions/${shardEntry.path}`;
    expectedPaths.add(relative);
    const shard = await readJson(path.join(root, "infractions", shardEntry.path));
    errors.push(...schemaErrors(`secondary/${relative}`, shard, schemas["infractions-shard"]));
    if (shard.entries?.length !== shardEntry.entryCount) errors.push(`secondary/${relative}: entry count mismatch`);
    for (const entry of shard.entries ?? []) {
      infractions += 1;
      if (infractionIds.has(entry.id)) errors.push(`secondary/${relative}: duplicate infraction ID ${entry.id}`);
      infractionIds.add(entry.id);
      checkResolution(errors, `secondary/${relative}/${entry.id}`, entry.resolution, entry.sectionCitation, targets);
      if (entry.resolution?.status !== "unresolved") resolvedInfractions += 1;
      const targetTitle = targets.get(entry.sectionCitation?.toLowerCase())?.titleId ?? "unresolved";
      if (targetTitle !== shardEntry.key) errors.push(`secondary/${relative}/${entry.id}: entry is in the wrong title shard`);
    }
  }
  if (infractionsManifest.counts?.entries !== infractions) errors.push("secondary/infractions/manifest.json: entries count mismatch");
  if (infractionsManifest.counts?.resolved !== resolvedInfractions) errors.push("secondary/infractions/manifest.json: resolved count mismatch");

  const feeRuleArtifact = await readJson(path.join(root, "infractions", "fee-rules.json"));
  errors.push(...schemaErrors("secondary/infractions/fee-rules.json", feeRuleArtifact, schemas["infractions-fee-rules"]));
  if (feeRuleArtifact.revision !== infractionsManifest.source?.chartBRevision) {
    errors.push("secondary/infractions/fee-rules.json: revision does not match source manifest");
  }
  const feeRuleIds = new Set();
  const expectedFeeLinks = new Set();
  let feeRuleReferences = 0;
  let feeRuleResolved = 0;
  for (const rule of feeRuleArtifact.rules ?? []) {
    if (feeRuleIds.has(rule.id)) errors.push(`secondary/infractions/fee-rules.json: duplicate fee rule ID ${rule.id}`);
    feeRuleIds.add(rule.id);
    checkResolution(errors, `secondary/infractions/fee-rules.json/${rule.id}/authority`, rule.authorityResolution, rule.sectionCitation, targets);
    const authorityTarget = targets.get(rule.sectionCitation?.toLowerCase());
    if (authorityTarget && rule.authorityResolution?.status !== "unresolved") {
      expectedFeeLinks.add(`${authorityTarget.titleId}|${rule.sectionCitation.toLowerCase()}|${rule.id}|authority`);
    }
    for (const reference of rule.affectedReferences ?? []) {
      feeRuleReferences += 1;
      checkResolution(errors, `secondary/infractions/fee-rules.json/${rule.id}/affected`, reference.resolution, reference.sectionCitation, targets);
      if (reference.resolution?.status !== "unresolved") feeRuleResolved += 1;
      const target = targets.get(reference.sectionCitation?.toLowerCase());
      if (target && reference.resolution?.status !== "unresolved") {
        expectedFeeLinks.add(`${target.titleId}|${reference.sectionCitation.toLowerCase()}|${rule.id}|affected`);
      }
    }
  }
  const expectedFeeCounts = {
    feeRules: feeRuleIds.size,
    feeRuleReferences,
    feeRuleResolved
  };
  for (const [key, value] of Object.entries(expectedFeeCounts)) {
    if (infractionsManifest.counts?.[key] !== value) errors.push(`secondary/infractions/manifest.json: ${key} count mismatch`);
  }

  const topicIds = new Set();
  const indexEntryIds = new Set();
  let indexHeadings = 0;
  let indexItems = 0;
  let indexReferences = 0;
  let resolvedReferences = 0;
  for (const shardEntry of indexManifest.shards ?? []) {
    const relative = `statutes-index/${shardEntry.path}`;
    expectedPaths.add(relative);
    const shard = await readJson(path.join(root, "statutes-index", shardEntry.path));
    errors.push(...schemaErrors(`secondary/${relative}`, shard, schemas["statutes-index-shard"]));
    if (shard.headings?.length !== shardEntry.headingCount) errors.push(`secondary/${relative}: heading count mismatch`);
    const localItems = (shard.headings ?? []).reduce((count, heading) => count + heading.items.length, 0);
    if (localItems !== shardEntry.itemCount) errors.push(`secondary/${relative}: item count mismatch`);
    for (const heading of shard.headings ?? []) {
      indexHeadings += 1;
      if (topicIds.has(heading.id)) errors.push(`secondary/${relative}: duplicate topic ID ${heading.id}`);
      topicIds.add(heading.id);
      for (const entry of heading.items ?? []) {
        indexItems += 1;
        if (indexEntryIds.has(entry.id)) errors.push(`secondary/${relative}: duplicate index entry ID ${entry.id}`);
        indexEntryIds.add(entry.id);
        for (const reference of entry.references ?? []) {
          indexReferences += 1;
          checkResolution(errors, `secondary/${relative}/${entry.id}`, reference.resolution, reference.sectionCitation, targets);
          if (["exact", "section-only"].includes(reference.resolution?.status)) resolvedReferences += 1;
        }
      }
    }
  }
  const expectedIndexCounts = { headings: indexHeadings, items: indexItems, references: indexReferences, resolved: resolvedReferences };
  for (const [key, value] of Object.entries(expectedIndexCounts)) {
    if (indexManifest.counts?.[key] !== value) errors.push(`secondary/statutes-index/manifest.json: ${key} count mismatch`);
  }

  const actualFeeLinks = new Set();
  for (const shardEntry of linksManifest.shards ?? []) {
    const relative = `links/${shardEntry.path}`;
    expectedPaths.add(relative);
    const shard = await readJson(path.join(root, "links", shardEntry.path));
    errors.push(...schemaErrors(`secondary/${relative}`, shard, schemas["secondary-links"]));
    if (shard.titleId !== shardEntry.titleId) errors.push(`secondary/${relative}: title ID mismatch`);
    if (Object.keys(shard.sections ?? {}).length !== shardEntry.sectionCount) errors.push(`secondary/${relative}: section count mismatch`);
    for (const [citation, values] of Object.entries(shard.sections ?? {})) {
      if (targets.get(citation.toLowerCase())?.titleId !== shard.titleId) errors.push(`secondary/${relative}: unknown section ${citation}`);
      for (const link of values.infractions ?? []) if (!infractionIds.has(link.id)) errors.push(`secondary/${relative}: unknown infraction ${link.id}`);
      if (!Array.isArray(values.feeRules)) errors.push(`secondary/${relative}/${citation}: feeRules must be an array`);
      for (const link of values.feeRules ?? []) {
        if (!feeRuleIds.has(link.id)) errors.push(`secondary/${relative}: unknown fee rule ${link.id}`);
        if (!["authority", "affected"].includes(link.role)) errors.push(`secondary/${relative}: invalid fee rule role ${link.role}`);
        actualFeeLinks.add(`${shard.titleId}|${citation.toLowerCase()}|${link.id}|${link.role}`);
      }
      for (const link of values.indexEntries ?? []) {
        if (!topicIds.has(link.topicId)) errors.push(`secondary/${relative}: unknown topic ${link.topicId}`);
        if (!indexEntryIds.has(link.entryId)) errors.push(`secondary/${relative}: unknown index entry ${link.entryId}`);
      }
    }
  }
  for (const link of expectedFeeLinks) if (!actualFeeLinks.has(link)) errors.push(`secondary links: missing fee-rule reverse link ${link}`);
  for (const link of actualFeeLinks) if (!expectedFeeLinks.has(link)) errors.push(`secondary links: unexpected fee-rule reverse link ${link}`);
  for (const expected of expectedPaths) if (!artifactByPath.has(expected)) errors.push(`secondary/manifest.json: missing artifact ${expected}`);
  for (const actual of artifactByPath.keys()) if (!expectedPaths.has(actual)) errors.push(`secondary/manifest.json: unexpected artifact ${actual}`);

  const counts = { infractions, feeRules: feeRuleIds.size, indexHeadings, indexItems };
  for (const [key, value] of Object.entries(counts)) {
    if (manifest.counts?.[key] !== value) errors.push(`secondary/manifest.json: ${key} count mismatch`);
  }
  return { errors, present: true, counts };
}
