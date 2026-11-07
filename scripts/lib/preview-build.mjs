import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_SITE_URL = "https://uconn-law-library.github.io/CGS-Preview/";

// The preview and production sites share the uconn-law-library.github.io origin, and so share
// browser storage. Renaming these keeps preview testing from touching anyone's real bookmarks,
// settings, or offline data. Each count is checked so a renamed constant fails the build
// instead of silently sharing storage again.
const NAMESPACES = [
  { file: "device-state.js", from: /"cgs\./g, to: '"cgs-preview.', expected: 6 },
  { file: "service-worker.js", from: /"cgs-data-/g, to: '"cgs-preview-data-', expected: 3 }
];

export async function applyPreviewNamespace(directory) {
  for (const { file, from, to, expected } of NAMESPACES) {
    const target = path.join(directory, file);
    const source = await readFile(target, "utf8");
    const found = source.match(from)?.length ?? 0;
    if (found !== expected) throw new Error(`Expected ${expected} browser storage names in ${file}, found ${found}; update applyPreviewNamespace`);
    await writeFile(target, source.replace(from, to), "utf8");
  }
}
