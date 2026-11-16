import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./json-schema.mjs";
import { validateCorpus } from "./validator.mjs";
import { validateSupplement, validateSupplements } from "./supplement-validator.mjs";
import { baseRevisionYear } from "./supplement-retirement.mjs";
import { statuteEditionLabel } from "../../src/editions.js";

// Archived editions and the reviewed list of published editions live under data/editions. Every
// workflow that rebuilds public/data from a candidate must carry this directory forward.
export const EDITIONS_DIR = "editions";
export const STATUTE_ARCHIVE_DIR = "editions/statutes";
// The archived base keeps exactly these files: what the base manifest and catalog describe.
const BASE_ENTRIES = ["catalog.json", "manifest.json", "chapters", "search"];
const RECORD_FILE = "edition.json";
export const PUBLISHED_FILE = "published.json";

// Adds an edition to editions/published.json (creating it if needed), keeping years in order.
// An entry that is already listed is left as it was.
export async function recordPublishedEdition(dataDir, edition) {
  const file = path.join(path.resolve(dataDir), EDITIONS_DIR, PUBLISHED_FILE);
  const current = await readJson(file).catch(() => ({ schemaVersion: "1.0.0", editions: [] }));
  if (current.editions.some((entry) => entry.year === edition.year)) return false;
  current.editions = [...current.editions, edition].sort((left, right) => left.year - right.year);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(current, null, 2)}
`, "utf8");
  return true;
}

// The published list must name the active revision and every published supplement, with the
// parity CGA uses: revisions in odd years, supplements in even years.
export async function validatePublishedEditions({ dataDir, schemaDir }) {
  const root = path.resolve(dataDir);
  const file = path.join(root, EDITIONS_DIR, PUBLISHED_FILE);
  // A freshly imported refresh candidate has no editions directory until the rollover step
  // carries it forward (and staging refuses a candidate without it), so its absence is not an
  // error. An editions directory without the list is.
  if (!(await isDirectory(path.join(root, EDITIONS_DIR)))) return { errors: [], editions: [] };
  if (!(await exists(file))) return { errors: [`${EDITIONS_DIR}/${PUBLISHED_FILE} is missing`], editions: [] };
  const value = await readJson(file);
  const schema = await readJson(path.join(path.resolve(schemaDir), "published-editions.schema.json"));
  const errors = validateSchema(value, schema).map((error) => `${EDITIONS_DIR}/${PUBLISHED_FILE} ${error}`);
  const years = (value.editions ?? []).map((entry) => entry.year);
  if (new Set(years).size !== years.length || years.some((year, index) => index && year < years[index - 1])) {
    errors.push(`${EDITIONS_DIR}/${PUBLISHED_FILE}: years must be unique and in order`);
  }
  for (const entry of value.editions ?? []) {
    const kind = entry.year % 2 === 1 ? "revision" : "supplement";
    if (entry.kind !== kind) errors.push(`${EDITIONS_DIR}/${PUBLISHED_FILE}: ${entry.year} must be a ${kind}`);
    if (!entry.url?.includes(`/${entry.year}/${kind === "revision" ? "pub" : "sup"}/`)) errors.push(`${EDITIONS_DIR}/${PUBLISHED_FILE}: ${entry.year} links to the wrong edition`);
  }
  const catalog = await readJson(path.join(root, "catalog.json")).catch(() => null);
  const active = baseRevisionYear(catalog);
  const required = [active, ...await supplementYears(root)].filter(Number.isInteger);
  for (const year of required) {
    if (!years.includes(year)) errors.push(`${EDITIONS_DIR}/${PUBLISHED_FILE}: the published data includes the ${year} edition, which is not listed`);
  }
  return { errors, editions: value.editions ?? [] };
}

async function exists(target) {
  return Boolean(await stat(target).catch(() => null));
}

async function isDirectory(target) {
  return Boolean((await stat(target).catch(() => null))?.isDirectory());
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileSha256(file) {
  return sha256(await readFile(file));
}

// Every file below a directory, as sorted relative POSIX paths.
export async function listFiles(directory) {
  const root = path.resolve(directory);
  if (!(await isDirectory(root))) return [];
  const files = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files.push(path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
  }
  return files.sort();
}

// A digest per file, so two trees can be compared without trusting timestamps.
export async function treeDigest(directory, files = null) {
  const root = path.resolve(directory);
  const list = files ?? await listFiles(root);
  const entries = [];
  for (const file of list) entries.push([file, await fileSha256(path.join(root, ...file.split("/")))]);
  return entries;
}

function sameTree(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function supplementYears(dataDir) {
  const root = path.join(dataDir, "supplements");
  if (!(await isDirectory(root))) return [];
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => left - right);
}

// CGA's /current/pub/ pages always show the newest revision. An archived chapter keeps the URL it
// was captured from, and the reader links that prefix to the edition's year-scoped copy instead.
export function officialSourcesFor(revisionYear) {
  return [{ from: "https://www.cga.ct.gov/current/pub/", to: `https://www.cga.ct.gov/${revisionYear}/pub/` }];
}

