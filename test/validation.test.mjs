import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importLegacy } from "../scripts/lib/importer.mjs";
import { validateCorpus } from "../scripts/lib/validator.mjs";

test("accepts a valid imported corpus", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-valid-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const data = path.join(temporary, "data");
  await importLegacy({ inputDir: path.resolve("fixtures/legacy"), outputDir: data });
  const result = await validateCorpus({ dataDir: data, schemaDir: path.resolve("schemas") });
  assert.deepEqual(result.errors, []);
});

test("detects changed artifacts through schema and integrity checks", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-invalid-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const data = path.join(temporary, "data");
  await importLegacy({ inputDir: path.resolve("fixtures/legacy"), outputDir: data });
  const file = path.join(data, "chapters", "001.json");
  const chapter = JSON.parse(await readFile(file, "utf8"));
  chapter.sections[0].unexpected = true;
  await writeFile(file, `${JSON.stringify(chapter, null, 2)}\n`);
  const result = await validateCorpus({ dataDir: data, schemaDir: path.resolve("schemas") });
  assert.ok(result.errors.some((error) => error.includes("unexpected property unexpected")));
  assert.ok(result.errors.some((error) => error.includes("SHA-256 does not match")));
});
