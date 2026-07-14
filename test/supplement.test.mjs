import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importLegacy } from "../scripts/lib/importer.mjs";
import { importSupplement } from "../scripts/lib/supplement-importer.mjs";
import { generateSupplementIndex } from "../scripts/lib/supplement-index.mjs";
import { classifyChapterOverlay } from "../scripts/lib/supplement-overlay.mjs";
import { validateSupplement } from "../scripts/lib/supplement-validator.mjs";
import { validateSchema } from "../scripts/lib/json-schema.mjs";
import { mergeSupplementSearchShard } from "../src/supplements.js";

const fixture = path.resolve("fixtures/legacy");
const schemas = path.resolve("schemas");

async function supplementInput(root, { partialGroup = false } = {}) {
  const input = path.join(root, partialGroup ? "partial" : "supplement");
  await mkdir(input, { recursive: true });
  const index = JSON.parse(await readFile(path.join(fixture, "titles_index.json"), "utf8"));
  index.source = {
    ...index.source,
    kind: "supplement",
    supplement_year: 2026,
    titles_url: "https://www.cga.ct.gov/2026/sup/titles.htm",
    generated_at_utc: "2026-08-01T00:00:00Z"
  };
  const title = JSON.parse(await readFile(path.join(fixture, "title_01.json"), "utf8"));
  title.url = "https://www.cga.ct.gov/2026/sup/title_01.htm";
  title.supplement_year = 2026;
  title.chapters = [title.chapters[0]];
  const replacement = structuredClone(title.chapters[0].sections[0]);
  replacement.url = "https://www.cga.ct.gov/2026/sup/chap_001.htm#sec_1-1";
  replacement.content.body_paragraphs = ["Supplement replacement text."];
  replacement.content.text = "Supplement replacement text.";
  if (partialGroup) {
    replacement.section_key = "1-1o";
    replacement.section_keys = ["1-1o"];
    replacement.grouped = false;
    replacement.label = "Sec. 1-1o. Partial grouped replacement.";
  }
  const addition = structuredClone(replacement);
  addition.section_key = "1-99";
  addition.section_keys = ["1-99"];
  addition.grouped = false;
  addition.label = "Sec. 1-99. New supplement provision.";
  addition.url = "https://www.cga.ct.gov/2026/sup/chap_001.htm#sec_1-99";
  title.chapters[0].sections = partialGroup ? [replacement] : [replacement, addition];
  await writeFile(path.join(input, "titles_index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await writeFile(path.join(input, "title_01.json"), `${JSON.stringify(title, null, 2)}\n`, "utf8");
  return input;
}

test("imports supplements as year-scoped non-destructive citation overlays", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-supplement-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = path.join(root, "base");
  const output = path.join(root, "supplements", "2026");
  await importLegacy({ inputDir: fixture, outputDir: base, generatedAt: "2026-07-14T00:00:00Z" });
  const baseChapterBefore = await readFile(path.join(base, "chapters", "001.json"), "utf8");

  const result = await importSupplement({
    inputDir: await supplementInput(root),
    outputDir: output,
    baseDataDir: base,
    editionYear: 2026,
    generatedAt: "2026-08-01T00:00:00Z"
  });
  assert.deepEqual(
    { editionYear: result.editionYear, replacements: result.replacements, additions: result.additions },
    { editionYear: 2026, replacements: 1, additions: 1 }
  );
  assert.equal(await readFile(path.join(base, "chapters", "001.json"), "utf8"), baseChapterBefore);

  const validation = await validateSupplement({ supplementDir: output, baseDataDir: base, schemaDir: schemas });
  assert.deepEqual(validation.errors, []);
  const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.strategy, "replace-by-citation");
  assert.equal(manifest.counts.sections, 2);
  assert.equal(manifest.titles[0].searchPath, "search/title-01.json");
  const search = JSON.parse(await readFile(path.join(output, "search", "title-01.json"), "utf8"));
  assert.deepEqual(search.removedDocumentIds, ["section-1-1"]);
  assert.equal(search.documents.find((document) => document.id === "section-1-1").supplement.presentation, "amended");
  assert.equal(search.documents.find((document) => document.id === "section-1-99").supplement.presentation, "new");
  assert.deepEqual(search.documents.map((document) => document.id), ["section-1-1", "section-1-99"]);
  const baseSearch = JSON.parse(await readFile(path.join(base, "search", "title-01.json"), "utf8"));
  const mergedSearch = mergeSupplementSearchShard(baseSearch, search);
  assert.equal(mergedSearch.documents.find((document) => document.id === "section-1-1").text, "Supplement replacement text.");
  assert.ok(mergedSearch.documents.some((document) => document.id === "section-1-99"));

  const index = await generateSupplementIndex({
    supplementsDir: path.join(root, "supplements"),
    outputDir: path.join(root, "dist-supplements"),
    generatedAt: "2026-07-14T00:00:00Z"
  });
  const indexSchema = JSON.parse(await readFile(path.join(schemas, "supplement-index.schema.json"), "utf8"));
  assert.deepEqual(validateSchema(index, indexSchema), []);
  assert.equal(index.editions[0].path, "2026/manifest.json");

  await writeFile(path.join(base, "manifest.json"), `${await readFile(path.join(base, "manifest.json"), "utf8")}\n`, "utf8");
  const stale = await validateSupplement({ supplementDir: output, baseDataDir: base, schemaDir: schemas });
  assert.match(stale.errors.join("\n"), /base corpus identity does not match/);
});

