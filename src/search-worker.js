import { mergeSearchResults, searchDocumentBatch } from "./search.js";

export function createSearchState({ query, limit = 50, total = 0, searchOptions = {} } = {}) {
  return { query, limit, total, searchOptions, processed: 0, totalMatches: 0, supplementUnavailable: false, results: [] };
}

export function addShardToSearch(state, shard) {
  const documents = shard.documents.map((document) => ({ ...document, title: shard.title }));
  const batch = searchDocumentBatch(documents, state.query, { limit: Infinity, ...state.searchOptions });
  state.results = mergeSearchResults(state.results, batch.results, { limit: Infinity, sort: state.searchOptions.sort });
  state.totalMatches += batch.totalMatches;
  state.supplementUnavailable ||= Boolean(shard.supplementUnavailable);
  state.processed += 1;
  return state;
}

export function searchUpdate(requestId, state, complete = false) {
  return {
    type: complete ? "complete" : "progress",
    requestId,
    processed: state.processed,
    total: state.total,
    totalMatches: state.totalMatches,
    supplementUnavailable: state.supplementUnavailable,
    results: state.results.slice(0, state.limit)
  };
}

export function createSearchWorkerHandler(postMessage) {
  const searches = new Map();
  let completed = null;
  return (message) => {
    if (message.type === "start") {
      if (completed && completed.cacheKey === message.cacheKey) {
        postMessage(searchUpdate(message.requestId, { ...completed, limit: message.limit }, true));
        return;
      }
      searches.set(message.requestId, { ...createSearchState(message), cacheKey: message.cacheKey });
      return;
    }
    if (message.type === "cancel") {
      searches.delete(message.requestId);
      return;
    }

    const state = searches.get(message.requestId);
    if (!state) return;
    if (message.type === "shard") {
      addShardToSearch(state, message.shard);
      postMessage(searchUpdate(message.requestId, state));
      return;
    }
    if (message.type === "finish") {
      completed = state.supplementUnavailable ? null : state;
      postMessage(searchUpdate(message.requestId, state, true));
      searches.delete(message.requestId);
    }
  };
}

if (typeof self !== "undefined" && self.addEventListener) {
  const handle = createSearchWorkerHandler((message) => self.postMessage(message));
  self.addEventListener("message", (event) => handle(event.data));
}
