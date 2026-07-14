#!/usr/bin/env node
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { generateDiscovery } from "./lib/discovery.mjs";

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
console.log(`Built static site at ${output} with ${discovery.pages} indexed URLs`);
