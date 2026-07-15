import assert from "node:assert/strict";
import test from "node:test";
import { compileSearchQuery, normalizeText, scoreDocument, SearchRepository, searchDocuments, tokenize } from "../src/search.js";

const documents = [
  {
    id: "section-1-1",
    citation: "1-1",
    citations: ["1-1"],
    heading: "Sec. 1-1. Words and phrases. Construction of statutes.",
    status: "active",
    text: "Words and phrases use the commonly approved usage of the language."
  },
  {
    id: "section-1-5",
    citation: "1-5",
    citations: ["1-5"],
    heading: "Former emergency provision",
    status: "repealed",
    text: "Repealed."
  }
];

test("normalizes legal symbols and tokenizes citations", () => {
  assert.equal(normalizeText("§ 1-1 — Phráses"), "1-1 phrases");
  assert.deepEqual(tokenize("Sec. 1-1, public records"), ["sec", "1-1", "public", "records"]);
});

test("ranks an exact citation above body matches", () => {
  const citationScore = scoreDocument(documents[0], "1-1");
  const bodyScore = scoreDocument({ ...documents[0], citation: "2-2", citations: ["2-2"] }, "phrases");
  assert.ok(citationScore > bodyScore);
});

test("requires every query token and orders relevant results", () => {
  assert.deepEqual(searchDocuments(documents, "commonly language").map((result) => result.document.id), ["section-1-1"]);
  assert.deepEqual(searchDocuments(documents, "missing term"), []);
});

test("supports Boolean operators, quoted phrases, parentheses, and implicit AND", () => {
  const values = [
    { ...documents[0], id: "public-tax", heading: "Public tax records", text: "Commonly approved usage." },
    { ...documents[0], id: "public-meeting", heading: "Public meeting records", text: "Meeting notices." },
    { ...documents[0], id: "private-records", heading: "Private records", text: "Confidential tax material." }
  ];
  assert.deepEqual(
    new Set(searchDocuments(values, 'public AND (tax OR meeting) NOT private').map(({ document }) => document.id)),
    new Set(["public-tax", "public-meeting"])
  );
  assert.deepEqual(
    new Set(searchDocuments(values, '"commonly approved" OR private').map(({ document }) => document.id)),
    new Set(["public-tax", "private-records"])
  );
  assert.deepEqual(
    searchDocuments(values, "public tax").map(({ document }) => document.id),
    ["public-tax"]
  );
});

test("reports malformed Boolean expressions", () => {
  assert.throws(() => compileSearchQuery("public AND"), /missing a term/i);
  assert.throws(() => compileSearchQuery('"public records'), /unclosed quoted phrase/i);
  assert.throws(() => compileSearchQuery("public OR (records"), /unclosed parenthesis/i);
});

test("SearchRepository calls fetch with the global receiver", async () => {
  const repository = new SearchRepository({
    baseUrl: "https://example.test/data/search/",
    fetchImpl(url) {
      assert.equal(this, globalThis);
      assert.equal(url.href, "https://example.test/data/search/manifest.json");
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ shards: [] })
      });
    }
  });

  assert.deepEqual(await repository.init(), { shards: [] });
});

test("SearchRepository annotates results with their title for stable routes", async () => {
  const responses = new Map([
    ["https://example.test/data/search/manifest.json", { shards: [{ titleId: "title-01", path: "title-01.json" }] }],
    ["https://example.test/data/search/title-01.json", { title: { id: "title-01", number: "01", name: "General" }, documents }]
  ]);
  const repository = new SearchRepository({
    baseUrl: "https://example.test/data/search/",
    fetchImpl(url) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(responses.get(url.href)) });
    }
  });

  const [result] = await repository.search("1-1");
  assert.equal(result.document.title.number, "01");
});

test("SearchRepository automatically applies the latest supplement search patch", async () => {
  const responses = new Map([
    ["https://example.test/data/search/manifest.json", { shards: [{ titleId: "title-01", path: "title-01.json" }] }],
    ["https://example.test/data/search/title-01.json", {
      title: { id: "title-01", number: "01", name: "General" },
      documents: [
        { ...documents[0], chapter: { id: "chapter-001", number: "001" } },
        { ...documents[1], chapter: { id: "chapter-002", number: "002" } }
      ]
    }]
  ]);
  const repository = new SearchRepository({
    baseUrl: "https://example.test/data/search/",
    fetchImpl(url) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(responses.get(url.href)) });
    },
    supplementRepository: {
      async loadLatestSearchTitle() {
        return {
          title: { id: "title-01" },
          removedDocumentIds: ["section-1-1"],
          documents: [{ ...documents[0], text: "Current supplement language.", chapter: { id: "chapter-001", number: "001" }, supplement: { editionYear: 2026, presentation: "amended" } }]
        };
      }
    }
  });

  const shard = await repository.loadTitle("title-01");
  assert.deepEqual(shard.documents.map((document) => document.chapter.id), ["chapter-002", "chapter-001"]);
  assert.equal(shard.documents[1].supplement.editionYear, 2026);
});

test("SearchRepository preserves base search when supplement data is unavailable", async () => {
  const responses = new Map([
    ["https://example.test/data/search/manifest.json", { shards: [{ titleId: "title-01", path: "title-01.json" }] }],
    ["https://example.test/data/search/title-01.json", { title: { id: "title-01" }, documents }]
  ]);
  const repository = new SearchRepository({
    baseUrl: "https://example.test/data/search/",
    fetchImpl(url) {
      return Promise.resolve({ ok: responses.has(url.href), json: () => Promise.resolve(responses.get(url.href)) });
    },
    supplementRepository: {
      async loadLatestSearchTitle() {
        throw new Error("supplement unavailable");
      }
    }
  });

  const shard = await repository.loadTitle("title-01");
  assert.equal(shard.documents.length, documents.length);
  assert.equal(shard.supplementUnavailable, true);
});
