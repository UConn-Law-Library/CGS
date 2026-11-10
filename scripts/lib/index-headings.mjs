import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Every subject index heading, without its entries, so the index tree's filter can search all
// letters at once. The full index is about 40 MB; this list is a few hundred kilobytes.
export async function generateIndexHeadings({ indexDir, outputFile }) {
  const manifest = JSON.parse(await readFile(path.join(indexDir, "manifest.json"), "utf8"));
  const letters = {};
  let count = 0;
  for (const shard of manifest.shards) {
    const artifact = JSON.parse(await readFile(path.join(indexDir, shard.path), "utf8"));
    letters[shard.key] ??= [];
    for (const heading of artifact.headings) {
      letters[shard.key].push([heading.id, heading.label]);
      count += 1;
    }
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify({ schemaVersion: "1.0.0", generatedAt: manifest.generatedAt, letters }));
  return { count };
}
