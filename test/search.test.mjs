import assert from "node:assert/strict";
import test from "node:test";
import { normalizeText, scoreDocument, searchDocuments, tokenize } from "../src/search.js";

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
