import { escapeHtml, renderLinkedText } from "./reader.js";
import { actRouteHref } from "./routes.js";

export const ACT_TYPES = Object.freeze({ public: "Public Acts", special: "Special Acts" });
export const ACT_SORTS = Object.freeze({ newest: "Newest first", number: "Act number" });

export class ActsRepository {
  #baseUrl;
  #fetch;
  #cache = new Map();

  constructor({ baseUrl = "./data/acts/", fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
  }

  #json(relativePath, label = "the acts list") {
    if (!this.#cache.has(relativePath)) {
      this.#cache.set(relativePath, (async () => {
        const response = await this.#fetch(new URL(relativePath, this.#baseUrl));
        if (!response.ok) throw new Error(`Could not load ${label} (${response.status})`);
        return response.json();
      })().catch((error) => {
        this.#cache.delete(relativePath);
        throw error;
      }));
    }
    return this.#cache.get(relativePath);
  }

  manifest() {
    return this.#json("manifest.json");
  }

  async loadSession(sessionId = null) {
    const manifest = await this.manifest();
    const entry = sessionId ? manifest.sessions.find((session) => session.id === sessionId) : manifest.sessions[0];
    if (!entry) return { manifest, entry: null, acts: [] };
    const file = await this.#json(entry.path);
    return { manifest, entry, acts: file.acts };
  }

  loadActText(act) {
    return this.#json(act.text.path, `the text of ${act.citation}`);
  }

  loadSearchIndex(entry) {
    return entry.search ? this.#json(entry.search.path, "the acts search index") : Promise.resolve(null);
  }
}

export function normalizeActsOptions({ session = null, type = null, query = null, sort = null } = {}) {
  return {
    session: session || null,
    type: Object.hasOwn(ACT_TYPES, type) ? type : null,
    query: String(query ?? "").trim() || null,
    sort: Object.hasOwn(ACT_SORTS, sort) ? sort : "newest"
  };
}

const CITATION_QUERY = /^([ps])\.?\s*a\.?\s*(\d{2})\s*-\s*(\d+)$/i;
const BILL_QUERY = /^([hs]b)\.?\s*0*(\d+)$/i;

function exactQuery(query) {
  return CITATION_QUERY.test(query) || BILL_QUERY.test(query);
}

