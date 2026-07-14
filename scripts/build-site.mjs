#!/usr/bin/env node
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { generateDiscovery } from "./lib/discovery.mjs";
import { stampServiceWorker } from "./lib/pwa-build.mjs";
import { generateSupplementIndex } from "./lib/supplement-index.mjs";

const root = process.cwd();
const output = path.join(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, "src"), output, { recursive: true });
await cp(path.join(root, "public"), output, { recursive: true });
const dataDirectory = path.join(root, "public", "data");
const catalog = JSON.parse(await readFile(path.join(dataDirectory, "catalog.json"), "utf8"));
const siteUrl = process.env.CGS_SITE_URL ?? "https://uconn-law-library.github.io/CGS/";
const discovery = await generateDiscovery({ catalog, dataDirectory, output, siteUrl });
const supplementIndex = await generateSupplementIndex({
  supplementsDir: path.join(dataDirectory, "supplements"),
  outputDir: path.join(output, "data", "supplements"),
  generatedAt: catalog.generatedAt
});
const buildId = await stampServiceWorker(output);
console.log(`Built static site at ${output} with ${discovery.pages} indexed URLs, ${supplementIndex.editions.length} supplement editions, and PWA build ${buildId}`);
