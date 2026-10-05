import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { validateSchema } from "./json-schema.mjs";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function countActs(acts) {
  const publicActs = acts.filter((act) => act.type === "public").length;
  return { acts: acts.length, publicActs, specialActs: acts.length - publicActs };
}

function sameCounts(left = {}, right = {}) {
  return ["acts", "publicActs", "specialActs"].every((key) => left[key] === right[key]);
}

export async function validateActs({ actsDir, schemaDir }) {
  const root = path.resolve(actsDir);
  if (!(await stat(root).catch(() => null))?.isDirectory()) {
    return { errors: [], present: false, counts: { sessions: 0, acts: 0 } };
  }
  const [manifestSchema, sessionSchema] = await Promise.all([
    readJson(path.join(schemaDir, "acts-manifest.schema.json")),
    readJson(path.join(schemaDir, "acts-session.schema.json"))
  ]);
  const manifest = await readJson(path.join(root, "manifest.json"));
  const errors = validateSchema(manifest, manifestSchema).map((error) => `acts/manifest.json ${error}`);
  if (errors.length) return { errors, present: true, counts: { sessions: 0, acts: 0 } };

  const artifactPaths = new Set(manifest.artifacts.map((artifact) => artifact.path));
  if (artifactPaths.size !== manifest.artifacts.length) errors.push("acts/manifest.json lists an artifact more than once");
  const sessionIds = new Set();
  const allActs = [];
  for (const entry of manifest.sessions) {
    const label = `acts/${entry.path}`;
    if (sessionIds.has(entry.id)) errors.push(`acts/manifest.json lists session ${entry.id} more than once`);
    sessionIds.add(entry.id);
    const artifact = manifest.artifacts.find((candidate) => candidate.path === entry.path);
    if (!artifact || artifact.bytes !== entry.bytes || artifact.sha256 !== entry.sha256) {
      errors.push(`${label}: session entry does not match its artifact record`);
    }
    const bytes = await readFile(path.join(root, entry.path)).catch(() => null);
    if (!bytes) {
      errors.push(`${label}: file is missing`);
      continue;
    }
    if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      errors.push(`${label}: bytes or SHA-256 do not match the manifest`);
    }
    const session = JSON.parse(bytes.toString("utf8"));
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
    }
    if (!sameCounts(countActs(session.acts), entry.counts)) errors.push(`${label}: counts do not match the manifest`);
    allActs.push(...session.acts);
  }
  if (manifest.artifacts.length !== manifest.sessions.length || [...artifactPaths].some((value) => !manifest.sessions.some((entry) => entry.path === value))) {
    errors.push("acts/manifest.json artifacts must correspond one-to-one with sessions");
  }
  if (manifest.counts.sessions !== manifest.sessions.length || !sameCounts(countActs(allActs), manifest.counts)) {
    errors.push("acts/manifest.json aggregate counts do not match the session files");
  }
  return { errors, present: true, counts: { sessions: manifest.sessions.length, acts: allActs.length } };
}
