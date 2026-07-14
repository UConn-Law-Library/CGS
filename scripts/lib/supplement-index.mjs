import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SCHEMA_VERSION } from "./importer.mjs";

export async function generateSupplementIndex({ supplementsDir, outputDir, generatedAt }) {
  const source = path.resolve(supplementsDir);
  const editions = [];
  if ((await stat(source).catch(() => null))?.isDirectory()) {
    const names = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const manifest = JSON.parse(await readFile(path.join(source, name, "manifest.json"), "utf8"));
      editions.push({
        editionYear: manifest.editionYear,
        generatedAt: manifest.generatedAt,
        path: `${name}/manifest.json`,
        counts: manifest.counts
      });
    }
  }
  const index = { schemaVersion: SCHEMA_VERSION, generatedAt, editions };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}
