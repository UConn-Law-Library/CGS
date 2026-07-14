import assert from "node:assert/strict";
import test from "node:test";
import { applyChapterOverlay, SupplementRepository } from "../src/supplements.js";

const baseChapter = {
  id: "chapter-001",
  sourceUrl: "https://example.test/current",
  sections: [
    { id: "section-1-1", citation: "1-1", citations: ["1-1"] },
    { id: "section-1-3", citation: "1-3", citations: ["1-3"] }
  ]
};
const overlayChapter = {
  id: "chapter-001",
  sourceUrl: "https://example.test/2026/supplement",
  sections: [
    { id: "section-1-1", citation: "1-1", citations: ["1-1"], text: "replacement" },
    { id: "section-1-2", citation: "1-2", citations: ["1-2"], text: "addition" }
  ]
};

test("applies a selected supplement without mutating the base chapter", () => {
  const result = applyChapterOverlay(baseChapter, overlayChapter, 2026);
  assert.deepEqual(result.chapter.sections.map((section) => section.citation), ["1-1", "1-2", "1-3"]);
  assert.equal(result.chapter.sections[0].text, "replacement");
  assert.deepEqual(result.overlay.changes, [
    { sectionId: "section-1-1", kind: "replacement" },
    { sectionId: "section-1-2", kind: "addition" }
  ]);
  assert.equal(baseChapter.sections.length, 2);
});

test("treats every provision in a new supplement chapter as an addition", () => {
  const result = applyChapterOverlay(null, overlayChapter, 2026);
  assert.equal(result.chapter.id, "chapter-001");
  assert.deepEqual(result.overlay.changes.map((change) => change.kind), ["addition", "addition"]);
});

test("refuses a partial replacement of a grouped provision", () => {
  const groupedBase = {
    id: "chapter-001",
    sections: [{ id: "group-1-1-to-1-2", citation: "1-1", citations: ["1-1", "1-2"] }]
  };
  const partialOverlay = {
    id: "chapter-001",
    sourceUrl: "https://example.test/supplement",
    sections: [{ id: "section-1-1", citation: "1-1", citations: ["1-1"] }]
  };
  assert.throws(() => applyChapterOverlay(groupedBase, partialOverlay, 2026), /ambiguous/);
});

test("discovers supplement editions and resolves their chapter artifacts", async () => {
  const responses = new Map([
    ["https://example.test/data/supplements/manifest.json", { editions: [{ editionYear: 2026, path: "2026/manifest.json" }] }],
    ["https://example.test/data/supplements/2026/manifest.json", { titles: [{ chapters: [{ number: "001", path: "chapters/001.json" }] }] }],
    ["https://example.test/data/supplements/2026/chapters/001.json", overlayChapter]
  ]);
  const repository = new SupplementRepository({
    baseUrl: "https://example.test/data/supplements/",
    fetchImpl(url) {
      return Promise.resolve({ ok: responses.has(url.href), status: responses.has(url.href) ? 200 : 404, json: () => Promise.resolve(responses.get(url.href)) });
    }
  });
  assert.equal((await repository.init()).editions[0].editionYear, 2026);
  assert.equal((await repository.loadChapter(2026, "1")).id, "chapter-001");
  assert.equal(await repository.loadChapter(2026, "999"), null);
});
