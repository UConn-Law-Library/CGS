import assert from "node:assert/strict";
import test from "node:test";
import { retryableLoader } from "../src/data-loader.js";
import { DeviceState } from "../src/device-state.js";
import { QuickSearchRepository } from "../src/quick-search.js";
import { ProgressiveSearchClient } from "../src/search-client.js";

test("catalog requests share a failure and retry once successfully", async () => {
  let requests = 0;
  const load = retryableLoader(() => { if (++requests === 1) throw new Error("503"); return { titles: [] }; });
  const first = load();
  assert.equal(load(), first);
  await assert.rejects(first, /503/);
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(a, b);
  assert.equal(requests, 2);
});

const bookmark = { id: "statute:1-1", type: "statute", title: "Sec. 1-1", href: "#/t/01/c/001/s/1-1" };
test("failed bookmark writes retain an exportable temporary copy and can recover", () => {
  const values = new Map();
  let blocked = true;
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => { if (blocked) throw Error("full"); values.set(key, value); } };
  const state = new DeviceState({ storage });
  assert.deepEqual(state.toggleBookmark(bookmark), { saved: true, persisted: false });
  assert.equal(state.isBookmarked(bookmark.id), true);
  assert.equal(new DeviceState({ storage }).bookmarks().length, 0);
  const backup = state.exportBookmarks();
  blocked = false;
  assert.deepEqual(state.importBookmarks(backup), { added: 0, persisted: true });
  assert.deepEqual(new DeviceState({ storage }).bookmarks(), [bookmark]);
  assert.equal(state.removeBookmark(bookmark.id), true);
  assert.deepEqual(state.importBookmarks(backup), { added: 1, persisted: true });
  const malicious = JSON.stringify({ format: "cgs-bookmarks", version: 1, bookmarks: [{ ...bookmark, href: "javascript:alert(1)" }] });
  assert.throws(() => state.importBookmarks(malicious), /supported CGS/);
  assert.equal(state.bookmarks().length, 1, "invalid imports leave existing bookmarks intact");
});

test("autocomplete resolves exact citations without reading body or heading shards", async () => {
  const quick = new QuickSearchRepository({ loadCitations: async (id) => {
    assert.equal(id, "title-01"); return { "1-1": ["001", "1-1"] };
  } });
  const results = await quick.search("§ 1-1", { titles: [{ id: "title-01", number: "01" }] });
  assert.equal(results[0].href, "#/t/01/c/001/s/1-1");
});

test("additional result batches reuse the completed search and changed queries rescan", async () => {
  let scans = 0;
  const repository = {
    init: async () => ({ shards: [{ titleId: "title-01" }] }),
    async loadTitles(ids, { onTitle }) {
      scans++;
      onTitle({ title: { number: "01" }, documents: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, citations: [`1-${i}`], heading: "Public records", text: "public records", chapter: { number: "001" } })) }, { completed: 1, total: 1 });
    }
  };
  const client = new ProgressiveSearchClient({ repository, workerFactory: () => null });
  assert.equal((await client.search("public", { limit: 1 })).results.length, 1);
  assert.equal((await client.search("public", { limit: 4 })).results.length, 4);
  assert.equal(scans, 1);
  await client.search("records");
  assert.equal(scans, 2);
});
