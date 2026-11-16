import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./json-schema.mjs";

// Superseded editions of the LCO subject index and the Judicial Branch infractions schedule.
//
// A source edition is the publisher's edition: its stated revision or effective date and the
// digests of its PDFs. Rebinding citations to a new statute base (an offline link update) changes
// resolutions and timestamps but never the edition. Only a refresh that acquires a different
// publication archives the outgoing one.
export const SECONDARY_ARCHIVE_DIR = "editions/secondary";
export const SOURCE_STORE_DIR = "editions/secondary/sources";
export const SECONDARY_KINDS = Object.freeze({
  infractions: { dir: "infractions", route: "infractions", title: "Mail-In Violations and Infractions Schedule" },
  "statutes-index": { dir: "statutes-index", route: "index", title: "Index to the General Statutes" }
});
const RECORD_FILE = "edition.json";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isDirectory = async (target) => Boolean((await stat(target).catch(() => null))?.isDirectory());
const exists = async (target) => Boolean(await stat(target).catch(() => null));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

function isoDate(text) {
  const match = /([a-z]+)\s+(\d{1,2}),\s*(\d{4})/i.exec(String(text ?? ""));
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

// The edition a source manifest describes, from what the publisher printed and the PDF bytes.
export function sourceEditionIdentity(kind, manifest) {
  const source = manifest?.source ?? {};
  const digests = (source.files ?? []).map((file) => file.sha256).sort();
  if (!digests.length) throw new Error(`${kind}: the manifest records no source files`);
  const digest = sha256(digests.join("\n")).slice(0, 8);
  if (kind === "infractions") {
    const date = isoDate(source.effective);
    if (!date) throw new Error(`infractions: the manifest does not state the schedule's effective date`);
    return { id: `${date}-${digest}`, date, label: `Effective ${source.effective}`, digests };
  }
  if (kind === "statutes-index") {
    const date = isoDate(String(source.revision ?? "").replace(/^.*revised to\s+/i, ""));
    if (!date) throw new Error(`statutes-index: the manifest does not state the revision it is revised to`);
    return { id: `${date}-${digest}`, date, label: `Revised to ${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`, digests };
  }
  throw new Error(`Unknown secondary source ${kind}`);
}

async function listFiles(root) {
  if (!(await isDirectory(root))) return [];
  return (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

async function supplementYears(dataDir) {
  const root = path.join(dataDir, "supplements");
  if (!(await isDirectory(root))) return [];
  return (await readdir(root)).filter((name) => /^\d{4}$/.test(name)).map(Number).sort((a, b) => a - b);
}

// Copies captured PDFs into the content-addressed store, checking each digest. Only files the
// candidate's manifests name are kept. Returns the digests that were new.
export async function retainSourceFiles({ dataDir, candidateDir, capturesManifest }) {
  if (!capturesManifest || !(await exists(capturesManifest))) return [];
  const captures = await readJson(capturesManifest);
  const captureRoot = path.dirname(path.resolve(capturesManifest));
  const wanted = new Set();
  for (const { dir } of Object.values(SECONDARY_KINDS)) {
    const manifest = await readJson(path.join(candidateDir, dir, "manifest.json")).catch(() => null);
    for (const file of manifest?.source?.files ?? []) wanted.add(file.sha256);
  }
  const store = path.join(dataDir, SOURCE_STORE_DIR);
  const added = [];
  for (const entry of Object.values(captures.sources ?? {})) {
    if (!wanted.has(entry.sha256)) continue;
    const target = path.join(store, `${entry.sha256}.pdf`);
    if (await exists(target)) continue;
    const bytes = await readFile(path.join(captureRoot, ...entry.path.split("/")));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`${entry.path}: captured bytes do not match the capture manifest`);
    await mkdir(store, { recursive: true });
    await writeFile(target, bytes);
    added.push(entry.sha256);
  }
  return added;
}

// Archives each source whose candidate is a different publication from the published one.
// Writes only under dataDir/editions/secondary; an existing archive must match byte for byte.
export async function archiveSecondaryEditions({ dataDir, candidateDir, schemaDir }) {
  const data = path.resolve(dataDir);
  const published = path.join(data, "secondary");
  const results = [];
  const rootManifest = await readJson(path.join(published, "manifest.json")).catch(() => null);
  if (!rootManifest) return results;
  const catalog = await readJson(path.join(data, "catalog.json"));
  for (const [kind, { dir }] of Object.entries(SECONDARY_KINDS)) {
    const before = await readJson(path.join(published, dir, "manifest.json")).catch(() => null);
    const after = await readJson(path.join(candidateDir, dir, "manifest.json")).catch(() => null);
    if (!before || !after) continue;
    const outgoing = sourceEditionIdentity(kind, before);
    const incoming = sourceEditionIdentity(kind, after);
    if (outgoing.id === incoming.id) {
      results.push({ kind, action: "unchanged", id: outgoing.id, label: outgoing.label });
      continue;
    }
    const files = await listFiles(path.join(published, dir));
    const artifacts = files.map((file) => {
      const record = rootManifest.artifacts.find((artifact) => artifact.path === `${dir}/${file}`);
      if (!record) throw new Error(`secondary/${dir}/${file} is not in the published secondary manifest`);
      return { path: file, bytes: record.bytes, sha256: record.sha256 };
    });
    const sources = [];
    for (const file of before.source.files) {
      const retained = await exists(path.join(data, SOURCE_STORE_DIR, `${file.sha256}.pdf`));
      sources.push({ url: file.url, bytes: file.bytes, sha256: file.sha256, retained, ...(retained ? { path: `../../sources/${file.sha256}.pdf` } : {}) });
    }
    const record = {
      schemaVersion: "1.0.0",
      kind,
      id: outgoing.id,
      label: outgoing.label,
      date: outgoing.date,
      publisher: before.source.publisher,
      name: before.source.name,
      sourceUrl: before.source.url,
      ...(before.source.revision ? { revision: before.source.revision } : {}),
      ...(before.source.effective ? { effective: before.source.effective } : {}),
      ...(before.source.chartBRevision ? { chartBRevision: before.source.chartBRevision } : {}),
      generatedAt: before.generatedAt,
      counts: before.counts,
      sources,
      // The statute text the archived links were resolved against.
      statuteSnapshot: {
        revisionYear: catalog.source.revisionYear,
        supplementYears: await supplementYears(data),
        generatedAt: rootManifest.base.generatedAt,
        manifestSha256: rootManifest.base.manifestSha256
      },
      supersededBy: { id: incoming.id, label: incoming.label },
      artifacts
    };
    const bytes = `${JSON.stringify(record, null, 2)}\n`;
    const target = path.join(data, SECONDARY_ARCHIVE_DIR, kind, outgoing.id);
    if (await isDirectory(target)) {
      const same = await readFile(path.join(target, RECORD_FILE), "utf8").catch(() => null) === bytes
        && (await Promise.all(files.map(async (file) => sha256(await readFile(path.join(target, ...file.split("/")))) === artifacts.find((artifact) => artifact.path === file).sha256))).every(Boolean);
      if (!same) throw new Error(`${SECONDARY_ARCHIVE_DIR}/${kind}/${outgoing.id} already exists with different contents. An archived edition is never replaced.`);
      results.push({ kind, action: "already-archived", id: outgoing.id, label: outgoing.label, supersededBy: incoming.label, record });
      continue;
    }
    const staging = `${target}.partial`;
    await rm(staging, { recursive: true, force: true });
    try {
      await cp(path.join(published, dir), staging, { recursive: true });
      await writeFile(path.join(staging, RECORD_FILE), bytes, "utf8");
      const check = await validateSecondaryArchive({ archiveDir: staging, dataDir: data, schemaDir, expectedId: outgoing.id });
      if (check.errors.length) throw new Error(`The archived ${kind} edition does not validate:\n${check.errors.slice(0, 20).join("\n")}`);
      await cp(staging, target, { recursive: true });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    results.push({ kind, action: "archived", id: outgoing.id, label: outgoing.label, supersededBy: incoming.label, record });
  }
  return results;
}

export async function validateSecondaryArchive({ archiveDir, dataDir, schemaDir, expectedId = null }) {
  const errors = [];
  const record = await readJson(path.join(archiveDir, RECORD_FILE)).catch(() => null);
  if (!record) return { errors: [`missing ${RECORD_FILE}`], record: null };
  const schema = await readJson(path.join(path.resolve(schemaDir), "secondary-edition.schema.json"));
  errors.push(...validateSchema(record, schema).map((error) => `${RECORD_FILE} ${error}`));
  const id = expectedId ?? path.basename(archiveDir);
  if (record.id !== id) errors.push(`${RECORD_FILE}: id ${record.id} does not match ${id}`);
  const manifest = await readJson(path.join(archiveDir, "manifest.json")).catch(() => null);
  if (!manifest) errors.push("manifest.json is missing");
  else {
    try {
      if (sourceEditionIdentity(record.kind, manifest).id !== record.id) errors.push("manifest.json: its source edition does not match the record");
    } catch (error) {
      errors.push(error.message);
    }
  }
  const listed = new Set([RECORD_FILE]);
  for (const artifact of record.artifacts ?? []) {
    listed.add(artifact.path);
    const bytes = await readFile(path.join(archiveDir, ...artifact.path.split("/"))).catch(() => null);
    if (!bytes) errors.push(`${artifact.path}: missing`);
    else if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) errors.push(`${artifact.path}: bytes do not match the archive record`);
  }
  for (const file of await listFiles(archiveDir)) if (!listed.has(file)) errors.push(`${file}: not part of the archived edition`);
  for (const source of record.sources ?? []) {
    if (!source.retained) continue;
    const bytes = await readFile(path.join(dataDir, SOURCE_STORE_DIR, `${source.sha256}.pdf`)).catch(() => null);
    if (!bytes || sha256(bytes) !== source.sha256) errors.push(`${source.sha256}.pdf: the retained source file is missing or changed`);
  }
  return { errors, record };
}

export async function validateSecondaryArchives({ dataDir, schemaDir }) {
  const data = path.resolve(dataDir);
  const errors = [];
  const editions = [];
  for (const kind of Object.keys(SECONDARY_KINDS)) {
    const root = path.join(data, SECONDARY_ARCHIVE_DIR, kind);
    if (!(await isDirectory(root))) continue;
    for (const name of (await readdir(root)).sort()) {
      const result = await validateSecondaryArchive({ archiveDir: path.join(root, name), dataDir: data, schemaDir });
      errors.push(...result.errors.map((error) => `${SECONDARY_ARCHIVE_DIR}/${kind}/${name}/${error}`));
      if (result.record) editions.push(result.record);
    }
  }
  const store = path.join(data, SOURCE_STORE_DIR);
  for (const name of await listFiles(store)) {
    const bytes = await readFile(path.join(store, name));
    if (name !== `${sha256(bytes)}.pdf`) errors.push(`${SOURCE_STORE_DIR}/${name}: the file name must be its SHA-256`);
  }
  return { errors, editions };
}

export function renderSecondaryEditionsSummary(results, retained = []) {
  const archived = results.filter((result) => result.action !== "unchanged");
  if (!archived.length && !retained.length) return null;
  return [
    "## Secondary-source editions",
    "",
    ...archived.map((result) => `- **${SECONDARY_KINDS[result.kind].title}:** the ${result.label} edition (\`${result.id}\`) is replaced by the ${result.supersededBy} edition. ${result.action === "archived" ? "This pull request archives" : "The editions directory already holds"} it, byte for byte with its statute links as resolved, under \`public/data/${SECONDARY_ARCHIVE_DIR}/${result.kind}/${result.id}\`. Source PDFs: ${result.record.sources.map((source) => source.retained ? `\`${source.sha256.slice(0, 12)}\` retained` : `\`${source.sha256.slice(0, 12)}\` not retained (acquired before source retention began)`).join(", ")}.`),
    ...(retained.length ? [`- Retained ${retained.length} source PDF${retained.length === 1 ? "" : "s"} of the current editions under \`public/data/${SOURCE_STORE_DIR}\`: ${retained.map((digest) => `\`${digest.slice(0, 12)}\``).join(", ")}.`] : []),
    ""
  ].join("\n");
}
