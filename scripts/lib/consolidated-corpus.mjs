import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { applyChapterOverlay } from "./supplement-overlay.mjs";
import { mergeSupplementTitleChapters } from "../../src/supplements.js";

export async function consolidatedCorpus(catalog, dataDirectory) {
  const root = path.join(dataDirectory, "supplements");
  const years = (await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name)).map((entry) => Number(entry.name));
  const year = years.length ? Math.max(...years) : null;
  const manifest = year ? JSON.parse(await readFile(path.join(root, String(year), "manifest.json"), "utf8")) : null;
  const titles = catalog.titles.map((title) => {
    const merged = mergeSupplementTitleChapters(title, manifest?.titles.find((entry) => entry.id === title.id), year);
    return { ...merged, chapters: merged.chapters.map((chapter) => ({ ...chapter })) };
  });
  return {
    catalog: { ...catalog, counts: { ...catalog.counts }, titles },
    async loadChapter(title, chapter) {
      const base = catalog.titles.find((entry) => entry.id === title.id)?.chapters.find((entry) => entry.id === chapter.id);
      const overlay = manifest?.titles.find((entry) => entry.id === title.id)?.chapters.find((entry) => entry.id === chapter.id);
      const read = async (file) => JSON.parse(await readFile(file, "utf8"));
      const original = base ? await read(path.join(dataDirectory, base.path)) : null;
      return overlay ? applyChapterOverlay(original, await read(path.join(root, String(year), overlay.path)), year).chapter : original;
    }
  };
}
