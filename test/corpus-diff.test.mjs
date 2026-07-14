import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diffCorpora, renderDiffMarkdown } from "../scripts/lib/corpus-diff.mjs";
import { importLegacy } from "../scripts/lib/importer.mjs";

test("reports additions, removals, content changes, and status transitions", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-diff-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  await importLegacy({ inputDir: path.resolve("fixtures/legacy"), outputDir: before });
  await cp(before, after, { recursive: true });

  const chapterFile = path.join(after, "chapters", "001.json");
  const chapter = JSON.parse(await readFile(chapterFile, "utf8"));
  const changed = chapter.sections[0];
  changed.status = "repealed";
  changed.content.plainText = "Changed statutory text.";
  chapter.sections.splice(1, 1);
  chapter.sections.push({
    id: "section-1-2",
    kind: "section",
    citation: "1-2",
    citations: ["1-2"],
    heading: "Sec. 1-2. New provision.",
    sourceUrl: "https://www.cga.ct.gov/current/pub/chap_001.htm#sec_1-2",
    status: "active",
    content: { body: ["New."], sourceNotes: [], history: [], annotations: [], plainText: "New." }
  });
  await writeFile(chapterFile, `${JSON.stringify(chapter, null, 2)}\n`);

  const report = await diffCorpora({ beforeDir: before, afterDir: after });
  assert.deepEqual(report.summary, {
    titlesAdded: 0,
    titlesRemoved: 0,
    titlesChanged: 0,
    chaptersAdded: 0,
    chaptersRemoved: 0,
    chaptersChanged: 0,
    added: 1,
    removed: 1,
    changed: 1,
    statusTransitions: 1
  });
  assert.equal(report.added[0].citation, "1-2");
  assert.equal(report.removed[0].citations[0], "1-1o");
  assert.deepEqual(report.changed[0].changes, ["status", "content"]);
  assert.deepEqual(report.statusTransitions[0], {
    key: "citation:1-1",
    citation: "1-1",
    heading: "Sec. 1-1. Words and phrases. Construction of statutes.",
    from: "active",
    to: "repealed"
  });
  assert.match(renderDiffMarkdown(report), /1-1 — active → repealed/);
});

test("reports chapter moves as changes instead of remove-and-add pairs", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-move-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  await importLegacy({ inputDir: path.resolve("fixtures/legacy"), outputDir: before });
  await cp(before, after, { recursive: true });
  const firstFile = path.join(after, "chapters", "001.json");
  const secondFile = path.join(after, "chapters", "002.json");
  const first = JSON.parse(await readFile(firstFile, "utf8"));
  const second = JSON.parse(await readFile(secondFile, "utf8"));
  const [moved] = first.sections.splice(0, 1);
  second.sections.push(moved);
  await writeFile(firstFile, `${JSON.stringify(first, null, 2)}\n`);
  await writeFile(secondFile, `${JSON.stringify(second, null, 2)}\n`);

  const report = await diffCorpora({ beforeDir: before, afterDir: after });
  assert.equal(report.summary.added, 0);
  assert.equal(report.summary.removed, 0);
  assert.deepEqual(report.changed.find((entry) => entry.key === "citation:1-1").changes, ["location"]);
});

test("can limit a shadow comparison to selected title IDs", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-filter-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  await importLegacy({ inputDir: path.resolve("fixtures/legacy"), outputDir: before });
  await cp(before, after, { recursive: true });
  const report = await diffCorpora({ beforeDir: before, afterDir: after, titleIds: ["title-99"] });
  assert.deepEqual(report.summary, {
    titlesAdded: 0,
    titlesRemoved: 0,
    titlesChanged: 0,
    chaptersAdded: 0,
    chaptersRemoved: 0,
    chaptersChanged: 0,
    added: 0,
    removed: 0,
    changed: 0,
    statusTransitions: 0
  });
  assert.equal(report.before.counts.provisionsRead, 0);
});

test("reports title and chapter metadata changes", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-structure-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  await importLegacy({ inputDir: path.resolve("fixtures/legacy"), outputDir: before });
  await cp(before, after, { recursive: true });

  const catalogFile = path.join(after, "catalog.json");
  const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  catalog.titles[0].name = "Updated title name";
  catalog.titles[0].chapters[0].name = "Updated chapter name";
  await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);

  const report = await diffCorpora({ beforeDir: before, afterDir: after });
  assert.equal(report.summary.titlesChanged, 1);
  assert.equal(report.summary.chaptersChanged, 1);
  assert.deepEqual(report.structure.titles.changed[0].changes, ["name"]);
  assert.deepEqual(report.structure.chapters.changed[0].changes, ["name"]);
  assert.match(renderDiffMarkdown(report), /Titles changed/);
  assert.match(renderDiffMarkdown(report), /Chapters changed/);
});
