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
  await writeFile(path.join(directory, "service-worker.js"), "const BUILD_ID = \"__CGS_BUILD_ID__\";", "utf8");

  const buildId = await stampServiceWorker(directory, ["app.js", "service-worker.js"]);
  const worker = await readFile(path.join(directory, "service-worker.js"), "utf8");
  assert.match(buildId, /^[a-f0-9]{12}$/);
  assert.match(worker, new RegExp(buildId));
  assert.doesNotMatch(worker, /__CGS_BUILD_ID__/);
});
