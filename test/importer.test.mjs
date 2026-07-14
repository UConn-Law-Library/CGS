import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importLegacy } from "../scripts/lib/importer.mjs";

const fixture = path.resolve("fixtures/legacy");

test("imports legacy titles into deterministic chapter artifacts", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-import-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "data");

  const result = await importLegacy({ inputDir: fixture, outputDir: output });
  assert.deepEqual(
    { titles: result.titles, chapters: result.chapters, sections: result.sections },
    { titles: 1, chapters: 2, sections: 4 }
  );

  const chapter = JSON.parse(await readFile(path.join(output, "chapters", "001.json"), "utf8"));
  assert.equal(chapter.id, "chapter-001");
  assert.equal(chapter.sections[0].id, "section-1-1");
  assert.deepEqual(chapter.sections[1], {
    id: "group-1-1o-to-1-1p-to-1-1q-to-1-1r-to-1-1s",
    kind: "group",
    citation: null,
    citations: ["1-1o", "1-1p", "1-1q", "1-1r", "1-1s"],
    heading: "Secs. 1-1o to 1-1s.",
    sourceUrl: "https://www.cga.ct.gov/current/pub/chap_001.htm#secs_1-1o_to_1-1s",
    status: "reserved",
    content: {
      body: ["Reserved for future use."],
      sourceNotes: [],
      history: [],
      annotations: [],
      plainText: "Reserved for future use."
    }
  });
});

test("produces byte-identical output for the same timestamp", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-repeat-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  await importLegacy({ inputDir: fixture, outputDir: first, generatedAt: "2026-01-01T00:00:00Z" });
  await importLegacy({ inputDir: fixture, outputDir: second, generatedAt: "2026-01-01T00:00:00Z" });
  assert.equal(await readFile(path.join(first, "manifest.json"), "utf8"), await readFile(path.join(second, "manifest.json"), "utf8"));
});

test("refuses to overwrite its input directory", async () => {
  await assert.rejects(() => importLegacy({ inputDir: fixture, outputDir: fixture }), /cannot be the input directory/);
});
