import { compileSearchQuery, mergeSearchResults, searchDocumentBatch } from "./search.js";

function abortError() {
  return new DOMException("Search cancelled", "AbortError");
}

function defaultWorkerFactory(url) {
  return typeof Worker === "undefined" ? null : new Worker(url, { type: "module" });
}

export class ProgressiveSearchClient {
  #repository;
  #worker;
  #pending = new Map();
  #nextRequestId = 0;

  constructor({
    repository,
    workerFactory = defaultWorkerFactory,
    workerUrl = new URL("./search-worker.js", import.meta.url)
  }) {
    this.#repository = repository;
    try {
      this.#worker = workerFactory(workerUrl);
    } catch {
      this.#worker = null;
    }
    this.#worker?.addEventListener("message", (event) => this.#handleMessage(event.data));
    this.#worker?.addEventListener("error", (event) => this.#handleWorkerError(event));
  }

  async search(query, { titleIds, limit = 50, onProgress, signal } = {}) {
    if (signal?.aborted) throw abortError();
    compileSearchQuery(query);
    const manifest = await this.#repository.init();
    const ids = titleIds?.length ? titleIds : manifest.shards.map((shard) => shard.titleId);
    if (signal?.aborted) throw abortError();
    if (!this.#worker) return this.#searchInline(query, ids, { limit, onProgress, signal });

    const requestId = ++this.#nextRequestId;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.#worker?.postMessage({ type: "cancel", requestId });
        this.#settle(requestId, { reject, error: abortError() });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(requestId, { resolve, reject, onProgress, signal, onAbort });
      this.#worker.postMessage({ type: "start", requestId, query, limit, total: ids.length });

      this.#repository.loadTitles(ids, {
        signal,
        onTitle: (shard) => this.#worker?.postMessage({ type: "shard", requestId, shard })
      }).then(() => {
        if (!signal?.aborted) this.#worker?.postMessage({ type: "finish", requestId });
      }).catch((error) => {
        this.#worker?.postMessage({ type: "cancel", requestId });
        this.#settle(requestId, { reject, error });
      });
    });
  }

  async #searchInline(query, ids, { limit, onProgress, signal }) {
    let results = [];
    let totalMatches = 0;
    let supplementUnavailable = false;
    await this.#repository.loadTitles(ids, {
      signal,
      onTitle(shard, progress) {
        const documents = shard.documents.map((document) => ({ ...document, title: shard.title }));
        const batch = searchDocumentBatch(documents, query, { limit });
        results = mergeSearchResults(results, batch.results, { limit });
        totalMatches += batch.totalMatches;
        supplementUnavailable ||= Boolean(shard.supplementUnavailable);
        onProgress?.({ ...progress, results, totalMatches, supplementUnavailable, complete: false });
      }
    });
    const outcome = { results, totalMatches, supplementUnavailable };
    onProgress?.({ completed: ids.length, total: ids.length, ...outcome, complete: true });
    return outcome;
  }

  #handleMessage(message) {
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    const progress = {
      completed: message.processed,
      total: message.total,
      totalMatches: message.totalMatches,
      supplementUnavailable: message.supplementUnavailable,
      results: message.results,
      complete: message.type === "complete"
    };
    pending.onProgress?.(progress);
    if (message.type === "complete") this.#settle(message.requestId, {
      resolve: pending.resolve,
      value: {
        results: message.results,
        totalMatches: message.totalMatches,
        supplementUnavailable: message.supplementUnavailable
      }
    });
  }

  #handleWorkerError(error) {
    this.#worker = null;
    for (const [requestId, pending] of this.#pending) {
      this.#settle(requestId, { reject: pending.reject, error: error.error ?? new Error("Search worker failed") });
    }
  }

  #settle(requestId, { resolve, reject, value, error }) {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    pending.signal?.removeEventListener("abort", pending.onAbort);
    this.#pending.delete(requestId);
    if (error) reject(error);
    else resolve(value);
  }
}
