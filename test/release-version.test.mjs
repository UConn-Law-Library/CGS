import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeReleaseVersion, stampReleaseVersion } from "../scripts/lib/release-version.mjs";

test("normalizes stable and prerelease semantic versions", () => {
  assert.equal(normalizeReleaseVersion("1.0.0"), "v1.0.0");
  assert.equal(normalizeReleaseVersion("v2.4.1-beta.2"), "v2.4.1-beta.2");
  assert.throws(() => normalizeReleaseVersion("release-1"), /Invalid application release version/);
});

test("stamps the deployed release module", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cgs-release-version-"));
  try {
    await writeFile(path.join(directory, "release.js"), 'export const APP_VERSION = "__CGS_APP_VERSION__";\n', "utf8");
    assert.equal(await stampReleaseVersion(directory, "1.0.1"), "v1.0.1");
    assert.equal(await readFile(path.join(directory, "release.js"), "utf8"), 'export const APP_VERSION = "v1.0.1";\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps the release module in the offline application shell", async () => {
  const worker = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /"\.\/release\.js"/);
});
