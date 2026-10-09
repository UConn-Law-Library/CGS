#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateDiscovery } from "./lib/discovery.mjs";
import { stampServiceWorker } from "./lib/pwa-build.mjs";
import { stampReleaseVersion } from "./lib/release-version.mjs";
import { readRecentUpdates } from "./lib/site-updates.mjs";
import { generateSupplementIndex } from "./lib/supplement-index.mjs";
import { generateSearchV2Artifacts } from "./lib/search-v2-artifacts.mjs";
import { buildRepositoryMap } from "./lib/build-repository-map.mjs";
import { generateActAmendments } from "./lib/act-amendments-artifact.mjs";

const root = process.cwd();
const output = path.join(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, "src"), output, { recursive: true });
await cp(path.join(root, "public"), output, { recursive: true });
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const updates = await readRecentUpdates(root);
const appVersion = await stampReleaseVersion(output, process.env.CGS_APP_VERSION ?? packageMetadata.version, updates);
const dataDirectory = path.join(root, "public", "data");
const catalog = JSON.parse(await readFile(path.join(dataDirectory, "catalog.json"), "utf8"));
const siteUrl = process.env.CGS_SITE_URL ?? "https://uconn-law-library.github.io/CGS/";
const notFoundPath = path.join(output, "404.html");
await writeFile(notFoundPath, (await readFile(notFoundPath, "utf8")).replace("%APP_BASE_PATH%", new URL(siteUrl).pathname));
const discovery = await generateDiscovery({ catalog, dataDirectory, output, siteUrl });
const supplementIndex = await generateSupplementIndex({
  supplementsDir: path.join(dataDirectory, "supplements"),
  outputDir: path.join(output, "data", "supplements"),
  generatedAt: catalog.generatedAt
});
const searchV2 = await generateSearchV2Artifacts({
  catalog,
  dataDirectory,
  supplementsDir: path.join(dataDirectory, "supplements"),
  outputDir: path.join(output, "data", "search-v2"),
  generatedAt: catalog.generatedAt
});
const actAmendments = await generateActAmendments({
  actsDir: path.join(dataDirectory, "acts"),
  outputDir: path.join(output, "data", "acts")
});
await addLoadHints(output, catalog);
const buildId = await stampServiceWorker(output, undefined, {
  corpusGeneratedAt: catalog.generatedAt,
  corpusSchemaVersion: catalog.schemaVersion
});
const repositoryMap = await buildRepositoryMap({ root, output });
console.log(`Built static site ${appVersion} at ${output} with ${discovery.pages} indexed URLs, ${supplementIndex.editions.length} supplement editions, ${searchV2.counts.documents} extended search documents, ${actAmendments.counts.citations} sections amended by listed acts, ${repositoryMap.diagrams} repository map diagrams, and PWA build ${buildId}`);

// Without hints the browser finds each module only after parsing the one that imports it, and
// the catalog only after every module has run. Preloading them from index.html lets the whole
// module graph and the catalog download in parallel with app.js. A statute link also starts its
// supplement manifests and chapter file, which app.js would otherwise request only after the
// catalog has arrived and all of its code has run.
async function addLoadHints(directory, catalog) {
  const modules = new Set();
  const pending = ["app.js"];
  while (pending.length) {
    const file = pending.pop();
    const source = await readFile(path.join(directory, file), "utf8");
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*["']\.\/([\w.-]+\.js)["']/gms)) {
      if (!modules.has(specifier)) {
        modules.add(specifier);
        pending.push(specifier);
      }
    }
  }
  const supplementIndex = JSON.parse(await readFile(path.join(directory, "data", "supplements", "manifest.json"), "utf8"));
  const latest = [...supplementIndex.editions].sort((left, right) => right.editionYear - left.editionYear)[0];
  const baseChapters = new Set();
  for (const title of catalog.titles) {
    for (const chapter of title.chapters) {
      if (chapter.path !== `chapters/${chapter.number}.json`) throw new Error(`Chapter ${chapter.number} is stored at ${chapter.path}; update addLoadHints`);
      baseChapters.add(chapter.number);
    }
  }
  const supplementOnly = latest
    ? JSON.parse(await readFile(path.join(directory, "data", "supplements", latest.path), "utf8")).titles
      .flatMap((title) => title.chapters.map((chapter) => chapter.number))
      .filter((number) => !baseChapters.has(number))
    : [];
  const statuteFiles = ["./data/supplements/manifest.json", ...(latest ? [`./data/supplements/${latest.path}`] : [])];
  const statuteHints = `(() => {
    const route = /^#\\/t\\/[^/?]+(?:\\/c\\/([^/?]+))?/.exec(location.hash);
    if (!route) return;
    const files = ${JSON.stringify(statuteFiles)};
    const chapter = route[1] && decodeURIComponent(route[1]);
    if (chapter && !${JSON.stringify(supplementOnly)}.includes(chapter)) files.push("./data/chapters/" + chapter + ".json");
    for (const href of files) document.head.append(Object.assign(document.createElement("link"), { rel: "preload", as: "fetch", crossOrigin: "anonymous", href }));
  })();`;
  const hints = [
    `<link rel="preload" href="./data/catalog.json" as="fetch" crossorigin>`,
    ...[...modules].sort().map((module) => `<link rel="modulepreload" href="./${module}">`),
    `<script>\n  ${statuteHints}\n  </script>`
  ].join("\n  ");
  const entry = `<script type="module" src="./app.js"></script>`;
  const indexPath = path.join(directory, "index.html");
  const html = await readFile(indexPath, "utf8");
  if (!html.includes(entry)) throw new Error("index.html no longer loads ./app.js; update addLoadHints");
  await writeFile(indexPath, html.replace(entry, `${hints}\n  ${entry}`));
}
