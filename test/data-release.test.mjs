import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateDataRelease } from "../scripts/lib/data-release.mjs";

test("each independently updated dataset changes the release identity deterministically", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = ["catalog.json", "supplements/2026/manifest.json", "acts/amendments.json", "secondary/manifest.json", "search-v2/headings/title-01.json"];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "{}");
  }
  let release = await generateDataRelease(root);
  assert.deepEqual(await generateDataRelease(root), release);
  assert.equal(release.artifacts.length, files.length);
  for (const file of files) {
    await writeFile(path.join(root, file), '{"updated":true}');
    const next = await generateDataRelease(root);
    assert.notEqual(next.id, release.id, file);
    release = next;
  }
});
