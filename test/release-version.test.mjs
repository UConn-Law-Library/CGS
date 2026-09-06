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
    const source = await readFile(new URL("../src/release.js", import.meta.url), "utf8");
    await writeFile(path.join(directory, "release.js"), source, "utf8");
    const updates = [{ title: 'Fix "$&" and <markup>', commit: "a".repeat(40), date: "2026-09-05" }];
    assert.equal(await stampReleaseVersion(directory, "1.0.1", updates), "v1.0.1");
    const stamped = await readFile(path.join(directory, "release.js"), "utf8");
    const release = await import(`data:text/javascript,${encodeURIComponent(stamped)}`);
    assert.equal(release.APP_VERSION, "v1.0.1");
    assert.deepEqual(release.RECENT_UPDATES, updates);
    assert.doesNotMatch(stamped, /__CGS_/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps the release module in the offline application shell", async () => {
  const worker = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /"\.\/release\.js"/);
});