test("rejects partial overlays of grouped base provisions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-supplement-group-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = path.join(root, "base");
  await importLegacy({ inputDir: fixture, outputDir: base, generatedAt: "2026-07-14T00:00:00Z" });
  const baseChapterPath = path.join(base, "chapters", "001.json");
  const baseChapter = JSON.parse(await readFile(baseChapterPath, "utf8"));
  const groupedProvision = baseChapter.sections.find((section) => section.citations?.includes("1-1o"));
  groupedProvision.status = "active";
  groupedProvision.content = {
    body: ["Substantive grouped provision text."],
    plainText: "Substantive grouped provision text."
  };
  await writeFile(baseChapterPath, `${JSON.stringify(baseChapter, null, 2)}\n`, "utf8");
  const input = await supplementInput(root, { partialGroup: true });
  await assert.rejects(() => importSupplement({
    inputDir: input,
    outputDir: path.join(root, "overlay"),
    baseDataDir: base,
    editionYear: 2026,
    generatedAt: "2026-08-01T00:00:00Z"
  }), /partial grouped-provision overlays are ambiguous/);
});

test("classifies a new provision carved from a reserved grouped placeholder", () => {
  const baseChapter = {
    id: "chapter-050",
    sections: [{
      id: "group-4-66i-to-4-66j",
      kind: "group",
      citations: ["4-66i", "4-66j"],
      status: "reserved",
      content: { body: ["Reserved for future use."], plainText: "Reserved for future use." }
    }]
  };
  const overlayChapter = {
    id: "chapter-050",
    sections: [{ id: "section-4-66i", citation: "4-66i", citations: ["4-66i"] }]
  };
  assert.deepEqual(classifyChapterOverlay(overlayChapter, baseChapter), { replacements: 1, additions: 0 });
});

test("classifies an exact provision despite an overlapping reserved placeholder", () => {
  const baseChapter = {
    id: "chapter-145",
    sections: [
      { id: "section-9-163k", kind: "section", citation: "9-163k", citations: ["9-163k"] },
      {
        id: "group-9-163-to-9-163z",
        kind: "group",
        citations: ["9-163", "9-163k", "9-163l"],
        status: "reserved",
        content: { body: ["Reserved for future use."], plainText: "Reserved for future use." }
      }
    ]
  };
  const overlayChapter = {
    id: "chapter-145",
    sections: [{ id: "section-9-163k", citation: "9-163k", citations: ["9-163k"] }]
  };
  assert.deepEqual(classifyChapterOverlay(overlayChapter, baseChapter), { replacements: 1, additions: 0 });
});

test("classifies a grouped overlay that exactly spans standalone base provisions", () => {
  const baseChapter = {
    id: "chapter-184c",
    sections: [
      { id: "section-10-511", citation: "10-511", citations: ["10-511"] },
      { id: "section-10-511a", citation: "10-511a", citations: ["10-511a"] }
    ]
  };
  const overlayChapter = {
    id: "chapter-184c",
    sections: [{ id: "group-10-511-to-10-511a", citations: ["10-511", "10-511a"] }]
  };
  assert.deepEqual(classifyChapterOverlay(overlayChapter, baseChapter), { replacements: 1, additions: 0 });
});
