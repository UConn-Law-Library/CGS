import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./json-schema.mjs";
import { classifyChapterOverlay } from "./supplement-overlay.mjs";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function validateSupplement({ supplementDir, baseDataDir, schemaDir }) {
  const root = path.resolve(supplementDir);
  const base = path.resolve(baseDataDir);
  const schemas = path.resolve(schemaDir);
  const errors = [];
  const manifest = await readJson(path.join(root, "manifest.json"));
  const manifestSchema = await readJson(path.join(schemas, "supplement-manifest.schema.json"));
  const chapterSchema = await readJson(path.join(schemas, "chapter.schema.json"));
  errors.push(...validateSchema(manifest, manifestSchema).map((error) => `manifest.json ${error}`));

  const baseCatalog = await readJson(path.join(base, "catalog.json"));
  const baseManifestBytes = await readFile(path.join(base, "manifest.json"));
  const baseManifestSha256 = createHash("sha256").update(baseManifestBytes).digest("hex");
  if (
    manifest.base?.schemaVersion !== baseCatalog.schemaVersion
    || manifest.base?.generatedAt !== baseCatalog.generatedAt
    || manifest.base?.manifestSha256 !== baseManifestSha256
  ) {
    errors.push("manifest.json: base corpus identity does not match the current canonical corpus");
  }
  const baseTitles = new Map(baseCatalog.titles.map((title) => [title.id, title]));
  const artifactByPath = new Map((manifest.artifacts ?? []).map((artifact) => [artifact.path, artifact]));
  const seenPaths = new Set();
  let chapters = 0;
  let sections = 0;
  let replacements = 0;
  let additions = 0;

  for (const title of manifest.titles ?? []) {
    const baseTitle = baseTitles.get(title.id);
    const baseChapters = new Map((baseTitle?.chapters ?? []).map((chapter) => [chapter.id, chapter]));
    for (const entry of title.chapters ?? []) {
      chapters += 1;
      sections += entry.sectionCount ?? 0;
      if (seenPaths.has(entry.path)) errors.push(`manifest.json: duplicate chapter path ${entry.path}`);
      seenPaths.add(entry.path);
      const chapterFile = path.join(root, ...entry.path.split("/"));
      const chapter = await readJson(chapterFile).catch((error) => {
        errors.push(`${entry.path}: cannot be read (${error.message})`);
        return null;
      });
      if (!chapter) continue;
      errors.push(...validateSchema(chapter, chapterSchema).map((error) => `${entry.path} ${error}`));
      if (chapter.id !== entry.id || chapter.title?.id !== title.id) errors.push(`${entry.path}: catalog identity mismatch`);
      if (chapter.sections?.length !== entry.sectionCount) errors.push(`${entry.path}: section count mismatch`);
      const baseEntry = baseChapters.get(entry.id);
      const baseChapter = baseEntry ? await readJson(path.join(base, baseEntry.path)) : null;
      try {
        const classification = classifyChapterOverlay(chapter, baseChapter);
        replacements += classification.replacements;
        additions += classification.additions;
        if (classification.replacements !== entry.replacementCount || classification.additions !== entry.additionCount) {
          errors.push(`${entry.path}: replacement/addition counts do not match manifest`);
        }
      } catch (error) {
        errors.push(error.message);
      }

      const artifact = artifactByPath.get(entry.path);
      if (!artifact) errors.push(`manifest.json: missing artifact record for ${entry.path}`);
      else {
        const bytes = await readFile(chapterFile);
        if (bytes.byteLength !== artifact.bytes) errors.push(`${entry.path}: byte length does not match manifest`);
        if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) errors.push(`${entry.path}: SHA-256 does not match manifest`);
      }
    }
  }
  for (const artifact of manifest.artifacts ?? []) {
    if (!seenPaths.has(artifact.path)) errors.push(`manifest.json: unexpected artifact ${artifact.path}`);
  }
  const actual = { titles: manifest.titles?.length ?? 0, chapters, sections, replacements, additions };
  for (const [key, value] of Object.entries(actual)) {
    if (manifest.counts?.[key] !== value) errors.push(`manifest.json: ${key} count is ${manifest.counts?.[key]}, expected ${value}`);
  }
  return { errors, editionYear: manifest.editionYear, counts: actual };
}

export async function validateSupplements({ supplementsDir, baseDataDir, schemaDir }) {
  const root = path.resolve(supplementsDir);
  if (!(await stat(root).catch(() => null))?.isDirectory()) return { errors: [], editions: 0 };
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const errors = [];
  for (const name of names) {
    const result = await validateSupplement({ supplementDir: path.join(root, name), baseDataDir, schemaDir });
    errors.push(...result.errors.map((error) => `supplements/${name}/${error}`));
    if (String(result.editionYear) !== name) errors.push(`supplements/${name}: editionYear does not match directory`);
  }
  return { errors, editions: names.length };
}
