import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("home statute browsing uses the application route instead of an unknown hash route", () => {
  assert.match(appSource, /<a href="#\/" data-browse-statutes>/);
  assert.doesNotMatch(appSource, /href="#browse-titles"/);
});

test("index letters render continuous topic groups and chapter settings expose repealed filtering", () => {
  assert.match(appSource, /topics\.map\(renderIndexTopic\)/);
  assert.match(appSource, /data-hide-repealed/);
  assert.match(appSource, /class="section-status-pill">Repealed/);
});