async function editionRecord({ publishedDir, candidateCatalog, candidateManifestSha256, years }) {
  const catalog = await readJson(path.join(publishedDir, "catalog.json"));
  const manifest = await readJson(path.join(publishedDir, "manifest.json"));
  const revisionYear = baseRevisionYear(catalog);
  const supplements = [];
  for (const year of years) {
    const directory = path.join(publishedDir, "supplements", String(year));
    const supplementManifest = await readJson(path.join(directory, "manifest.json"));
    supplements.push({
      editionYear: supplementManifest.editionYear,
      generatedAt: supplementManifest.generatedAt,
      retrievedAt: supplementManifest.source.retrievedAt,
      sourceUrl: supplementManifest.source.url,
      manifestSha256: await fileSha256(path.join(directory, "manifest.json")),
      counts: supplementManifest.counts
    });
  }
  const newest = Math.max(revisionYear, ...years);
  return {
    schemaVersion: "1.0.0",
    id: String(revisionYear),
    label: statuteEditionLabel(revisionYear, years),
    revisionYear,
    supplementYears: years,
    legislationThrough: newest - 1,
    base: {
      schemaVersion: catalog.schemaVersion,
      generatedAt: catalog.generatedAt,
      retrievedAt: catalog.source.retrievedAt,
      sourceUrl: catalog.source.url,
      catalogSha256: await fileSha256(path.join(publishedDir, "catalog.json")),
      manifestSha256: await fileSha256(path.join(publishedDir, "manifest.json")),
      counts: { titles: manifest.counts.titles, chapters: manifest.counts.chapters, sections: manifest.counts.sections }
    },
    supplements,
    supersededBy: {
      revisionYear: baseRevisionYear(candidateCatalog),
      generatedAt: candidateCatalog.generatedAt,
      manifestSha256: candidateManifestSha256
    },
    officialSources: officialSourcesFor(revisionYear)
  };
}

// The files an archive of the published pair consists of, relative to the published data root.
async function outgoingFiles(publishedDir, years) {
  const files = [];
  for (const entry of BASE_ENTRIES) {
    const target = path.join(publishedDir, entry);
    if (!(await exists(target))) throw new Error(`The published base has no ${entry}; it cannot be archived`);
    if (await isDirectory(target)) files.push(...(await listFiles(target)).map((file) => `${entry}/${file}`));
    else files.push(entry);
  }
  for (const year of years) {
    files.push(...(await listFiles(path.join(publishedDir, "supplements", String(year)))).map((file) => `supplements/${year}/${file}`));
  }
  return files.sort();
}

async function copyFiles(fromDir, toDir, files) {
  for (const file of files) {
    const target = path.join(toDir, ...file.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(fromDir, ...file.split("/")), target);
  }
}

