import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// One identity covers every published dataset, including derived indexes and manifests.
export async function generateDataRelease(directory) {
  const artifacts = [];
  async function visit(relative = "") {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else if (entry.name.endsWith(".json") && name !== "release.json") {
        const bytes = await readFile(path.join(directory, name));
        artifacts.push({ path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  }
  await visit();
  artifacts.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const id = createHash("sha256").update(JSON.stringify(artifacts)).digest("hex");
  const release = { version: 1, id, artifacts };
  await writeFile(path.join(directory, "release.json"), JSON.stringify(release) + "\n");
  return release;
}
