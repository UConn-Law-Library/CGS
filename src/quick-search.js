import { getJson, retryableLoader } from "./data-loader.js";
import { navigationSectionDescription } from "./reader.js";
import { findTitle, routeHref } from "./routes.js";

// Autocomplete reads citations and headings only. Full Boolean/body search is explicit.
export class QuickSearchRepository {
  #manifest;
  #shards = new Map();
  #repository;
  constructor(repository) {
    this.#repository = repository;
    this.#manifest = retryableLoader(() => getJson("./data/search-v2/manifest.json"));
  }

  async search(query, catalog, { signal, onProgress, limit = 5 } = {}) {
    const wanted = query.trim().toLowerCase().replace(/^(?:c\.g\.s\.\s*)?(?:§|sec\.)\s*/i, "");
    if (/^\d+[a-z]*-\d+[a-z0-9-]*$/.test(wanted)) {
      const title = findTitle(catalog, wanted.split("-")[0]);
      if (title) {
        const citations = await this.#repository.loadCitations(title.id);
        const target = citations[wanted];
        if (signal?.aborted) return [];
        if (target) return [{ kind: "Section", label: `Sec. ${wanted}`, subtitle: `Title ${title.number}, Chapter ${target[0]}`, href: routeHref({ title: title.number, chapter: target[0], section: target[1] }) }];
      }
    }
    const manifest = await this.#manifest();
    const entries = manifest.headingShards ?? [];
    const titles = new Map(catalog.titles.map((title) => [title.id, title]));
    const words = wanted.split(/\s+/).filter(Boolean);
    let cursor = 0;
    let completed = 0;
    let matches = [];
    const worker = async () => {
      while (cursor < entries.length && !signal?.aborted) {
        const entry = entries[cursor++];
        if (!this.#shards.has(entry.path)) {
          this.#shards.set(entry.path, getJson(`./data/search-v2/${entry.path}`).catch((error) => {
            this.#shards.delete(entry.path);
            throw error;
          }));
        }
        const shard = await this.#shards.get(entry.path);
        if (signal?.aborted) return;
        const title = titles.get(entry.titleId);
        if (!title) continue;
        for (const [section, chapter, heading, citations] of shard.headings) {
          const text = `${citations.join(" ")} ${heading}`.toLowerCase();
          if (!words.every((word) => text.includes(word))) continue;
          matches.push({ kind: "Section", label: `Sec. ${section}`, subtitle: `${navigationSectionDescription({ heading })} · Title ${title.number}, Chapter ${chapter}`,
            href: routeHref({ title: title.number, chapter, section }), score: citations.includes(wanted) ? 0 : heading.toLowerCase().startsWith(wanted) ? 1 : 2 });
        }
        matches.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, "en", { numeric: true }));
        matches = matches.slice(0, limit);
        onProgress?.({ results: matches, completed: ++completed, total: entries.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
    return matches;
  }
}
