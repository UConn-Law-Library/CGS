import assert from "node:assert/strict";
import test from "node:test";
import { applyPreferences, DeviceState } from "../src/device-state.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
}

function failingStorage() {
  return {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
}

test("stores and removes device-local bookmarks", () => {
  const state = new DeviceState({ storage: memoryStorage() });
  const bookmark = { id: "statute:1-1", type: "statute", title: "Sec. 1-1", href: "#/t/1/c/1/s/1-1" };
  assert.equal(state.toggleBookmark(bookmark), true);
  assert.equal(state.isBookmarked(bookmark.id), true);
  assert.equal(state.toggleBookmark(bookmark), false);
  assert.deepEqual(state.bookmarks(), []);
});

test("normalizes and applies reader preferences", () => {
  const state = new DeviceState({ storage: memoryStorage() });
  const preferences = state.updatePreferences({
    theme: "oled",
    textScale: 4,
    compactLists: true,
    hideRepealedSections: true
  });
  assert.deepEqual(preferences, {
    theme: "oled",
    textScale: 1.25,
    compactLists: true,
    hideRepealedSections: true
  });
  const style = { values: new Map(), setProperty(key, value) { this.values.set(key, value); } };
  const root = { dataset: {}, style };
  applyPreferences(preferences, root);
  assert.equal(root.dataset.theme, "oled");
  assert.equal(root.dataset.compactLists, "true");
  assert.equal(root.dataset.hideRepealedSections, "true");
  assert.equal(style.values.get("--text-scale"), "1.25");
});

test("uses compact lists by default while preserving an explicit comfortable preference", () => {
  const storage = memoryStorage();
  const state = new DeviceState({ storage });
  assert.equal(state.preferences().compactLists, true);
  state.updatePreferences({ compactLists: false });
  assert.equal(state.preferences().compactLists, false);
});

test("deduplicates, orders, limits, and clears recent items", () => {
  const state = new DeviceState({ storage: memoryStorage() });
  for (let index = 0; index < 22; index += 1) {
    state.recordRecent({
      id: `statute:${index}`,
      type: "statute",
      title: `Sec. ${index}`,
      href: `#/section/${index}`,
      viewedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
    });
  }
  assert.equal(state.recents().length, 20);
  assert.equal(state.recents()[0].id, "statute:21");
  state.recordRecent({
    id: "statute:10",
    type: "statute",
    title: "Sec. 10 updated",
    href: "#/section/10",
    viewedAt: "2026-12-31T00:00:00.000Z"
  });
  assert.equal(state.recents()[0].title, "Sec. 10 updated");
  assert.equal(state.recents().filter((item) => item.id === "statute:10").length, 1);
  state.clearRecents();
  assert.deepEqual(state.recents(), []);
});

test("deduplicates, orders, limits, and clears device-local search history", () => {
  const state = new DeviceState({ storage: memoryStorage() });
  for (let index = 0; index < 22; index += 1) {
    state.recordSearch({
      query: `query ${index}`,
      description: `Search ${index}`,
      href: `#/search?q=query%20${index}`,
      searchedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
    });
  }
  assert.equal(state.searchHistory().length, 20);
  assert.equal(state.searchHistory()[0].query, "query 21");
  state.recordSearch({ query: "query 10 updated", href: "#/search?q=query%2010", searchedAt: "2026-12-31T00:00:00.000Z" });
  assert.equal(state.searchHistory()[0].query, "query 10 updated");
  assert.equal(state.searchHistory().filter((item) => item.href === "#/search?q=query%2010").length, 1);
  state.clearSearchHistory();
  assert.deepEqual(state.searchHistory(), []);
});

test("storage failures remain non-fatal for preferences, bookmarks, recents, and search history", () => {
  const state = new DeviceState({ storage: failingStorage() });
  assert.equal(state.preferences().compactLists, true);
  assert.deepEqual(state.bookmarks(), []);
  assert.equal(state.recordRecent({ id: "x", type: "statute", title: "X", href: "#/x" }).length, 1);
  assert.deepEqual(state.recents(), []);
  assert.doesNotThrow(() => state.clearRecents());
  assert.equal(state.recordSearch({ query: "public", href: "#/search?q=public" }).length, 1);
  assert.deepEqual(state.searchHistory(), []);
  assert.doesNotThrow(() => state.clearSearchHistory());
});
