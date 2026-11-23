import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_SITE_URL = "https://uconn-law-library.github.io/CGS-Preview/";
export const PRODUCTION_SITE_URL = "https://uconn-law-library.github.io/CGS/";
const NOINDEX_META = '<meta name="robots" content="noindex">';

// The preview's statutes can lag production, so no page of it should appear in search results.
// Run it before the shell is fingerprinted and again after generated pages are written.
export async function applyPreviewNoindex(directory) {
  let marked = 0;
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const target = path.join(entry.parentPath, entry.name);
    const source = await readFile(target, "utf8");
    if (source.includes(NOINDEX_META)) continue;
    const charset = source.match(/<meta charset="utf-8"\s*\/?>/i);
    if (!charset) throw new Error(`${path.relative(directory, target)} has no charset meta to place the preview noindex tag after`);
    await writeFile(target, source.replace(charset[0], `${charset[0]}${NOINDEX_META}`), "utf8");
    marked += 1;
  }
  return marked;
}

// The preview and production sites share the uconn-law-library.github.io origin, and so share
// browser storage. Renaming these keeps preview testing from touching anyone's real bookmarks,
// settings, or offline data. Each count is checked so a renamed constant fails the build
// instead of silently sharing storage again.
const NAMESPACES = [
  { file: "device-state.js", from: /"cgs\./g, to: '"cgs-preview.', expected: 6 },
  { file: "service-worker.js", from: /"cgs-data-/g, to: '"cgs-preview-data-', expected: 3 }
];

// Defaults the preview changes for visitors who have not chosen otherwise. Page tree navigation
// starts on so testers see it first; production keeps the panes.
const PREVIEW_DEFAULTS = [
  { file: "device-state.js", from: /^(\s*navigationTree:) false,$/m, to: "$1 true,", label: "page tree default" }
];

export async function applyPreviewNamespace(directory) {
  for (const { file, from, to, expected } of NAMESPACES) {
    const target = path.join(directory, file);
    const source = await readFile(target, "utf8");
    const found = source.match(from)?.length ?? 0;
    if (found !== expected) throw new Error(`Expected ${expected} browser storage names in ${file}, found ${found}; update applyPreviewNamespace`);
    await writeFile(target, source.replace(from, to), "utf8");
  }
  for (const { file, from, to, label } of PREVIEW_DEFAULTS) {
    const target = path.join(directory, file);
    const source = await readFile(target, "utf8");
    if (!from.test(source)) throw new Error(`Could not find the ${label} in ${file}; update applyPreviewNamespace`);
    await writeFile(target, source.replace(from, to), "utf8");
  }
}