// Checks one archived edition: its record, that the archived bytes are the ones the record names,
// and the ordinary base and supplement validators run against the archive itself.
export async function validateStatuteArchive({ archiveDir, schemaDir }) {
  const root = path.resolve(archiveDir);
  const errors = [];
  const name = path.basename(root);
  const recordPath = path.join(root, RECORD_FILE);
  if (!(await exists(recordPath))) return { errors: [`${name}: missing ${RECORD_FILE}`], record: null };
  const record = await readJson(recordPath);
  const schema = await readJson(path.join(schemaDir, "statute-edition.schema.json"));
  errors.push(...validateSchema(record, schema).map((error) => `${RECORD_FILE} ${error}`));
  if (record.id !== name) errors.push(`${RECORD_FILE}: id ${record.id} does not match directory ${name}`);
  if (!(await exists(path.join(root, "catalog.json")))) return { errors: [...errors, "catalog.json is missing"], record };
  const catalog = await readJson(path.join(root, "catalog.json"));
  if (baseRevisionYear(catalog) !== record.revisionYear) errors.push(`catalog.json: revised to ${catalog.source?.revisionYear}, but the record says ${record.revisionYear}`);
  if (record.id !== String(record.revisionYear)) errors.push(`${RECORD_FILE}: id must be the revision year`);
  if (await fileSha256(path.join(root, "catalog.json")) !== record.base?.catalogSha256) errors.push("catalog.json: SHA-256 does not match the archive record");
  if (await fileSha256(path.join(root, "manifest.json")) !== record.base?.manifestSha256) errors.push("manifest.json: SHA-256 does not match the archive record");
  const years = await supplementYears(root);
  if (JSON.stringify(years) !== JSON.stringify(record.supplementYears)) {
    errors.push(`supplements: archived editions ${years.join(", ") || "none"} do not match the record (${(record.supplementYears ?? []).join(", ") || "none"})`);
  }
  for (const supplement of record.supplements ?? []) {
    const file = path.join(root, "supplements", String(supplement.editionYear), "manifest.json");
    if (!(await exists(file))) continue;
    if (await fileSha256(file) !== supplement.manifestSha256) errors.push(`supplements/${supplement.editionYear}/manifest.json: SHA-256 does not match the archive record`);
  }
  for (const year of record.supplementYears ?? []) {
    if (year !== record.revisionYear + 1) errors.push(`supplements/${year}: an archived supplement must be the one read with the ${record.revisionYear} revision (${record.revisionYear + 1})`);
  }
  if (record.legislationThrough !== Math.max(record.revisionYear, ...(record.supplementYears ?? [])) - 1) {
    errors.push(`${RECORD_FILE}: legislationThrough must be the year before the newest archived edition`);
  }
  if (!(record.supersededBy?.revisionYear > record.revisionYear)) errors.push(`${RECORD_FILE}: supersededBy must be a later revision`);
  const allowed = new Set([RECORD_FILE, "catalog.json", "manifest.json"]);
  for (const file of await listFiles(root)) {
    if (allowed.has(file) || /^(chapters|search)\//.test(file) || /^supplements\/\d{4}\//.test(file)) continue;
    errors.push(`${file}: not part of an archived edition`);
  }
  const corpus = await validateCorpus({ dataDir: root, schemaDir });
  errors.push(...corpus.errors);
  const supplements = await validateSupplements({ supplementsDir: path.join(root, "supplements"), baseDataDir: root, schemaDir });
  errors.push(...supplements.errors);
  return { errors, record, counts: corpus.counts };
}

export async function validateStatuteArchives({ dataDir, schemaDir }) {
  const root = path.join(path.resolve(dataDir), STATUTE_ARCHIVE_DIR);
  if (!(await isDirectory(root))) return { errors: [], editions: [] };
  const errors = [];
  const editions = [];
  const current = await readJson(path.join(path.resolve(dataDir), "catalog.json")).catch(() => null);
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) {
      errors.push(`${STATUTE_ARCHIVE_DIR}/${entry.name}: unexpected file`);
      continue;
    }
    const result = await validateStatuteArchive({ archiveDir: path.join(root, entry.name), schemaDir: path.resolve(schemaDir) });
    errors.push(...result.errors.map((error) => `${STATUTE_ARCHIVE_DIR}/${entry.name}/${error}`));
    if (result.record) {
      editions.push(result.record);
      const active = baseRevisionYear(current);
      if (active !== null && result.record.revisionYear >= active) {
        errors.push(`${STATUTE_ARCHIVE_DIR}/${entry.name}: an archived edition must be older than the active ${active} revision`);
      }
    }
  }
  return { errors, editions };
}

