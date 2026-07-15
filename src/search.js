import { mergeSupplementSearchShard } from "./supplements.js";

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

function lexQuery(query) {
  const input = String(query ?? "");
  const tokens = [];
  let cursor = 0;
  while (cursor < input.length) {
    if (/\s/u.test(input[cursor])) {
      cursor += 1;
      continue;
    }
    if (input[cursor] === "(") {
      tokens.push({ type: "LPAREN" });
      cursor += 1;
      continue;
    }
    if (input[cursor] === ")") {
      tokens.push({ type: "RPAREN" });
      cursor += 1;
      continue;
    }
    if (input[cursor] === '"') {
      cursor += 1;
      let value = "";
      let closed = false;
      while (cursor < input.length) {
        if (input[cursor] === "\\" && ['"', "\\"].includes(input[cursor + 1])) {
          value += input[cursor + 1];
          cursor += 2;
        } else if (input[cursor] === '"') {
          cursor += 1;
          closed = true;
          break;
        } else {
          value += input[cursor];
          cursor += 1;
        }
      }
      if (!closed) throw new SyntaxError("Boolean search has an unclosed quoted phrase.");
      const normalized = normalizeText(value);
      if (!normalized) throw new SyntaxError("Boolean search phrases cannot be empty.");
      tokens.push({ type: "TERM", value: normalized, phrase: true });
      continue;
    }
    const start = cursor;
    while (cursor < input.length && !/[\s()"]/u.test(input[cursor])) cursor += 1;
    const raw = input.slice(start, cursor);
    const operator = raw.toUpperCase();
    if (["AND", "OR", "NOT"].includes(operator)) tokens.push({ type: operator });
    else {
      const normalized = normalizeText(raw);
      if (normalized) tokens.push({ type: "TERM", value: normalized, phrase: false });
    }
  }
  const expanded = [];
  for (const token of tokens) {
    const previous = expanded.at(-1);
    if (previous && ["TERM", "RPAREN"].includes(previous.type)
      && ["TERM", "LPAREN", "NOT"].includes(token.type)) {
      expanded.push({ type: "AND", implicit: true });
    }
    expanded.push(token);
  }
  return expanded;
}

function parseQuery(tokens) {
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const primary = () => {
    const token = take();
    if (!token) throw new SyntaxError("Boolean search is missing a term.");
    if (token.type === "TERM") return { type: "term", value: token.value, phrase: token.phrase };
    if (token.type === "LPAREN") {
      const expression = orExpression();
      if (peek()?.type !== "RPAREN") throw new SyntaxError("Boolean search has an unclosed parenthesis.");
      take();
      return expression;
    }
    throw new SyntaxError(`Boolean search expected a term near ${token.type}.`);
  };
  const notExpression = () => peek()?.type === "NOT"
    ? (take(), { type: "not", child: notExpression() })
    : primary();
  const andExpression = () => {
    let left = notExpression();
    while (peek()?.type === "AND") {
      take();
      left = { type: "and", left, right: notExpression() };
    }
    return left;
  };
  const orExpression = () => {
    let left = andExpression();
    while (peek()?.type === "OR") {
      take();
      left = { type: "or", left, right: andExpression() };
    }
    return left;
  };
  const expression = orExpression();
  if (peek()) {
    if (peek().type === "RPAREN") throw new SyntaxError("Boolean search has an unmatched closing parenthesis.");
    throw new SyntaxError(`Boolean search could not interpret ${peek().type}.`);
  }
  return expression;
}

function positiveTerms(node, negated = false, terms = []) {
  if (node.type === "term" && !negated) terms.push(node);
  else if (node.type === "not") positiveTerms(node.child, !negated, terms);
  else if (node.left) {
    positiveTerms(node.left, negated, terms);
    positiveTerms(node.right, negated, terms);
  }
  return terms;
}

export function compileSearchQuery(query) {
  const tokens = lexQuery(query);
  if (!tokens.length) throw new SyntaxError("Enter a search term.");
  const expression = parseQuery(tokens);
  const seen = new Set();
  const positives = positiveTerms(expression).filter((term) => {
    const key = `${term.phrase ? "phrase" : "term"}:${term.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { expression, positives };
}

function documentFields(document) {
  const citation = normalizeText(document.citation ?? "");
  const citations = (document.citations ?? []).map(normalizeText);
  const heading = normalizeText(document.heading);
  const body = normalizeText(document.text);
  const haystack = `${citations.join(" ")} ${heading} ${body}`;
  return { citation, citations, heading, body, haystack };
}

function matchesExpression(node, fields) {
  if (node.type === "term") return fields.haystack.includes(node.value);
  if (node.type === "not") return !matchesExpression(node.child, fields);
  if (node.type === "and") return matchesExpression(node.left, fields) && matchesExpression(node.right, fields);
  return matchesExpression(node.left, fields) || matchesExpression(node.right, fields);
}

function scoreCompiledDocument(document, compiled) {
  const fields = documentFields(document);
  if (!matchesExpression(compiled.expression, fields)) return 0;

  let score = 1;
  for (const term of compiled.positives) {
    if (fields.citation === term.value || fields.citations.includes(term.value)) score += 120;
    else if (fields.citations.some((value) => value.startsWith(term.value))) score += 55;
    if (fields.heading === term.value) score += 50;
    else if (fields.heading.includes(term.value)) score += term.phrase ? 36 : 28;
    if (fields.body.includes(term.value)) score += term.phrase ? 18 : 10;
    if (fields.citations.some((value) => value.includes(term.value))) score += 18;
    if (fields.heading.includes(term.value)) score += 8;
    if (fields.body.includes(term.value)) score += 2;
  }
  if (document.status !== "active") score -= 0.25;
  return score;
}

export function scoreDocument(document, query) {
  return scoreCompiledDocument(document, compileSearchQuery(query));
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

export function searchDocumentBatch(documents, query, { limit = 50 } = {}) {
  const compiled = compileSearchQuery(query);
  const matches = documents
    .map((document) => ({ document, score: scoreCompiledDocument(document, compiled) }))
    .filter((result) => result.score > 0)
    .sort(compareSearchResults);
  return { results: matches.slice(0, limit), totalMatches: matches.length };
}

export function searchDocuments(documents, query, options = {}) {
  return searchDocumentBatch(documents, query, options).results;
}

function abortError() {
  return new DOMException("Search cancelled", "AbortError");
}

export class SearchRepository {
  #baseUrl;
  #fetch;
  #manifest;
  #shards = new Map();
  #supplements;

  constructor({ baseUrl = "./data/search/", fetchImpl = globalThis.fetch, supplementRepository = null } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
    this.#supplements = supplementRepository;
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
    const supplement = this.#supplements
      ? this.#supplements.loadLatestSearchTitle(titleId)
        .then((shard) => ({ shard, unavailable: false }))
        .catch(() => ({ shard: null, unavailable: true }))
      : Promise.resolve({ shard: null, unavailable: false });
    const promise = Promise.all([this.#json(entry.path), supplement]).then(([baseShard, supplementResult]) => ({
      ...mergeSupplementSearchShard(baseShard, supplementResult.shard),
      supplementUnavailable: supplementResult.unavailable
    })).catch((error) => {
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
