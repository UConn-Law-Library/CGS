import { mergeSearchResults, searchDocumentBatch } from "./search.js";

export function createSearchState({ query, limit = 50, total = 0 } = {}) {
  return { query, limit, total, processed: 0, totalMatches: 0, supplementUnavailable: false, results: [] };
}

export function addShardToSearch(state, shard) {
  const documents = shard.documents.map((document) => ({ ...document, title: shard.title }));
  const batch = searchDocumentBatch(documents, state.query, { limit: state.limit });
  state.results = mergeSearchResults(state.results, batch.results, { limit: state.limit });
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
    results: state.results
  };
}

if (typeof self !== "undefined" && self.addEventListener) {
  const searches = new Map();
  self.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "start") {
      searches.set(message.requestId, createSearchState(message));
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
      self.postMessage(searchUpdate(message.requestId, state));
      return;
    }
    if (message.type === "finish") {
      self.postMessage(searchUpdate(message.requestId, state, true));
      searches.delete(message.requestId);
    }
  });
}
