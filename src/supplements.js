import { comparableNumber } from "./routes.js";

export { applyChapterOverlay } from "./supplement-overlay.js";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function mergeSupplementTitleChapters(title, supplementTitle, editionYear) {
  if (!supplementTitle) return title;
  const knownIds = new Set(title.chapters.map((chapter) => chapter.id));
  const knownNumbers = new Set(title.chapters.map((chapter) => comparableNumber(chapter.number)));
  const additions = supplementTitle.chapters
    .filter((chapter) => !knownIds.has(chapter.id) && !knownNumbers.has(comparableNumber(chapter.number)))
    .map((chapter) => ({
      ...chapter,
      supplementOnly: true,
      supplementEditionYear: editionYear
    }));
  if (!additions.length) return title;
  return {
    ...title,
    chapters: [...title.chapters, ...additions].sort((left, right) =>
      collator.compare(comparableNumber(left.number), comparableNumber(right.number)))
  };
}

export function mergeSupplementSearchShard(baseShard, supplementShard) {
  if (!supplementShard) return baseShard;
  if (baseShard.title?.id !== supplementShard.title?.id) throw new Error("Supplement search shard does not match base title");
  const removed = new Set(supplementShard.removedDocumentIds ?? []);
  return {
    ...baseShard,
    documents: [
      ...baseShard.documents.filter((document) => !removed.has(document.id)),
      ...supplementShard.documents
    ]
  };
}

export class SupplementRepository {
  #baseUrl;
  #fetch;
  #index;
  #manifests = new Map();
  #chapters = new Map();
  #searchShards = new Map();

  constructor({ baseUrl = "./data/supplements/", fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async #json(relativePath) {
    const response = await this.#fetch(new URL(relativePath, this.#baseUrl));
    if (!response.ok) throw new Error(`Could not load supplement ${relativePath} (${response.status})`);
    return response.json();
  }

  async init() {
    this.#index ??= await this.#json("manifest.json");
    return this.#index;
  }

  #cachedJson(cache, key, path) {
    if (!cache.has(key)) {
      cache.set(key, this.#json(path).catch((error) => {
        cache.delete(key);
        throw error;
      }));
    }
    return cache.get(key);
  }

  async latestEdition() {
    const index = await this.init();
    return [...index.editions].sort((left, right) => right.editionYear - left.editionYear)[0] ?? null;
  }

  async loadEdition(editionYear) {
    const index = await this.init();
    const entry = index.editions.find((edition) => edition.editionYear === Number(editionYear));
    if (!entry) throw new Error(`Supplement edition ${editionYear} is not available`);
    return this.#cachedJson(this.#manifests, entry.editionYear, entry.path);
  }

  async loadChapter(editionYear, chapterNumber, titleId = null) {
    const manifest = await this.loadEdition(editionYear);
    const wanted = comparableNumber(chapterNumber);
    const titles = titleId ? manifest.titles.filter((title) => title.id === titleId) : manifest.titles;
    const chapter = titles
      .flatMap((title) => title.chapters)
      .find((entry) => comparableNumber(entry.number) === wanted);
    if (!chapter) return null;
    const key = `${editionYear}:${chapter.path}`;
    return this.#cachedJson(this.#chapters, key, `${editionYear}/${chapter.path}`);
  }

  async loadLatestChapter(chapterNumber, titleId = null) {
    const edition = await this.latestEdition();
    return { edition, chapter: edition ? await this.loadChapter(edition.editionYear, chapterNumber, titleId) : null };
  }

  async loadLatestTitle(titleId) {
    const edition = await this.latestEdition();
    if (!edition) return { edition: null, title: null };
    const manifest = await this.loadEdition(edition.editionYear);
    return { edition, title: manifest.titles.find((title) => title.id === titleId) ?? null };
  }

  async loadSearchTitle(editionYear, titleId) {
    const manifest = await this.loadEdition(editionYear);
    const title = manifest.titles.find((entry) => entry.id === titleId);
    if (!title?.searchPath) return null;
    const key = `${editionYear}:${title.searchPath}`;
    return this.#cachedJson(this.#searchShards, key, `${editionYear}/${title.searchPath}`);
  }

  async loadLatestSearchTitle(titleId) {
    const edition = await this.latestEdition();
    return edition ? this.loadSearchTitle(edition.editionYear, titleId) : null;
  }
}
