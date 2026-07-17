import assert from "node:assert/strict";
import test from "node:test";
import { applyChapterOverlay, mergeSupplementSearchShard, mergeSupplementTitleChapters, SupplementRepository } from "../src/supplements.js";

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
  assert.deepEqual(result.overlay.changes.map(({ sectionId, kind, presentation }) => ({ sectionId, kind, presentation })), [
    { sectionId: "section-1-1", kind: "replacement", presentation: "amended" },
    { sectionId: "section-1-2", kind: "addition", presentation: "new" }
  ]);
  assert.deepEqual(result.overlay.changes[0].previousSections, [baseChapter.sections[0]]);
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

test("splits a reserved grouped placeholder when a supplement fills one citation", () => {
  const reservedBase = {
    id: "chapter-050",
    sections: [{
      id: "group-4-66i-to-4-66j",
      kind: "group",
      citation: null,
      citations: ["4-66i", "4-66j"],
      heading: "Secs. 4-66i and 4-66j.",
      status: "reserved",
      content: {
        body: ["Reserved for future use.", "Note: The following chapter is also reserved."],
        plainText: "Reserved for future use.\n\nNote: The following chapter is also reserved."
      }
    }]
  };
  const supplement = {
    id: "chapter-050",
    sourceUrl: "https://example.test/2026/supplement",
    sections: [{ id: "section-4-66i", kind: "section", citation: "4-66i", citations: ["4-66i"] }]
  };
  const result = applyChapterOverlay(reservedBase, supplement, 2026);
  assert.deepEqual(result.chapter.sections.map((section) => section.citations), [["4-66i"], ["4-66j"]]);
  assert.equal(result.chapter.sections[1].heading, "Sec. 4-66j. Reserved for future use.");
  assert.equal(result.overlay.changes[0].presentation, "new");
  assert.deepEqual(result.overlay.changes[0].previousSections, [reservedBase.sections[0]]);
});

test("prefers an exact provision over an overlapping reserved placeholder", () => {
  const exact = { id: "section-9-163k", kind: "section", citation: "9-163k", citations: ["9-163k"] };
  const reserved = {
    id: "group-9-163-to-9-163z",
    kind: "group",
    citation: null,
    citations: ["9-163", "9-163k", "9-163l"],
    status: "reserved",
    content: { body: ["Reserved for future use."], plainText: "Reserved for future use." }
  };
  const replacement = { ...exact, content: { plainText: "Updated text." } };
  const result = applyChapterOverlay(
    { id: "chapter-145", sections: [exact, reserved] },
    { id: "chapter-145", sections: [replacement] },
    2026
  );
  assert.equal(result.chapter.sections.filter((section) => section.citations.includes("9-163k")).length, 1);
  assert.deepEqual(result.chapter.sections.find((section) => section.status === "reserved").citations, ["9-163", "9-163l"]);
  assert.equal(result.overlay.changes[0].presentation, "amended");
  assert.deepEqual(result.overlay.changes[0].previousSections, [exact]);
});

test("replaces complete standalone provisions with one grouped supplement provision", () => {
  const base = {
    id: "chapter-184c",
    sections: [
      { id: "section-10-511", citation: "10-511", citations: ["10-511"] },
      { id: "section-10-511a", citation: "10-511a", citations: ["10-511a"] }
    ]
  };
  const grouped = {
    id: "group-10-511-to-10-511a",
    kind: "group",
    citation: null,
    citations: ["10-511", "10-511a"],
    status: "repealed"
  };
  const result = applyChapterOverlay(base, { id: "chapter-184c", sections: [grouped] }, 2026);
  assert.deepEqual(result.chapter.sections, [grouped]);
  assert.equal(result.overlay.changes[0].presentation, "repealed");
  assert.deepEqual(result.overlay.changes[0].previousSections, base.sections);
});

test("removes superseded search documents and adds the supplement delta", () => {
  const base = {
    title: { id: "title-01" },
    documents: [
      { id: "old", chapter: { id: "chapter-001" } },
      { id: "untouched", chapter: { id: "chapter-002" } }
    ]
  };
  const merged = mergeSupplementSearchShard(base, {
    title: { id: "title-01" },
    removedDocumentIds: ["old"],
    documents: [{ id: "current", chapter: { id: "chapter-001" }, supplement: { editionYear: 2026, presentation: "amended" } }]
  });
  assert.deepEqual(merged.documents.map((document) => document.id), ["untouched", "current"]);
});

test("discovers supplement editions and resolves their chapter artifacts", async () => {
  const responses = new Map([
    ["https://example.test/data/supplements/manifest.json", { editions: [{ editionYear: 2026, path: "2026/manifest.json" }] }],
    ["https://example.test/data/supplements/2026/manifest.json", { titles: [{ id: "title-01", searchPath: "search/title-01.json", chapters: [{ number: "001", path: "chapters/001.json" }] }] }],
    ["https://example.test/data/supplements/2026/chapters/001.json", overlayChapter],
    ["https://example.test/data/supplements/2026/search/title-01.json", { title: { id: "title-01" }, documents: [] }]
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
  assert.equal((await repository.loadLatestChapter("001")).edition.editionYear, 2026);
  assert.equal((await repository.loadLatestSearchTitle("title-01")).title.id, "title-01");
});

test("adds supplement-only chapters to title navigation and scopes their lookup", async () => {
  const supplementChapter = { ...overlayChapter, id: "chapter-art-012a", number: "art-012a" };
  const responses = new Map([
    ["https://example.test/data/supplements/manifest.json", { editions: [{ editionYear: 2026, path: "2026/manifest.json" }] }],
    ["https://example.test/data/supplements/2026/manifest.json", {
      titles: [{ id: "title-42a", chapters: [{ id: "chapter-art-012a", number: "art-012a", name: "Transition", path: "chapters/art-012a.json", sectionCount: 1 }] }]
    }],
    ["https://example.test/data/supplements/2026/chapters/art-012a.json", supplementChapter]
  ]);
  const repository = new SupplementRepository({
    baseUrl: "https://example.test/data/supplements/",
    fetchImpl(url) {
      return Promise.resolve({ ok: responses.has(url.href), status: responses.has(url.href) ? 200 : 404, json: () => Promise.resolve(responses.get(url.href)) });
    }
  });
  const latest = await repository.loadLatestTitle("title-42a");
  const title = mergeSupplementTitleChapters(
    { id: "title-42a", chapters: [{ id: "chapter-art-010", number: "art-010" }] },
    latest.title,
    latest.edition.editionYear
  );
  assert.deepEqual(title.chapters.map((chapter) => chapter.number), ["art-010", "art-012a"]);
  assert.equal(title.chapters[1].supplementOnly, true);
  assert.equal((await repository.loadLatestChapter("art-012a", "title-42a")).chapter.id, "chapter-art-012a");
  assert.equal((await repository.loadLatestChapter("art-012a", "title-01")).chapter, null);
});
