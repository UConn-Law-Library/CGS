import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stampServiceWorker } from "../scripts/lib/pwa-build.mjs";

test("stamps the deployed service worker with a deterministic shell fingerprint", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cgs-pwa-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "app.js"), "export const version = 1;", "utf8");
  await writeFile(path.join(directory, "service-worker.js"), `const BUILD_ID = "__CGS_BUILD_ID__";
const CORPUS_GENERATED_AT = "__CGS_CORPUS_GENERATED_AT__";
const CORPUS_SCHEMA_VERSION = "__CGS_CORPUS_SCHEMA_VERSION__";`, "utf8");

  const buildId = await stampServiceWorker(directory, ["app.js", "service-worker.js"], {
    corpusGeneratedAt: "2026-07-14T00:27:33Z",
    corpusSchemaVersion: "1.0.0"
  });
  const worker = await readFile(path.join(directory, "service-worker.js"), "utf8");
  assert.match(buildId, /^[a-f0-9]{12}$/);
  assert.match(worker, new RegExp(buildId));
  assert.match(worker, /2026-07-14T00:27:33Z/);
  assert.match(worker, /1\.0\.0/);
  assert.doesNotMatch(worker, /__CGS_(?:BUILD_ID|CORPUS_GENERATED_AT|CORPUS_SCHEMA_VERSION)__/);
});
