import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { renderRepositoryMapMarkdown, repositoryMapPage } from "./repository-map-page.mjs";

export async function buildRepositoryMap({ root, output }) {
  const sourceFile = path.join(root, "docs", "repository-map.md");
  const source = await readFile(sourceFile, "utf8");
  const { html, diagrams } = renderRepositoryMapMarkdown(source, { root, sourceFile });
  const directory = path.join(output, "repository-map");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), repositoryMapPage(html, diagrams), "utf8");
  await build({
    entryPoints: [path.join(root, "scripts", "repository-map-client.mjs")],
    outfile: path.join(directory, "map.js"),
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  return { diagrams };
}
