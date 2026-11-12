import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyPreviewNamespace, applyPreviewNoindex } from "../scripts/lib/preview-build.mjs";

async function fixture(t, sourceDirectory = "src") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cgs-preview-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ["device-state.js", "service-worker.js"]) {
    await writeFile(path.join(directory, file), await readFile(path.join(sourceDirectory, file), "utf8"), "utf8");
  }
  return directory;
}

test("the preview build keeps its browser storage apart from production", async (t) => {
  const directory = await fixture(t);
  await applyPreviewNamespace(directory);
  const deviceState = await readFile(path.join(directory, "device-state.js"), "utf8");
  const worker = await readFile(path.join(directory, "service-worker.js"), "utf8");
  assert.match(deviceState, /BOOKMARKS_KEY = "cgs-preview\.bookmarks\.v1"/);
  assert.match(deviceState, /PREFERENCES_KEY = "cgs-preview\.preferences\.v1"/);
  assert.doesNotMatch(deviceState, /"cgs\./);
  assert.match(worker, /OFFLINE_CACHE_PREFIX = "cgs-preview-data-offline-"/);
  assert.doesNotMatch(worker, /"cgs-data-/);
});

test("the preview build starts visitors on page tree navigation", async (t) => {
  const directory = await fixture(t);
  await applyPreviewNamespace(directory);
  const deviceState = await readFile(path.join(directory, "device-state.js"), "utf8");
  assert.match(deviceState, /^\s*navigationTree: true,$/m);
  assert.match(await readFile("src/device-state.js", "utf8"), /^\s*navigationTree: false,$/m);
});

test("the preview build fails when a storage name it expects has changed", async (t) => {
  const directory = await fixture(t);
  const target = path.join(directory, "device-state.js");
  await writeFile(target, (await readFile(target, "utf8")).replace('"cgs.bookmarks.v1"', '"renamed.bookmarks.v1"'), "utf8");
  await assert.rejects(applyPreviewNamespace(directory), /Expected 6 browser storage names in device-state\.js, found 5/);
});

test("the preview build marks every page noindex, once", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cgs-preview-noindex-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "commit-feed"), { recursive: true });
  await writeFile(path.join(directory, "index.html"), await readFile("src/index.html", "utf8"), "utf8");
  await writeFile(path.join(directory, "404.html"), await readFile("src/404.html", "utf8"), "utf8");
  await writeFile(path.join(directory, "commit-feed", "index.html"), await readFile("public/commit-feed/index.html", "utf8"), "utf8");
  assert.equal(await applyPreviewNoindex(directory), 3);
  assert.equal(await applyPreviewNoindex(directory), 0);
  for (const file of ["index.html", "404.html", "commit-feed/index.html"]) {
    const html = await readFile(path.join(directory, file), "utf8");
    assert.equal(html.match(/<meta name="robots" content="noindex">/g)?.length, 1, file);
  }
  assert.doesNotMatch(await readFile("src/index.html", "utf8"), /noindex/);
});
