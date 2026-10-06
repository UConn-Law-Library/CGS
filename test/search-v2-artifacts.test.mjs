import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateSearchV2Artifacts } from "../scripts/lib/search-v2-artifacts.mjs";

test("generates deterministic auxiliary history and annotation search shards", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-search-v2-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, "data");
  const supplementsDir = path.join(root, "supplements");
  const outputDir = path.join(root, "output");
  await mkdir(path.join(dataDirectory, "chapters"), { recursive: true });
  await mkdir(supplementsDir, { recursive: true });
  await writeFile(path.join(dataDirectory, "chapters", "001.json"), JSON.stringify({
    sections: [{
      id: "section-1-1",
      content: {
        history: ["1949, S. 1"],
        annotations: [{ type: "case-note", text: "The court construed this section." }]
      }
    }]
  }));
  const catalog = {
    schemaVersion: "1.0.0",
    titles: [{ id: "title-01", number: "01", name: "General", chapters: [{ id: "chapter-001", number: "001", path: "chapters/001.json" }] }]
  };

  const manifest = await generateSearchV2Artifacts({
    catalog,
    dataDirectory,
    supplementsDir,
    outputDir,
    generatedAt: "2026-07-18T00:00:00.000Z"
  });
  assert.deepEqual(manifest.counts, { titles: 1, documents: 1 });
  assert.equal(manifest.supplementEditionYear, null);
  const bytes = await readFile(path.join(outputDir, "title-01.json"));
  const shard = JSON.parse(bytes);
  assert.deepEqual(shard.documents, [{ id: "section-1-1", history: ["1949, S. 1"], annotations: ["The court construed this section."] }]);
  assert.equal(manifest.shards[0].sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("maps every citation to its chapter and section route key", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-citations-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, "data");
  const outputDir = path.join(root, "output");
  await mkdir(path.join(dataDirectory, "chapters"), { recursive: true });
  await writeFile(path.join(dataDirectory, "chapters", "319v.json"), JSON.stringify({
    sections: [
      { id: "section-17b-238", citation: "17b-238", citations: ["17b-238"], content: {} },
      { id: "sections-17b-234-235", citation: "17b-234", citations: ["17b-234", "17B-235"], content: {} }
    ]
  }));
  const catalog = {
    schemaVersion: "1.0.0",
    titles: [{ id: "title-17b", number: "17b", name: "Social Services", chapters: [{ id: "chapter-319v", number: "319v", path: "chapters/319v.json" }] }]
  };

  const manifest = await generateSearchV2Artifacts({
    catalog,
    dataDirectory,
    supplementsDir: path.join(root, "supplements"),
    outputDir,
    generatedAt: "2026-07-18T00:00:00.000Z"
  });
  assert.equal(manifest.citationShards[0].path, "citations/title-17b.json");
  const bytes = await readFile(path.join(outputDir, "citations", "title-17b.json"));
  assert.deepEqual(JSON.parse(bytes).sections, {
    "17b-238": ["319v", "17b-238"],
    "17b-234": ["319v", "17b-234"],
    "17b-235": ["319v", "17b-234"]
  });
  assert.equal(manifest.citationShards[0].sha256, createHash("sha256").update(bytes).digest("hex"));
});
