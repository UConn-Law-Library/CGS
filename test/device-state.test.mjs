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
