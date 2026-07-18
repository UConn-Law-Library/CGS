import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const shellInputs = Object.freeze([
  "404.html",
  "app.js",
  "device-state.js",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "omnisearch.js",
  "offline-integrity.js",
  "pwa.js",
  "reader.js",
  "routes.js",
  "search-client.js",
  "search-highlight.js",
  "search-worker.js",
  "search.js",
  "secondary-sources.js",
  "secondary-ui.js",
  "service-worker.js",
  "styles.css",
  "supplement-overlay.js",
  "supplements.js"
]);

export async function stampServiceWorker(directory, inputs = shellInputs, release = {}) {
  const hash = createHash("sha256");
  for (const relative of [...inputs].sort()) {
    hash.update(relative);
    hash.update(await readFile(path.join(directory, relative)));
  }
  const buildId = hash.digest("hex").slice(0, 12);
  const workerPath = path.join(directory, "service-worker.js");
  const source = await readFile(workerPath, "utf8");
  for (const placeholder of ["__CGS_BUILD_ID__", "__CGS_CORPUS_GENERATED_AT__", "__CGS_CORPUS_SCHEMA_VERSION__"]) {
    if (!source.includes(placeholder)) throw new Error(`Service worker placeholder is missing: ${placeholder}`);
  }
  const stamped = source
    .replaceAll("__CGS_BUILD_ID__", buildId)
    .replaceAll("__CGS_CORPUS_GENERATED_AT__", release.corpusGeneratedAt ?? "unknown")
    .replaceAll("__CGS_CORPUS_SCHEMA_VERSION__", release.corpusSchemaVersion ?? "unknown");
  await writeFile(workerPath, stamped, "utf8");
  return buildId;
}
