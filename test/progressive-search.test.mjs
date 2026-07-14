import assert from "node:assert/strict";
import test from "node:test";
import { ProgressiveSearchClient } from "../src/search-client.js";
import { mergeSearchResults, searchDocuments } from "../src/search.js";
import { addShardToSearch, createSearchState, searchUpdate } from "../src/search-worker.js";

function shard(number, documents) {
  return {
    title: { id: `title-${number}`, number, name: `Title ${number}` },
    documents
  };
}

function document(id, citation, text, chapter = "001") {
  return {
    id,
    citation,
    citations: [citation],
    chapter: { number: chapter },
    heading: `Sec. ${citation}. Public records.`,
    status: "active",
    text
  };
}

test("merges independently ranked shard results into a deterministic global limit", () => {
  const first = searchDocuments([
    { ...document("a", "1-1", "public records"), title: { number: "01" } },
    { ...document("b", "1-2", "public records requests"), title: { number: "01" } }
  ], "public records");
  const second = searchDocuments([
    { ...document("c", "7-1", "public records"), title: { number: "07" } }
  ], "public records");

  assert.deepEqual(
    mergeSearchResults(first, second, { limit: 2 }).map((result) => result.document.id),
    ["a", "b"]
  );
});

test("worker search state emits progressive, title-annotated results", () => {
  const state = createSearchState({ query: "public records", limit: 5, total: 2 });
  addShardToSearch(state, shard("01", [document("a", "1-1", "public records access")]));
  const first = searchUpdate(9, state);
  assert.equal(first.type, "progress");
  assert.equal(first.processed, 1);
  assert.equal(first.results[0].document.title.number, "01");

  addShardToSearch(state, shard("07", [document("b", "7-1", "public records commission")]));
  const complete = searchUpdate(9, state, true);
  assert.equal(complete.type, "complete");
  assert.equal(complete.processed, 2);
  assert.equal(complete.results.length, 2);
});

test("progressive client streams each loaded shard and falls back inline without Worker", async () => {
  const shards = new Map([
    ["title-01", shard("01", [document("a", "1-1", "public records access")])],
    ["title-07", shard("07", [document("b", "7-1", "public records commission")])]
  ]);
  const repository = {
    async init() {
      return { shards: [...shards.keys()].map((titleId) => ({ titleId })) };
    },
    async loadTitles(ids, { onTitle, signal }) {
      let completed = 0;
      for (const id of ids) {
        if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
        completed += 1;
        await onTitle(shards.get(id), { completed, total: ids.length, titleId: id });
      }
      return { completed, total: ids.length };
    }
  };
  const updates = [];
  const client = new ProgressiveSearchClient({ repository, workerFactory: () => null });
  const results = await client.search("public records", { onProgress: (update) => updates.push(update) });

  assert.equal(results.length, 2);
  assert.deepEqual(updates.map((update) => [update.completed, update.complete]), [[1, false], [2, false], [2, true]]);
  assert.deepEqual(new Set(results.map((result) => result.document.title.number)), new Set(["01", "07"]));
});

test("progressive client rejects an already-cancelled search before loading shards", async () => {
  const controller = new AbortController();
  controller.abort();
  const repository = {
    init() {
      throw new Error("should not initialize");
    }
  };
  const client = new ProgressiveSearchClient({ repository, workerFactory: () => null });
  await assert.rejects(client.search("records", { signal: controller.signal }), { name: "AbortError" });
});
