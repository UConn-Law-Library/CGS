import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./json-schema.mjs";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function countActs(acts) {
  const publicActs = acts.filter((act) => act.type === "public").length;
  const textActs = acts.filter((act) => act.text).length;
  return { acts: acts.length, publicActs, specialActs: acts.length - publicActs, textActs };
}

function sameCounts(left = {}, right = {}) {
  return ["acts", "publicActs", "specialActs", "textActs"].every((key) => left[key] === right[key]);
}

function sameIdentity(left, right) {
  return Boolean(left && right) && left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256;
}

// Read a published file and check it against its recorded size and digest.
async function readArtifact(root, record, label, errors) {
  const bytes = await readFile(path.join(root, ...record.path.split("/"))).catch(() => null);
  if (!bytes) {
    errors.push(`${label}: file is missing`);
    return null;
  }
  if (bytes.length !== record.bytes || createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
    errors.push(`${label}: bytes or SHA-256 do not match the manifest`);
  }
  return JSON.parse(bytes.toString("utf8"));
}

function validateText(document, act, label) {
  const errors = [];
  if (document.id !== act.id || document.citation !== act.citation) errors.push(`${label}: text is for ${document.id}, not ${act.id}`);
  if (document.source.url !== act.url) errors.push(`${label}: text was extracted from a different PDF than the act links`);
  if (document.source.pages !== act.text.pages) errors.push(`${label}: page count does not match the act's text reference`);
  document.sections.forEach((section, index) => {
    if (section.number !== String(index + 1) || section.anchor !== `sec-${section.number}`) {
      errors.push(`${label}: sections must be numbered 1 to ${document.sections.length}`);
    }
  });
  const anchors = document.blocks.filter((block) => block.anchor).map((block) => block.anchor);
  if (anchors.join() !== document.sections.map((section) => section.anchor).join()) {
    errors.push(`${label}: each section must anchor exactly one block, in order`);
  }
  document.blocks.forEach((block, index) => {
    const content = block.type === "table" ? block.rows : block.runs;
    if (!content?.length || (block.type === "table" ? block.runs : block.rows)) {
      errors.push(`${label}: block ${index} must have ${block.type === "table" ? "rows" : "runs"} only`);
    }
  });
  return errors;
}

function validateSearch(index, entry, textActs, label) {
  const errors = [];
  if (index.session !== entry.id) errors.push(`${label}: indexes ${index.session}, not ${entry.id}`);
  if (index.acts.join() !== textActs.map((act) => act.id).join()) {
    errors.push(`${label}: acts must list the session's acts with text, in order`);
  }
  for (const [term, postings] of Object.entries(index.terms)) {
    const ascending = Array.isArray(postings) && postings.length > 0 && postings.every((value, position) =>
      Number.isInteger(value) && value >= 0 && value < index.acts.length && (position === 0 || value > postings[position - 1]));
    if (!term || !ascending) {
      errors.push(`${label}: term ${JSON.stringify(term)} must list ascending act positions`);
      break;
    }
  }
  return errors;
}

export async function validateActs({ actsDir, schemaDir }) {
  const root = path.resolve(actsDir);
  if (!(await stat(root).catch(() => null))?.isDirectory()) {
    return { errors: [], present: false, counts: { sessions: 0, acts: 0, textActs: 0 } };
  }
  const [manifestSchema, sessionSchema, textSchema, searchSchema] = await Promise.all(
    ["acts-manifest", "acts-session", "acts-text", "acts-search"].map((name) => readJson(path.join(schemaDir, `${name}.schema.json`)))
  );
  const manifest = await readJson(path.join(root, "manifest.json"));
  const errors = validateSchema(manifest, manifestSchema).map((error) => `acts/manifest.json ${error}`);
  if (errors.length) return { errors, present: true, counts: { sessions: 0, acts: 0, textActs: 0 } };

  const artifacts = new Map(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  if (artifacts.size !== manifest.artifacts.length) errors.push("acts/manifest.json lists an artifact more than once");
  const referenced = new Set();
  const reference = (record, label) => {
    referenced.add(record.path);
    if (!sameIdentity(artifacts.get(record.path), record)) errors.push(`${label}: does not match its artifact record`);
  };
  const sessionIds = new Set();
  const allActs = [];
  for (const entry of manifest.sessions) {
    const label = `acts/${entry.path}`;
    if (sessionIds.has(entry.id)) errors.push(`acts/manifest.json lists session ${entry.id} more than once`);
    sessionIds.add(entry.id);
    reference(entry, `${label}: session entry`);
    const session = await readArtifact(root, entry, label, errors);
    if (!session) continue;
    const schemaErrors = validateSchema(session, sessionSchema).map((error) => `${label} ${error}`);
    errors.push(...schemaErrors);
    if (schemaErrors.length) continue;
    if (session.session.id !== entry.id || session.session.year !== entry.year || session.session.name !== entry.name) {
      errors.push(`${label}: session identity does not match the manifest`);
    }
    const ids = new Set();
    for (const act of session.acts) {
      if (ids.has(act.id)) errors.push(`${label}: duplicate act ${act.id}`);
      ids.add(act.id);
      const prefix = act.type === "public" ? "pa" : "sa";
      if (act.id !== `${prefix}-${entry.id}-${act.number}`) errors.push(`${label}: act ${act.id} does not match its type and number`);
      if (!act.text) continue;
      const textLabel = `acts/${act.text.path}`;
      if (act.text.path !== `${entry.id}/text/${prefix}-${act.number}.json`) errors.push(`${textLabel}: is not where ${act.id}'s text belongs`);
      reference(act.text, `${textLabel}: text reference`);
      const document = await readArtifact(root, act.text, textLabel, errors);
      if (!document) continue;
      const textErrors = validateSchema(document, textSchema).map((error) => `${textLabel} ${error}`);
      errors.push(...(textErrors.length ? textErrors : validateText(document, act, textLabel)));
    }
    if (!sameCounts(countActs(session.acts), entry.counts)) errors.push(`${label}: counts do not match the manifest`);
    const textActs = session.acts.filter((act) => act.text);
    if (textActs.length && !entry.search) errors.push(`${label}: acts have text but the session has no search index`);
    if (!textActs.length && entry.search) errors.push(`${label}: the session has a search index but no act text`);
    if (entry.search) {
      const searchLabel = `acts/${entry.search.path}`;
      if (entry.search.path !== `${entry.id}/search.json`) errors.push(`${searchLabel}: is not where ${entry.id}'s search index belongs`);
      reference(entry.search, `${searchLabel}: search entry`);
      const index = await readArtifact(root, entry.search, searchLabel, errors);
      if (index) {
        const searchErrors = validateSchema(index, searchSchema).map((error) => `${searchLabel} ${error}`);
        errors.push(...(searchErrors.length ? searchErrors : validateSearch(index, entry, textActs, searchLabel)));
      }
    }
    allActs.push(...session.acts);
  }
  for (const artifact of manifest.artifacts) {
    if (!referenced.has(artifact.path)) errors.push(`acts/manifest.json artifact ${artifact.path} is not a session file, act text, or search index`);
  }
  if (manifest.counts.sessions !== manifest.sessions.length || !sameCounts(countActs(allActs), manifest.counts)) {
    errors.push("acts/manifest.json aggregate counts do not match the session files");
  }
  const counts = countActs(allActs);
  return { errors, present: true, counts: { sessions: manifest.sessions.length, acts: allActs.length, textActs: counts.textActs } };
}
