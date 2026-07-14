import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const shellInputs = Object.freeze([
  "404.html",
  "app.js",
  "device-state.js",
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "omnisearch.js",
  "pwa.js",
  "reader.js",
  "routes.js",
  "search-client.js",
  "search-worker.js",
  "search.js",
  "secondary-sources.js",
  "secondary-ui.js",
  "service-worker.js",
  "styles.css",
  "supplements.js"
]);

export async function stampServiceWorker(directory, inputs = shellInputs) {
  const hash = createHash("sha256");
  for (const relative of [...inputs].sort()) {
    hash.update(relative);
    hash.update(await readFile(path.join(directory, relative)));
  }
  const buildId = hash.digest("hex").slice(0, 12);
  const workerPath = path.join(directory, "service-worker.js");
  const source = await readFile(workerPath, "utf8");
  if (!source.includes("__CGS_BUILD_ID__")) throw new Error("Service worker build placeholder is missing");
  await writeFile(workerPath, source.replaceAll("__CGS_BUILD_ID__", buildId), "utf8");
  return buildId;
}
