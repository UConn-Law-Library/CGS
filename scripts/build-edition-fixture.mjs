#!/usr/bin/env node
// Builds a rehearsal rollover from the checked-in legacy fixture: the 2021 revision with its
// 2022 Supplement, archived when the 2023 revision replaces it. Browser tests serve the
// resulting editions directory through `build-site.mjs --editions-overlay`, so archive
// navigation is exercised before CGA publishes a real rollover.
//
//   node scripts/build-edition-fixture.mjs --output .crawl/browser-editions
import { rm } from "node:fs/promises";
import path from "node:path";
import { buildEditionFixture } from "./lib/edition-fixture.mjs";
import { rolloverEdition } from "./lib/edition-archive.mjs";

const index = process.argv.indexOf("--output");
const root = path.resolve(index === -1 ? ".crawl/browser-editions" : process.argv[index + 1]);
await rm(root, { recursive: true, force: true });
const { published, candidate } = await buildEditionFixture(root, { revisionYear: 2021 });
const result = await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir: path.resolve("schemas") });
console.log(`Rehearsal archive: ${result.record.label} at ${path.join(candidate, "editions")}`);
