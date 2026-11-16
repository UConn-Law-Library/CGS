#!/usr/bin/env node
// Builds rehearsal archives for browser tests and local review:
//
// - statutes: the checked-in legacy fixture's 2021 revision with its 2022 Supplement, archived
//   when a 2023 revision replaces it;
// - secondary: the published infractions schedule, archived as if the Judicial Branch had
//   published a new schedule (its records, resolutions, and unresolved citations unchanged).
//
// build-site.mjs --editions-overlay serves the result, so archive navigation is tested before a
// real rollover publishes one.
//
//   node scripts/build-edition-fixture.mjs --output .crawl/browser-editions
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEditionFixture } from "./lib/edition-fixture.mjs";
import { rolloverEdition } from "./lib/edition-archive.mjs";
import { archiveSecondaryEditions } from "./lib/secondary-editions.mjs";

const index = process.argv.indexOf("--output");
const root = path.resolve(index === -1 ? ".crawl/browser-editions" : process.argv[index + 1]);
const schemaDir = path.resolve("schemas");
await rm(root, { recursive: true, force: true });
const { published, candidate } = await buildEditionFixture(root, { revisionYear: 2021 });
const result = await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir });
console.log(`Rehearsal archive: ${result.record.label}`);

// The infractions schedule: published data, then a candidate with a new effective date and PDF.
const data = path.join(root, "secondary-data");
const source = path.resolve("public/data");
await mkdir(path.join(data, "secondary", "statutes-index"), { recursive: true });
await cp(path.join(source, "catalog.json"), path.join(data, "catalog.json"));
await cp(path.join(source, "supplements"), path.join(data, "supplements"), { recursive: true, filter: (file) => !/[\\/](chapters|search)([\\/]|$)/.test(file) });
await cp(path.join(source, "secondary", "manifest.json"), path.join(data, "secondary", "manifest.json"));
await cp(path.join(source, "secondary", "infractions"), path.join(data, "secondary", "infractions"), { recursive: true });
await cp(path.join(source, "secondary", "statutes-index", "manifest.json"), path.join(data, "secondary", "statutes-index", "manifest.json"));
const next = path.join(root, "secondary-candidate");
await cp(path.join(data, "secondary"), next, { recursive: true });
const manifestPath = path.join(next, "infractions", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const digest = createHash("sha256").update("rehearsal schedule").digest("hex");
manifest.source.effective = "January 1, 2099";
manifest.source.files = [{ ...manifest.source.files[0], name: `${digest}.pdf`, sha256: digest }];
await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
const archived = await archiveSecondaryEditions({ dataDir: data, candidateDir: next, schemaDir });
await cp(path.join(data, "editions", "secondary"), path.join(candidate, "editions", "secondary"), { recursive: true });
console.log(`Rehearsal archive: ${archived.filter((entry) => entry.action === "archived").map((entry) => `${entry.kind} ${entry.label}`).join(", ")}`);
console.log(`Editions directory: ${path.join(candidate, "editions")}`);
