import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveSecondaryEditions, renderSecondaryEditionsSummary, retainSourceFiles, sourceEditionIdentity, validateSecondaryArchives } from "../scripts/lib/secondary-editions.mjs";

const schemaDir = path.resolve("schemas");
const published = path.resolve("public/data");

// A data directory with the published catalog and secondary manifests, and the published
// infractions artifacts (the index's artifacts are large and unchanged here).
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-secondary-editions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data");
  await mkdir(path.join(data, "secondary", "statutes-index"), { recursive: true });
  await cp(path.join(published, "catalog.json"), path.join(data, "catalog.json"));
  await cp(path.join(published, "secondary", "manifest.json"), path.join(data, "secondary", "manifest.json"));
  await cp(path.join(published, "secondary", "infractions"), path.join(data, "secondary", "infractions"), { recursive: true });
  await cp(path.join(published, "secondary", "statutes-index", "manifest.json"), path.join(data, "secondary", "statutes-index", "manifest.json"));
  await mkdir(path.join(data, "supplements", "2026"), { recursive: true });
  const candidate = path.join(root, "candidate");
  await cp(path.join(data, "secondary"), candidate, { recursive: true });
  return { root, data, candidate };
}

async function editJson(file, change) {
  const value = JSON.parse(await readFile(file, "utf8"));
  change(value);
  await writeFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("a source edition is the publisher's date and the PDF digests", async () => {
  const infractions = JSON.parse(await readFile(path.join(published, "secondary", "infractions", "manifest.json"), "utf8"));
  const index = JSON.parse(await readFile(path.join(published, "secondary", "statutes-index", "manifest.json"), "utf8"));
  assert.match(sourceEditionIdentity("infractions", infractions).id, /^2026-10-01-[0-9a-f]{8}$/);
  assert.equal(sourceEditionIdentity("infractions", infractions).label, "Effective October 1, 2026");
  assert.match(sourceEditionIdentity("statutes-index", index).id, /^2025-01-01-[0-9a-f]{8}$/);
  assert.equal(sourceEditionIdentity("statutes-index", index).label, "Revised to January 1, 2025");
});

test("an offline rebind against new statutes is a link update, not a new edition", async (t) => {
  const { data, candidate } = await fixture(t);
  // What secondary:rebind changes: timestamps, the base binding, and resolutions.
  await editJson(path.join(candidate, "manifest.json"), (value) => { value.generatedAt = "2027-07-14T00:00:00Z"; value.base.manifestSha256 = "b".repeat(64); });
  await editJson(path.join(candidate, "infractions", "manifest.json"), (value) => { value.generatedAt = "2027-07-14T00:00:00Z"; value.counts.resolved -= 3; });
  await editJson(path.join(candidate, "infractions", "title-14.json"), (value) => { value.entries[0].resolution = { status: "unresolved" }; });
  const results = await archiveSecondaryEditions({ dataDir: data, candidateDir: candidate, schemaDir });
  assert.deepEqual(results.map((result) => result.action), ["unchanged", "unchanged"]);
  assert.deepEqual((await readdir(data)).sort(), ["catalog.json", "secondary", "supplements"]);
  assert.equal(renderSecondaryEditionsSummary(results), null);
});

test("a new publication archives the outgoing edition with its historical links", async (t) => {
  const { root, data, candidate } = await fixture(t);
  // The outgoing edition's PDF was retained while it was current.
  const pdf = Buffer.from("%PDF-1.7 outgoing schedule");
  const digest = digestOf(pdf);
  await editJson(path.join(data, "secondary", "infractions", "manifest.json"), (value) => { value.source.files[0].sha256 = digest; value.source.files[0].bytes = pdf.length; });
  // secondary/manifest.json records the infractions manifest's digest, so keep it consistent.
  const manifestBytes = await readFile(path.join(data, "secondary", "infractions", "manifest.json"));
  await editJson(path.join(data, "secondary", "manifest.json"), (value) => {
    const entry = value.artifacts.find((artifact) => artifact.path === "infractions/manifest.json");
    entry.bytes = manifestBytes.length;
    entry.sha256 = digestOf(manifestBytes);
  });
  await mkdir(path.join(data, "editions", "secondary", "sources"), { recursive: true });
  await writeFile(path.join(data, "editions", "secondary", "sources", `${digest}.pdf`), pdf);
  const outgoingId = sourceEditionIdentity("infractions", JSON.parse(manifestBytes)).id;

  // The Judicial Branch publishes a schedule effective January 1, 2027.
  const nextPdf = Buffer.from("%PDF-1.7 next schedule");
  const nextDigest = digestOf(nextPdf);
  await editJson(path.join(candidate, "infractions", "manifest.json"), (value) => {
    value.source.effective = "January 1, 2027";
    value.source.files = [{ ...value.source.files[0], name: `${nextDigest}.pdf`, sha256: nextDigest, bytes: nextPdf.length }];
  });
  const results = await archiveSecondaryEditions({ dataDir: data, candidateDir: candidate, schemaDir });
  const archived = results.find((result) => result.kind === "infractions");
  assert.equal(archived.action, "archived");
  assert.equal(archived.supersededBy, "Effective January 1, 2027");
  assert.equal(results.find((result) => result.kind === "statutes-index").action, "unchanged");
  const target = path.join(data, "editions", "secondary", "infractions", outgoingId);
  const record = JSON.parse(await readFile(path.join(target, "edition.json"), "utf8"));
  assert.equal(record.label, "Effective October 1, 2026");
  assert.equal(record.statuteSnapshot.revisionYear, 2025);
  assert.deepEqual(record.statuteSnapshot.supplementYears, [2026]);
  assert.deepEqual(record.sources.map((source) => source.retained), [true]);
  // The archived records keep their resolutions, including the explicitly unresolved ones.
  assert.equal(await readFile(path.join(target, "unresolved.json"), "utf8"), await readFile(path.join(data, "secondary", "infractions", "unresolved.json"), "utf8"));
  assert.match(await readFile(path.join(target, "title-14.json"), "utf8"), /"href": ?"#\/t\/14\//);
  assert.deepEqual((await validateSecondaryArchives({ dataDir: data, schemaDir })).errors, []);
  assert.match(renderSecondaryEditionsSummary(results), /the Effective October 1, 2026 edition .* is replaced by the Effective January 1, 2027 edition/);

  // Rerunning is a no-op; different bytes are refused.
  assert.equal((await archiveSecondaryEditions({ dataDir: data, candidateDir: candidate, schemaDir })).find((result) => result.kind === "infractions").action, "already-archived");
  const shard = path.join(target, "title-14.json");
  const original = await readFile(shard);
  await writeFile(shard, "{}\n", "utf8");
  assert.match((await validateSecondaryArchives({ dataDir: data, schemaDir })).errors.join("\n"), /title-14\.json: bytes do not match the archive record/);
  await assert.rejects(() => archiveSecondaryEditions({ dataDir: data, candidateDir: candidate, schemaDir }), /already exists with different contents/);
  await writeFile(shard, original);

  // The new edition's PDFs are retained by digest from the acquisition capture.
  const captures = path.join(root, "captures");
  await mkdir(path.join(captures, "files"), { recursive: true });
  await writeFile(path.join(captures, "files", `${nextDigest}.pdf`), nextPdf);
  await writeFile(path.join(captures, "manifest.json"), JSON.stringify({ sources: { "https://jud.ct.gov/webforms/forms/infractions.pdf": { name: "infractions.pdf", sha256: nextDigest, bytes: nextPdf.length, path: `files/${nextDigest}.pdf` } } }), "utf8");
  const capturesManifest = path.join(captures, "manifest.json");
  assert.deepEqual(await retainSourceFiles({ dataDir: data, candidateDir: candidate, capturesManifest }), [nextDigest]);
  assert.deepEqual(await retainSourceFiles({ dataDir: data, candidateDir: candidate, capturesManifest }), []);
  await writeFile(path.join(data, "editions", "secondary", "sources", `${"0".repeat(64)}.pdf`), "x");
  assert.match((await validateSecondaryArchives({ dataDir: data, schemaDir })).errors.join("\n"), /the file name must be its SHA-256/);
});
