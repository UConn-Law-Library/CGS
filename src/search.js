export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[§]/g, " ")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, " ")
    .trim();
}

export function tokenize(value) {
  return normalizeText(value).match(/[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*/gu) ?? [];
}

export function scoreDocument(document, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;
  const terms = [...new Set(tokenize(normalizedQuery))];
  const citation = normalizeText(document.citation ?? "");
  const citations = (document.citations ?? []).map(normalizeText);
  const heading = normalizeText(document.heading);
  const body = normalizeText(document.text);
  const haystack = `${citations.join(" ")} ${heading} ${body}`;
  if (!terms.every((term) => haystack.includes(term))) return 0;

  let score = 1;
  if (citation === normalizedQuery || citations.includes(normalizedQuery)) score += 120;
  else if (citations.some((value) => value.startsWith(normalizedQuery))) score += 55;
  if (heading === normalizedQuery) score += 50;
  else if (heading.includes(normalizedQuery)) score += 28;
  if (body.includes(normalizedQuery)) score += 10;
  for (const term of terms) {
    if (citations.some((value) => value.includes(term))) score += 18;
    if (heading.includes(term)) score += 8;
    if (body.includes(term)) score += 2;
  }
  if (document.status !== "active") score -= 0.25;
  return score;
}

export function compareSearchResults(left, right) {
  return right.score - left.score
    || String(left.document.citation ?? left.document.citations?.[0] ?? "").localeCompare(
      String(right.document.citation ?? right.document.citations?.[0] ?? ""),
      "en",
      { numeric: true }
    )
    || String(left.document.title?.number ?? "").localeCompare(String(right.document.title?.number ?? ""), "en", { numeric: true })
    || String(left.document.chapter?.number ?? "").localeCompare(String(right.document.chapter?.number ?? ""), "en", { numeric: true })
    || String(left.document.id).localeCompare(String(right.document.id));
}

export function mergeSearchResults(current, incoming, { limit = 50 } = {}) {
  return [...current, ...incoming].sort(compareSearchResults).slice(0, limit);
}

export function searchDocuments(documents, query, { limit = 50 } = {}) {
  return documents
    .map((document) => ({ document, score: scoreDocument(document, query) }))
    .filter((result) => result.score > 0)
    .sort(compareSearchResults)
    .slice(0, limit);
}

function abortError() {
  return new DOMException("Search cancelled", "AbortError");
}

export class SearchRepository {
  #baseUrl;
  #fetch;
  #manifest;
  #shards = new Map();

  constructor({ baseUrl = "./data/search/", fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async #json(relativePath) {
    const response = await this.#fetch(new URL(relativePath, this.#baseUrl));
    if (!response.ok) throw new Error(`Could not load ${relativePath} (${response.status})`);
    return response.json();
  }

  async init() {
    this.#manifest ??= await this.#json("manifest.json");
    return this.#manifest;
  }

  async loadTitle(titleId) {
    await this.init();
    if (this.#shards.has(titleId)) return this.#shards.get(titleId);
    const entry = this.#manifest.shards.find((shard) => shard.titleId === titleId);
    if (!entry) throw new Error(`No search shard for ${titleId}`);
    const promise = this.#json(entry.path).catch((error) => {
      this.#shards.delete(titleId);
      throw error;
    });
    this.#shards.set(titleId, promise);
    return promise;
  }

  async loadTitles(titleIds, { concurrency = 6, onTitle, signal } = {}) {
    const manifest = await this.init();
    const ids = titleIds?.length ? titleIds : manifest.shards.map((shard) => shard.titleId);
    const total = ids.length;
    let cursor = 0;
    let completed = 0;

    const loadNext = async () => {
      while (cursor < total) {
        if (signal?.aborted) throw abortError();
        const index = cursor++;
        const titleId = ids[index];
        const shard = await this.loadTitle(titleId);
        if (signal?.aborted) throw abortError();
        completed += 1;
        await onTitle?.(shard, { completed, total, titleId, index });
      }
    };

    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), total) }, loadNext));
    return { completed, total };
  }

  async search(query, { titleIds, limit = 50 } = {}) {
    const documents = [];
    await this.loadTitles(titleIds, {
      onTitle(shard) {
        documents.push(...shard.documents.map((document) => ({ ...document, title: shard.title })));
      }
    });
    return searchDocuments(documents, query, { limit });
  }
}