// Run on every corpus refresh that stages a candidate. It carries the published editions directory
// into the candidate unchanged, and when the candidate is a newer full revision it adds the
// outgoing base and the supplements that revision supersedes as one archived edition.
//
// It writes only beneath the candidate. A failure leaves the published data as it was, and a rerun
// on the same inputs produces the same bytes.
export async function rolloverEdition({ publishedDir, candidateDir, schemaDir }) {
  const published = path.resolve(publishedDir);
  const candidate = path.resolve(candidateDir);
  const schemas = path.resolve(schemaDir);
  const publishedCatalog = await readJson(path.join(published, "catalog.json"));
  const candidateCatalog = await readJson(path.join(candidate, "catalog.json"));
  const outgoingYear = baseRevisionYear(publishedCatalog);
  const incomingYear = baseRevisionYear(candidateCatalog);
  if (outgoingYear === null) throw new Error("The published catalog does not record its revision year (catalog.json source.revisionYear)");
  if (incomingYear === null) throw new Error("The candidate catalog does not record its revision year (catalog.json source.revisionYear)");
  if (incomingYear < outgoingYear) throw new Error(`The candidate is revised to January 1, ${incomingYear}, which is older than the published ${outgoingYear} revision`);

  // Carry forward first. The candidate is built fresh from a crawl, so anything already under its
  // editions directory came from an earlier attempt; it must match what is published.
  const publishedEditions = path.join(published, EDITIONS_DIR);
  const candidateEditions = path.join(candidate, EDITIONS_DIR);
  if (await isDirectory(candidateEditions)) {
    const existing = await treeDigest(candidateEditions);
    const expected = await treeDigest(publishedEditions);
    const prefix = `statutes/${outgoingYear}/`;
    const strip = (entries) => entries.filter(([file]) => !file.startsWith(prefix) && file !== PUBLISHED_FILE);
    if (!sameTree(strip(existing), strip(expected))) {
      throw new Error(`${path.relative(process.cwd(), candidateEditions)} differs from the published editions; start from a fresh candidate`);
    }
  } else if (await isDirectory(publishedEditions)) {
    await cp(publishedEditions, candidateEditions, { recursive: true });
  }

  if (incomingYear === outgoingYear) return { action: "none", outgoingYear, incomingYear };
  // The new revision joins the reviewed list of published editions the guide reads.
  await recordPublishedEdition(candidate, {
    year: incomingYear,
    kind: "revision",
    url: `https://www.cga.ct.gov/${incomingYear}/pub/titles.htm`,
    verifiedFrom: candidateCatalog.source.url,
    heading: `Revised to January 1, ${incomingYear}`
  });
  if (incomingYear % 2 === 0) throw new Error(`The candidate is revised to January 1, ${incomingYear}; CGA publishes full revisions in odd-numbered years`);

  // The pair being archived: the published base and every supplement read with it that the new
  // revision supersedes. Validate it as published before copying anything.
  const years = (await supplementYears(published)).filter((year) => year > outgoingYear && year <= incomingYear);
  const baseCheck = await validateCorpus({ dataDir: published, schemaDir: schemas });
  if (baseCheck.errors.length) throw new Error(`The published ${outgoingYear} revision does not validate, so it was not archived:\n${baseCheck.errors.slice(0, 20).join("\n")}`);
  for (const year of years) {
    const check = await validateSupplement({ supplementDir: path.join(published, "supplements", String(year)), baseDataDir: published, schemaDir: schemas });
    if (check.errors.length) throw new Error(`The published ${year} Supplement does not validate against the ${outgoingYear} revision, so it was not archived:\n${check.errors.slice(0, 20).join("\n")}`);
  }

  const target = path.join(candidate, STATUTE_ARCHIVE_DIR, String(outgoingYear));
  const files = await outgoingFiles(published, years);
  const candidateManifestSha256 = await fileSha256(path.join(candidate, "manifest.json"));
  const record = await editionRecord({ publishedDir: published, candidateCatalog, candidateManifestSha256, years });
  const recordBytes = `${JSON.stringify(record, null, 2)}\n`;

  if (await isDirectory(target)) {
    // Already archived (by an earlier run, or carried from the published editions). Identical
    // bytes are a no-op; anything else must not be overwritten.
    const archived = await treeDigest(target);
    const expected = [...await treeDigest(published, files), [RECORD_FILE, sha256(Buffer.from(recordBytes))]]
      .sort(([left], [right]) => left.localeCompare(right));
    if (!sameTree(archived, expected)) {
      throw new Error(`${path.relative(candidate, target)} already exists with different contents. An archived edition is never replaced; investigate before rerunning.`);
    }
    return { action: "unchanged", outgoingYear, incomingYear, record, files: files.length };
  }

  const staging = `${target}.partial`;
  await rm(staging, { recursive: true, force: true });
  try {
    await copyFiles(published, staging, files);
    await writeFile(path.join(staging, RECORD_FILE), recordBytes, "utf8");
    const check = await validateStatuteArchive({ archiveDir: staging, schemaDir: schemas });
    // The staging directory's name differs from the id until it is renamed.
    const errors = check.errors.filter((error) => !error.startsWith(`${RECORD_FILE}: id ${record.id} does not match directory`));
    if (errors.length) throw new Error(`The archived ${outgoingYear} edition does not validate:\n${errors.slice(0, 20).join("\n")}`);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(staging, target, { recursive: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { action: "archived", outgoingYear, incomingYear, record, files: files.length };
}

export function renderRolloverSummary(result) {
  if (!result || result.action === "none") return null;
  const { record } = result;
  const supplements = record.supplementYears.length
    ? ` and the ${record.supplementYears.map((year) => `${year} Supplement`).join(", ")}`
    : "";
  return [
    "## Edition rollover",
    "",
    `The candidate is the General Statutes revised to January 1, ${result.incomingYear}. ${result.action === "archived" ? "This pull request archives" : "The editions directory already holds"} the outgoing ${record.revisionYear} revision${supplements} under \`public/data/${STATUTE_ARCHIVE_DIR}/${record.id}\`, byte for byte as published, with the record \`${RECORD_FILE}\`.`,
    "",
    "| Archived | Revised to | Generated | Manifest SHA-256 | Counts |",
    "| --- | --- | --- | --- | --- |",
    `| ${record.revisionYear} revision | January 1, ${record.revisionYear} | ${record.base.generatedAt} | \`${record.base.manifestSha256.slice(0, 12)}\` | ${record.base.counts.chapters.toLocaleString("en-US")} chapters, ${record.base.counts.sections.toLocaleString("en-US")} sections |`,
    ...record.supplements.map((supplement) => `| ${supplement.editionYear} Supplement | January 1, ${supplement.editionYear} | ${supplement.generatedAt} | \`${supplement.manifestSha256.slice(0, 12)}\` | ${supplement.counts.chapters.toLocaleString("en-US")} chapters, ${supplement.counts.replacements.toLocaleString("en-US")} replacements, ${supplement.counts.additions.toLocaleString("en-US")} additions |`),
    "",
    `The archive opens at \`#/editions/${record.id}\`. Its section links stay at \`#/editions/${record.id}/t/…\`; current statute links now open the ${result.incomingYear} revision.`,
    ""
  ].join("\n");
}
