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

const SEARCH_FIELDS = ["citation", "heading", "body", "history", "annotations"];
const SEARCH_FIELD_SET = new Set(["statute", "all", ...SEARCH_FIELDS]);
const SEARCH_STATUS_SET = new Set(["active", "mixed", "obsolete", "repealed", "reserved", "transferred"]);
const SEARCH_SUPPLEMENT_SET = new Set(["updated", "base"]);
const SEARCH_SORT_SET = new Set(["relevance", "citation"]);

export function normalizeSearchOptions(options = {}) {
  const field = SEARCH_FIELD_SET.has(options.field) ? options.field : "statute";
  const status = SEARCH_STATUS_SET.has(options.status) ? options.status : null;
  const supplement = SEARCH_SUPPLEMENT_SET.has(options.supplement) ? options.supplement : null;
  const sort = SEARCH_SORT_SET.has(options.sort) ? options.sort : "relevance";
  return {
    field,
    status,
    supplement,
    sort,
    chapter: String(options.chapter ?? "").trim() || null,
    within: String(options.within ?? "").trim() || null
  };
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
      tokens.push({ type: "TERM", value: normalized, phrase: true, prefix: false });
      continue;
    }
    const start = cursor;
    while (cursor < input.length && !/[\s()"]/u.test(input[cursor])) cursor += 1;
    const raw = input.slice(start, cursor);
    const operator = raw.toUpperCase();
    const near = operator.match(/^NEAR\/(\d+)$/);
    if (near) {
      const distance = Number(near[1]);
      if (distance < 1 || distance > 100) throw new SyntaxError("NEAR proximity must be between 1 and 100 words.");
      tokens.push({ type: "NEAR", distance });
    } else if (["AND", "OR", "NOT"].includes(operator)) tokens.push({ type: operator });
    else {
      if (raw.includes("*") && !/^[^*]+\*$/.test(raw)) {
        throw new SyntaxError("Wildcards are supported only as one trailing asterisk, such as tax*.");
      }
      const prefix = raw.endsWith("*");
      const normalized = normalizeText(prefix ? raw.slice(0, -1) : raw);
      if (normalized) tokens.push({ type: "TERM", value: normalized, phrase: false, prefix });
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
    if (token.type === "TERM") return { type: "term", value: token.value, phrase: token.phrase, prefix: token.prefix };
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
  const nearExpression = () => {
    let left = notExpression();
    while (peek()?.type === "NEAR") {
      const operator = take();
      const right = notExpression();
      if (left.type !== "term" || right.type !== "term") {
        throw new SyntaxError("NEAR/n requires a word, prefix, or quoted phrase on each side.");
      }
      left = { type: "near", distance: operator.distance, left, right };
    }
    return left;
  };
  const andExpression = () => {
    let left = nearExpression();
    while (peek()?.type === "AND") {
      const operator = take();
      left = { type: "and", left, right: nearExpression(), implicit: Boolean(operator.implicit) };
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
    const key = `${term.phrase ? "phrase" : term.prefix ? "prefix" : "term"}:${term.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { expression, positives, explanation: formatExpression(expression) };
}

function formatExpression(node, parentPrecedence = 0) {
  const precedence = { or: 1, and: 2, near: 3, not: 4, term: 5 }[node.type];
  let value;
  if (node.type === "term") value = node.phrase ? `"${node.value}"` : `${node.value}${node.prefix ? "*" : ""}`;
  else if (node.type === "not") value = `NOT ${formatExpression(node.child, precedence)}`;
  else {
    const operator = node.type === "near" ? `NEAR/${node.distance}` : node.type.toUpperCase();
    value = `${formatExpression(node.left, precedence)} ${operator} ${formatExpression(node.right, precedence)}`;
  }
  return precedence < parentPrecedence ? `(${value})` : value;
}

function combinedCompiledQuery(query, options = {}) {
  const normalizedOptions = normalizeSearchOptions(options);
  const primary = compileSearchQuery(query);
  if (!normalizedOptions.within) return { ...primary, options: normalizedOptions };
  const within = compileSearchQuery(normalizedOptions.within);
  const positives = [];
  const seen = new Set();
  for (const term of [...primary.positives, ...within.positives]) {
    const key = `${term.phrase ? "phrase" : term.prefix ? "prefix" : "term"}:${term.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      positives.push(term);
    }
  }
  const expression = { type: "and", left: primary.expression, right: within.expression, implicit: false };
  return { expression, positives, explanation: formatExpression(expression), options: normalizedOptions };
}

export function explainSearchQuery(query, options = {}) {
  return combinedCompiledQuery(query, options).explanation;
}

function documentFields(document) {
  const citation = normalizeText(document.citation ?? "");
  const citations = (document.citations ?? []).map(normalizeText);
  const values = {
    citation: citations.join(" "),
    heading: normalizeText(document.heading),
    body: normalizeText(document.text),
    history: normalizeText(Array.isArray(document.history) ? document.history.join(" ") : document.history),
    annotations: normalizeText(Array.isArray(document.annotations)
      ? document.annotations.map((annotation) => annotation?.text ?? annotation).join(" ")
      : document.annotations)
  };
  const entries = Object.fromEntries(SEARCH_FIELDS.map((name) => [name, {
    text: values[name],
    tokens: tokenize(values[name])
  }]));
  return { citation, citations, entries };
}

function selectedFieldNames(field) {
  if (field === "all") return SEARCH_FIELDS;
  if (field === "statute") return ["citation", "heading", "body"];
  return [field];
}

function termTokens(term) {
  return tokenize(term.value);
}

function termPositions(entry, term) {
  const needles = termTokens(term);
  if (!needles.length) return [];
  const positions = [];
  const width = needles.length;
  for (let index = 0; index <= entry.tokens.length - width; index += 1) {
    const matches = needles.every((needle, offset) => {
      const token = entry.tokens[index + offset];
      return term.prefix && offset === width - 1 ? token.startsWith(needle) : token === needle;
    });
    if (matches) positions.push(index);
  }
  return positions;
}

function entryMatchesTerm(entry, term) {
  if (!entry.text) return false;
  if (term.phrase) return entry.text.includes(term.value);
  return termPositions(entry, term).length > 0;
}

function entryMatchesNear(entry, node) {
  const left = termPositions(entry, node.left);
  const right = termPositions(entry, node.right);
  return left.some((leftIndex) => right.some((rightIndex) => Math.abs(leftIndex - rightIndex) <= node.distance));
}

function matchesExpression(node, fields, fieldNames) {
  if (node.type === "term") return fieldNames.some((name) => entryMatchesTerm(fields.entries[name], node));
  if (node.type === "near") return fieldNames.some((name) => entryMatchesNear(fields.entries[name], node));
  if (node.type === "not") return !matchesExpression(node.child, fields, fieldNames);
  if (node.type === "and") return matchesExpression(node.left, fields, fieldNames) && matchesExpression(node.right, fields, fieldNames);
  return matchesExpression(node.left, fields, fieldNames) || matchesExpression(node.right, fields, fieldNames);
}

function scoreCompiledDocument(document, compiled) {
  const fields = documentFields(document);
  const fieldNames = selectedFieldNames(compiled.options.field);
  if (!matchesExpression(compiled.expression, fields, fieldNames)) return null;

  let score = 1;
  for (const term of compiled.positives) {
    if (fieldNames.includes("citation")) {
      if (fields.citation === term.value || fields.citations.includes(term.value)) score += 120;
      else if (term.prefix && fields.citations.some((value) => value.startsWith(term.value))) score += 55;
      else if (entryMatchesTerm(fields.entries.citation, term)) score += 30;
    }
    if (fieldNames.includes("heading") && entryMatchesTerm(fields.entries.heading, term)) score += term.phrase ? 44 : 34;
    if (fieldNames.includes("body") && entryMatchesTerm(fields.entries.body, term)) score += term.phrase ? 20 : 12;
    if (fieldNames.includes("history") && entryMatchesTerm(fields.entries.history, term)) score += term.phrase ? 16 : 9;
    if (fieldNames.includes("annotations") && entryMatchesTerm(fields.entries.annotations, term)) score += term.phrase ? 14 : 8;
  }
  if (document.status !== "active") score -= 0.25;
  const matchedFields = fieldNames.filter((name) => compiled.positives.some((term) => entryMatchesTerm(fields.entries[name], term)));
  return { score, matchedFields };
}

function documentMatchesFilters(document, options) {
  if (options.chapter && ![document.chapter?.id, document.chapter?.number].some((value) => String(value ?? "") === options.chapter)) return false;
  if (options.status && document.status !== options.status) return false;
  if (options.supplement === "updated" && !document.supplement) return false;
  if (options.supplement === "base" && document.supplement) return false;
  return true;
}

export function scoreDocument(document, query, options = {}) {
  const outcome = scoreCompiledDocument(document, combinedCompiledQuery(query, options));
  return outcome?.score ?? 0;
}

function citationOrder(left, right) {
  return String(left.document.citation ?? left.document.citations?.[0] ?? "").localeCompare(
      String(right.document.citation ?? right.document.citations?.[0] ?? ""),
      "en",
      { numeric: true }
    )
    || String(left.document.title?.number ?? "").localeCompare(String(right.document.title?.number ?? ""), "en", { numeric: true })
    || String(left.document.chapter?.number ?? "").localeCompare(String(right.document.chapter?.number ?? ""), "en", { numeric: true })
    || String(left.document.id).localeCompare(String(right.document.id));
}

export function compareSearchResults(left, right) {
  return right.score - left.score || citationOrder(left, right);
}

function compareSearchResultsForSort(left, right, sort) {
  return sort === "citation"
    ? citationOrder(left, right) || right.score - left.score
    : compareSearchResults(left, right);
}

export function mergeSearchResults(current, incoming, { limit = 50, sort = "relevance" } = {}) {
  return [...current, ...incoming].sort((left, right) => compareSearchResultsForSort(left, right, sort)).slice(0, limit);
}

export function searchDocumentBatch(documents, query, { limit = 50, ...searchOptions } = {}) {
  const compiled = combinedCompiledQuery(query, searchOptions);
  const matches = documents
    .filter((document) => documentMatchesFilters(document, compiled.options))
    .map((document) => ({ document, outcome: scoreCompiledDocument(document, compiled) }))
    .filter((result) => result.outcome)
    .map(({ document, outcome }) => ({ document, score: outcome.score, matchedFields: outcome.matchedFields }))
    .sort((left, right) => compareSearchResultsForSort(left, right, compiled.options.sort));
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
  #auxiliaryBaseUrl;
  #fetch;
  #manifest;
  #auxiliaryManifest;
  #shards = new Map();
  #auxiliaryShards = new Map();
  #supplements;

  constructor({
    baseUrl = "./data/search/",
    auxiliaryBaseUrl = "./data/search-v2/",
    fetchImpl = globalThis.fetch,
    supplementRepository = null
  } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#auxiliaryBaseUrl = new URL(auxiliaryBaseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
    this.#supplements = supplementRepository;
  }

  async #json(relativePath, baseUrl = this.#baseUrl) {
    const response = await this.#fetch(new URL(relativePath, baseUrl));
    if (!response.ok) throw new Error(`Could not load ${relativePath} (${response.status})`);
    return response.json();
  }

  async init() {
    this.#manifest ??= await this.#json("manifest.json");
    return this.#manifest;
  }

  async #loadAuxiliaryTitle(titleId) {
    this.#auxiliaryManifest ??= await this.#json("manifest.json", this.#auxiliaryBaseUrl);
    if (this.#auxiliaryShards.has(titleId)) return this.#auxiliaryShards.get(titleId);
    const entry = this.#auxiliaryManifest.shards.find((shard) => shard.titleId === titleId);
    if (!entry) throw new Error(`No extended search shard for ${titleId}`);
    const promise = this.#json(entry.path, this.#auxiliaryBaseUrl).catch((error) => {
      this.#auxiliaryShards.delete(titleId);
      throw error;
    });
    this.#auxiliaryShards.set(titleId, promise);
    return promise;
  }

  async loadTitle(titleId, { includeAuxiliary = false } = {}) {
    await this.init();
    if (!this.#shards.has(titleId)) {
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
    }
    const shard = await this.#shards.get(titleId);
    if (!includeAuxiliary) return shard;
    const auxiliary = await this.#loadAuxiliaryTitle(titleId);
    const fieldsById = new Map(auxiliary.documents.map((document) => [document.id, document]));
    return {
      ...shard,
      documents: shard.documents.map((document) => ({ ...document, ...(fieldsById.get(document.id) ?? {}) }))
    };
  }

  async loadTitles(titleIds, { concurrency = 6, includeAuxiliary = false, onTitle, signal } = {}) {
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
        const shard = await this.loadTitle(titleId, { includeAuxiliary });
        if (signal?.aborted) throw abortError();
        completed += 1;
        await onTitle?.(shard, { completed, total, titleId, index });
      }
    };

    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), total) }, loadNext));
    return { completed, total };
  }

  async search(query, { titleIds, limit = 50, ...searchOptions } = {}) {
    const documents = [];
    await this.loadTitles(titleIds, {
      includeAuxiliary: ["all", "history", "annotations"].includes(normalizeSearchOptions(searchOptions).field),
      onTitle(shard) {
        documents.push(...shard.documents.map((document) => ({ ...document, title: shard.title })));
      }
    });
    return searchDocuments(documents, query, { limit, ...searchOptions });
  }
}
