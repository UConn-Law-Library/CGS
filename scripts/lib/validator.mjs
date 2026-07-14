import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./json-schema.mjs";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function loadSchemas(schemaDir) {
  const names = ["catalog", "chapter", "search-shard", "search-manifest", "build-manifest"];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readJson(path.join(schemaDir, `${name}.schema.json`))])));
}

function pushSchemaErrors(errors, label, instance, schema) {
  errors.push(...validateSchema(instance, schema).map((error) => `${label} ${error}`));
}

export async function validateCorpus({ dataDir, schemaDir }) {
  const data = path.resolve(dataDir);
  const schemas = await loadSchemas(path.resolve(schemaDir));
  const errors = [];
  const catalog = await readJson(path.join(data, "catalog.json"));
  const manifest = await readJson(path.join(data, "manifest.json"));
  const searchManifest = await readJson(path.join(data, "search", "manifest.json"));
  pushSchemaErrors(errors, "catalog.json", catalog, schemas.catalog);
  pushSchemaErrors(errors, "manifest.json", manifest, schemas["build-manifest"]);
  pushSchemaErrors(errors, "search/manifest.json", searchManifest, schemas["search-manifest"]);

  const chapterIds = new Set();
  const chapterPaths = new Set();
  const titleIds = new Set();
  const canonicalDocuments = new Map();
  let chapterCount = 0;
  let sectionCount = 0;

  for (const title of catalog.titles ?? []) {
    if (titleIds.has(title.id)) errors.push(`catalog.json: duplicate title ID ${title.id}`);
    titleIds.add(title.id);
    for (const entry of title.chapters ?? []) {
      chapterCount += 1;
      sectionCount += entry.sectionCount ?? 0;
      if (chapterIds.has(entry.id)) errors.push(`catalog.json: duplicate chapter ID ${entry.id}`);
      if (chapterPaths.has(entry.path)) errors.push(`catalog.json: duplicate chapter path ${entry.path}`);
      chapterIds.add(entry.id);
      chapterPaths.add(entry.path);
      const chapter = await readJson(path.join(data, entry.path)).catch((error) => {
        errors.push(`${entry.path}: cannot be read (${error.message})`);
        return null;
      });
      if (!chapter) continue;
      pushSchemaErrors(errors, entry.path, chapter, schemas.chapter);
      if (chapter.id !== entry.id) errors.push(`${entry.path}: chapter ID does not match catalog`);
      if (chapter.title?.id !== title.id) errors.push(`${entry.path}: title ID does not match catalog`);
      if (chapter.sections?.length !== entry.sectionCount) errors.push(`${entry.path}: section count does not match catalog`);
      const localIds = new Set();
      for (const section of chapter.sections ?? []) {
        if (localIds.has(section.id)) errors.push(`${entry.path}: duplicate section ID ${section.id}`);
        localIds.add(section.id);
        const key = `${title.id}/${entry.id}/${section.id}`;
        canonicalDocuments.set(key, section);
        if (section.kind === "section" && (!section.citation || section.citations.length !== 1)) {
          errors.push(`${entry.path}/${section.id}: ordinary sections require one citation`);
        }
        if (section.kind === "group" && section.citation !== null) {
          errors.push(`${entry.path}/${section.id}: grouped provisions must have a null primary citation`);
        }
      }
    }
  }

  const expectedCounts = { titles: titleIds.size, chapters: chapterCount, sections: sectionCount };
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (catalog.counts?.[key] !== value) errors.push(`catalog.json: ${key} count is ${catalog.counts?.[key]}, expected ${value}`);
    if (manifest.counts?.[key] !== value) errors.push(`manifest.json: ${key} count is ${manifest.counts?.[key]}, expected ${value}`);
  }

  const shardByTitle = new Map((searchManifest.shards ?? []).map((shard) => [shard.titleId, shard]));
  const seenSearchDocuments = new Set();
  for (const title of catalog.titles ?? []) {
    const shardEntry = shardByTitle.get(title.id);
    if (!shardEntry) {
      errors.push(`search/manifest.json: missing shard for ${title.id}`);
      continue;
    }
    if (`search/${shardEntry.path}` !== title.searchPath) errors.push(`catalog.json: ${title.id} search path disagrees with search manifest`);
    const shard = await readJson(path.join(data, title.searchPath)).catch((error) => {
      errors.push(`${title.searchPath}: cannot be read (${error.message})`);
      return null;
    });
    if (!shard) continue;
    pushSchemaErrors(errors, title.searchPath, shard, schemas["search-shard"]);
    if (shard.title?.id !== title.id) errors.push(`${title.searchPath}: title ID does not match catalog`);
    if (shard.documents?.length !== shardEntry.documentCount) errors.push(`${title.searchPath}: document count does not match manifest`);
    for (const document of shard.documents ?? []) {
      const key = `${title.id}/${document.chapter.id}/${document.id}`;
      const canonical = canonicalDocuments.get(key);
      if (!canonical) errors.push(`${title.searchPath}: search document has no canonical section: ${key}`);
      else if (canonical.content.plainText !== document.text || canonical.heading !== document.heading) {
        errors.push(`${title.searchPath}: search document is stale: ${key}`);
      }
      if (seenSearchDocuments.has(key)) errors.push(`${title.searchPath}: duplicate search document ${key}`);
      seenSearchDocuments.add(key);
    }
  }
  for (const titleId of shardByTitle.keys()) {
    if (!titleIds.has(titleId)) errors.push(`search/manifest.json: unknown title shard ${titleId}`);
  }
  if (seenSearchDocuments.size !== canonicalDocuments.size) {
    errors.push(`Search contains ${seenSearchDocuments.size} documents; canonical chapters contain ${canonicalDocuments.size}`);
  }
  if (manifest.counts?.searchDocuments !== seenSearchDocuments.size) {
    errors.push(`manifest.json: searchDocuments count is ${manifest.counts?.searchDocuments}, expected ${seenSearchDocuments.size}`);
  }

  const artifactPaths = new Set();
  for (const artifact of manifest.artifacts ?? []) {
    if (artifactPaths.has(artifact.path)) errors.push(`manifest.json: duplicate artifact ${artifact.path}`);
    artifactPaths.add(artifact.path);
    const bytes = await readFile(path.join(data, artifact.path)).catch((error) => {
      errors.push(`${artifact.path}: cannot verify (${error.message})`);
      return null;
    });
    if (!bytes) continue;
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== artifact.bytes) errors.push(`${artifact.path}: byte length does not match manifest`);
    if (digest !== artifact.sha256) errors.push(`${artifact.path}: SHA-256 does not match manifest`);
  }
  const expectedArtifacts = new Set([
    "catalog.json",
    "search/manifest.json",
    ...(catalog.titles ?? []).map((title) => title.searchPath),
    ...(catalog.titles ?? []).flatMap((title) => title.chapters.map((chapter) => chapter.path))
  ]);
  for (const expected of expectedArtifacts) {
    if (!artifactPaths.has(expected)) errors.push(`manifest.json: missing artifact record for ${expected}`);
  }
  for (const actual of artifactPaths) {
    if (!expectedArtifacts.has(actual)) errors.push(`manifest.json: unexpected artifact record for ${actual}`);
  }

  return { errors, counts: { ...expectedCounts, searchDocuments: seenSearchDocuments.size } };
}
