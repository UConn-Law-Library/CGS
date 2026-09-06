import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION_PLACEHOLDER = "__CGS_APP_VERSION__";
const SEMVER_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function normalizeReleaseVersion(value) {
  const version = String(value ?? "").trim();
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid application release version: ${version || "(empty)"}`);
  }
  return version.startsWith("v") ? version : `v${version}`;
}

export async function stampReleaseVersion(directory, value, updates = []) {
  const version = normalizeReleaseVersion(value);
  const releasePath = path.join(directory, "release.js");
  const source = await readFile(releasePath, "utf8");
  if (!source.includes(VERSION_PLACEHOLDER)) {
    throw new Error(`Application release placeholder is missing: ${VERSION_PLACEHOLDER}`);
  }
  const updatesPlaceholder = "/* __CGS_RECENT_UPDATES__ */ []";
  if (!source.includes(updatesPlaceholder)) throw new Error("Recent updates placeholder is missing");
  const stamped = source.replaceAll(VERSION_PLACEHOLDER, version)
    .replace(updatesPlaceholder, () => JSON.stringify(updates));
  await writeFile(releasePath, stamped, "utf8");
  return version;
}
