import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { importLegacy, SCHEMA_VERSION } from "./importer.mjs";
import { classifyChapterOverlay } from "./supplement-overlay.mjs";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(root, relativePath, value) {
  const file = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(file, bytes);
  return {
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function assertSafePaths(inputDir, outputDir, baseDataDir) {
  const input = path.resolve(inputDir);
  const output = path.resolve(outputDir);
  const base = path.resolve(baseDataDir);
  if (
    [input, base].includes(output)
    || input.startsWith(`${output}${path.sep}`)
    || output.startsWith(`${input}${path.sep}`)
    || base.startsWith(`${output}${path.sep}`)
  ) {
    throw new Error("Supplement output cannot overwrite its input or base corpus");
  }
  if (output === path.parse(output).root || output === process.cwd()) throw new Error(`Refusing unsafe output directory: ${output}`);
}

export async function importSupplement({ inputDir, outputDir, baseDataDir, editionYear, generatedAt } = {}) {
  if (!inputDir || !outputDir || !baseDataDir) throw new Error("inputDir, outputDir, and baseDataDir are required");
  assertSafePaths(inputDir, outputDir, baseDataDir);
  const input = path.resolve(inputDir);
  const output = path.resolve(outputDir);
  const base = path.resolve(baseDataDir);
  if (!(await stat(input).catch(() => null))?.isDirectory()) throw new Error(`Supplement input directory does not exist: ${input}`);

  const legacyIndex = await readJson(path.join(input, "titles_index.json"));
  const sourceYear = Number(legacyIndex.source?.supplement_year);
  const year = Number(editionYear ?? sourceYear);
  if (legacyIndex.source?.kind !== "supplement" || !Number.isInteger(sourceYear) || sourceYear < 2000) {
    throw new Error("Supplement input must identify a valid supplement_year");
  }
  if (!Number.isInteger(year) || year < 2000 || year !== sourceYear) {
    throw new Error(`Requested supplement year ${editionYear} does not match source year ${sourceYear}`);
  }

  const temporaryCanonical = `${output}.canonical-${process.pid}`;
  const staging = `${output}.staging-${process.pid}`;
  await rm(temporaryCanonical, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
  try {
    await importLegacy({ inputDir: input, outputDir: temporaryCanonical, generatedAt });
    const overlayCatalog = await readJson(path.join(temporaryCanonical, "catalog.json"));
    const baseCatalog = await readJson(path.join(base, "catalog.json"));
    const baseManifestBytes = await readFile(path.join(base, "manifest.json"));
    const baseTitles = new Map(baseCatalog.titles.map((title) => [title.id, title]));
    const artifacts = [];
    const titles = [];
    let chapterCount = 0;
    let sectionCount = 0;
    let replacementCount = 0;
    let additionCount = 0;

    await mkdir(staging, { recursive: true });
    for (const title of overlayCatalog.titles) {
      const baseTitle = baseTitles.get(title.id);
      const baseChapters = new Map((baseTitle?.chapters ?? []).map((chapter) => [chapter.id, chapter]));
      const chapters = [];
      for (const chapterEntry of title.chapters) {
        const overlayChapter = await readJson(path.join(temporaryCanonical, chapterEntry.path));
        const baseEntry = baseChapters.get(chapterEntry.id);
        const baseChapter = baseEntry ? await readJson(path.join(base, baseEntry.path)) : null;
        const classification = classifyChapterOverlay(overlayChapter, baseChapter);
        const chapterPath = `chapters/${chapterEntry.number}.json`;
        artifacts.push(await writeJson(staging, chapterPath, overlayChapter));
        chapters.push({
          id: chapterEntry.id,
          number: chapterEntry.number,
          name: chapterEntry.name,
          path: chapterPath,
          sourceUrl: chapterEntry.sourceUrl,
          sectionCount: chapterEntry.sectionCount,
          replacementCount: classification.replacements,
          additionCount: classification.additions
        });
        chapterCount += 1;
        sectionCount += chapterEntry.sectionCount;
        replacementCount += classification.replacements;
        additionCount += classification.additions;
      }
      titles.push({ id: title.id, number: title.number, name: title.name, sourceUrl: title.sourceUrl, chapters });
    }

    artifacts.sort((left, right) => collator.compare(left.path, right.path));
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      editionYear: year,
      generatedAt: overlayCatalog.generatedAt,
      strategy: "replace-by-citation",
      base: {
        schemaVersion: baseCatalog.schemaVersion,
        generatedAt: baseCatalog.generatedAt,
        manifestSha256: createHash("sha256").update(baseManifestBytes).digest("hex")
      },
      source: {
        name: `Connecticut General Statutes ${year} supplement`,
        url: overlayCatalog.source.url,
        retrievedAt: overlayCatalog.generatedAt
      },
      titles,
      counts: {
        titles: titles.length,
        chapters: chapterCount,
        sections: sectionCount,
        replacements: replacementCount,
        additions: additionCount
      },
      artifacts
    };
    await writeJson(staging, "manifest.json", manifest);
    await rm(output, { recursive: true, force: true });
    await mkdir(path.dirname(output), { recursive: true });
    await rename(staging, output);
    return { outputDir: output, editionYear: year, ...manifest.counts };
  } finally {
    await rm(temporaryCanonical, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
}