function queryMatcher(query) {
  if (!query) return () => true;
  // "PA 26-15", "P.A. 26-15", "HB 5557", and "hb05557" name one act or bill exactly.
  const citation = query.match(CITATION_QUERY);
  if (citation) {
    const type = citation[1].toLowerCase() === "p" ? "public" : "special";
    const prefix = `${type === "public" ? "P.A." : "S.A."} ${citation[2]}-${Number(citation[3])}`;
    return (act) => act.type === type && (act.citation === prefix || act.citation.startsWith(`${prefix} (`));
  }
  const bill = query.match(BILL_QUERY);
  if (bill) {
    const label = `${bill[1].toUpperCase()} ${Number(bill[2])}`;
    return (act) => act.bill === label;
  }
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (act) => {
    const text = `${act.citation} ${act.bill} ${act.title}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  };
}

export function matchesActMetadata(act, query) {
  return queryMatcher(String(query ?? "").trim() || null)(act);
}

// Matches tokens() in crawler/cgs_crawler/act_text.py: lowercased words, with
// statute and act citations such as 22a-245 and 26-2 kept whole.
const TOKEN = /\d+[a-z]*(?:-\d+[a-z0-9]*)+|[a-z0-9]+(?:'[a-z]+)?/gi;

export function tokenizeActText(text) {
  return [...String(text ?? "").replaceAll("’", "'").matchAll(TOKEN)].map(([token]) => token.toLowerCase().replace(/'s$/, ""));
}

const sortedTerms = new WeakMap();

function termsStartingWith(index, token) {
  if (!sortedTerms.has(index)) sortedTerms.set(index, Object.keys(index.terms).sort());
  const terms = sortedTerms.get(index);
  let low = 0;
  let high = terms.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (terms[middle] < token) low = middle + 1;
    else high = middle;
  }
  const matches = [];
  for (let position = low; position < terms.length && terms[position].startsWith(token); position += 1) matches.push(terms[position]);
  return matches;
}

/**
 * Return the ids of acts whose text contains every word of the query, or null
 * when the query names an act or bill exactly. Words of three or more
 * characters also match the longer words they begin, so "redeem" finds "redeemed".
 */
export function matchActText(index, query) {
  const value = String(query ?? "").trim();
  if (!index || !value || exactQuery(value)) return null;
  const tokens = [...new Set(tokenizeActText(value))];
  if (!tokens.length) return null;
  let matches = null;
  for (const token of tokens) {
    const terms = token.length >= 3 ? termsStartingWith(index, token) : Object.hasOwn(index.terms, token) ? [token] : [];
    const postings = new Set(terms.flatMap((term) => index.terms[term]));
    matches = matches ? new Set([...matches].filter((position) => postings.has(position))) : postings;
    if (!matches.size) break;
  }
  return new Set([...matches].map((position) => index.acts[position]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A pattern that finds the query's words in act text, for highlighting. */
export function actTextPattern(query) {
  const value = String(query ?? "").trim();
  if (!value || exactQuery(value)) return null;
  const tokens = [...new Set(tokenizeActText(value))].sort((left, right) => right.length - left.length);
  if (!tokens.length) return null;
  const words = tokens.map((token) => `${escapeRegExp(token)}${token.length >= 3 ? "[a-z0-9]*" : "(?![a-z0-9])"}`);
  return new RegExp(`(?<![a-z0-9])(?:${words.join("|")})`, "gi");
}

export function filterActs(acts, options = {}, textMatches = null) {
  const { type, query, sort } = normalizeActsOptions(options);
  const matchesQuery = queryMatcher(query);
  const matches = acts.filter((act) => (!type || act.type === type) && (matchesQuery(act) || Boolean(textMatches?.has(act.id))));
  const direction = sort === "newest" ? -1 : 1;
  return matches.sort((left, right) =>
    (left.type === right.type ? 0 : left.type === "public" ? -1 : 1)
    || direction * (left.number - right.number));
}

export function actsCurrencyNote(session, supplementEditionYear = null) {
  const covered = supplementEditionYear ? supplementEditionYear - 1 : null;
  if (covered !== null && session.year > covered) {
    return `The statute text in this app includes the ${supplementEditionYear} Supplement, which reflects legislation through the ${covered} session. Acts from the ${session.name} are not yet reflected in that text.`;
  }
  if (covered !== null) {
    return `Acts from the ${session.name} should already be reflected in the ${supplementEditionYear} Supplement text in this app.`;
  }
  return `Acts from the ${session.name} may not yet be reflected in the statute text in this app.`;
}

export function actsCountLabel(counts) {
  return `${counts.acts.toLocaleString()} act${counts.acts === 1 ? "" : "s"} (${counts.publicActs.toLocaleString()} public, ${counts.specialActs.toLocaleString()} special)`;
}

export function renderActRow(act, { session = null, query = null, textMatch = false } = {}) {
  const bill = `<a class="act-bill" href="${escapeHtml(act.billUrl)}" target="_blank" rel="noopener">${escapeHtml(act.bill)}<span class="visually-hidden"> bill status</span></a>`;
  if (!act.text || !session) {
    return `<tr>
    <th scope="row"><a href="${escapeHtml(act.url)}" target="_blank" rel="noopener">${escapeHtml(act.citation)}<span class="visually-hidden"> (PDF)</span></a>
      ${bill}</th>
    <td>${escapeHtml(act.title)}</td>
  </tr>`;
  }
  const href = escapeHtml(actRouteHref(session, act, { query: textMatch ? query : null }));
  return `<tr>
    <th scope="row"><a href="${href}">${escapeHtml(act.citation)}</a>
      <span class="act-links">${bill} <a class="act-pdf" href="${escapeHtml(act.url)}" target="_blank" rel="noopener">PDF<span class="visually-hidden"> of ${escapeHtml(act.citation)}</span></a></span></th>
    <td><a class="act-title-link" href="${href}">${escapeHtml(act.title)}</a>${textMatch ? `<small class="act-text-match">Search words appear in the act's text</small>` : ""}</td>
  </tr>`;
}

export function renderActsTable(acts, caption, { session = null, query = null, textMatches = null } = {}) {
  const rows = acts.map((act) => renderActRow(act, {
    session,
    query,
    textMatch: Boolean(textMatches?.has(act.id)) && !matchesActMetadata(act, query)
  }));
  return `<div class="acts-table-wrap"><table class="acts-table">
    <caption class="visually-hidden">${escapeHtml(caption)}</caption>
    <thead><tr><th scope="col">Act and bill</th><th scope="col">Title</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table></div>`;
}

function renderRuns(runs, maps) {
  return runs.map((run) => typeof run === "string"
    ? renderLinkedText(run, maps)
    : `<ins>${renderLinkedText(run.ins, maps)}</ins>`).join("");
}

function renderActTable(block, maps) {
  const rows = block.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderRuns(cell, maps)}</td>`).join("")}</tr>`).join("");
  return `<div class="act-table-wrap" role="region" tabindex="0" aria-label="Table from page ${block.page} of the act"><table class="act-table"><tbody>${rows}</tbody></table></div>`;
}

/** The act's body: paragraphs with added language in <ins>, tables, and the Governor's action. */
export function renderActDocument(document, maps = {}) {
  const parts = [];
  let action = [];
  const flushAction = () => {
    if (action.length) parts.push(`<p class="act-action">${action.join("<br>")}</p>`);
    action = [];
  };
  for (const block of document.blocks) {
    if (block.type === "action") {
      action.push(renderRuns(block.runs, maps));
      continue;
    }
    flushAction();
    if (block.type === "table") parts.push(renderActTable(block, maps));
    else parts.push(`<p${block.anchor ? ` id="${escapeHtml(block.anchor)}" class="act-section-start" tabindex="-1"` : ""}>${renderRuns(block.runs, maps)}</p>`);
  }
  flushAction();
  return `<div class="act-document statute-text" data-act-text>${parts.join("")}</div>`;
}

/** A jump list of the act's sections and when each takes effect. */
export function renderActSections(document, sectionHref) {
  if (!document.sections.length) return "";
  const count = document.sections.length;
  const items = document.sections.map((section) =>
    `<li><a href="${escapeHtml(sectionHref(section))}">Sec. ${escapeHtml(section.number)}</a>${section.effective ? ` <small>${escapeHtml(section.effective)}</small>` : ""}</li>`
  ).join("");
  return `<details class="act-sections"${count <= 12 ? " open" : ""}>
    <summary>${count.toLocaleString()} section${count === 1 ? "" : "s"} and effective dates</summary>
    <ol>${items}</ol>
  </details>`;
}
