import { escapeHtml, renderLinkedText } from "./reader.js";
import { actRouteHref } from "./routes.js";

export const ACT_TYPES = Object.freeze({ public: "Public Acts", special: "Special Acts" });
export const ACT_SORTS = Object.freeze({ newest: "Newest first", number: "Act number" });
export const ACT_VIEWS = Object.freeze({ acts: "By act", effective: "By effective date" });
export const EFFECTIVE_SORTS = Object.freeze({ effective: "Effective", act: "Public Act" });

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

  // Derived at build time from the act texts: which statute sections each act changes.
  amendments() {
    return this.#json("amendments.json", "the acts amendment index");
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

  loadEffectiveIndex(entry) {
    return entry.effective ? this.#json(entry.effective.path, "the acts' effective dates") : Promise.resolve(null);
  }
}

const EFFECTIVE_ON = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeActsOptions({ session = null, type = null, query = null, sort = null, order = null, view = null, on = null } = {}) {
  const effective = view === "effective";
  const sorts = effective ? EFFECTIVE_SORTS : ACT_SORTS;
  return {
    session: session || null,
    type: Object.hasOwn(ACT_TYPES, type) ? type : null,
    query: String(query ?? "").trim() || null,
    sort: Object.hasOwn(sorts, sort) ? sort : Object.keys(sorts)[0],
    order: effective && order === "desc" ? "desc" : "asc",
    view: effective ? "effective" : "acts",
    on: EFFECTIVE_ON.test(on ?? "") ? on : null
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

// The act's brackets stay in the page, so copied text keeps the act's own
// [deleted] convention, but only the red strikethrough shows.
const bracket = (value) => `<span class="act-bracket" aria-hidden="true">${value}</span>`;

/**
 * Render runs as HTML. Added language becomes <ins>, and [bracketed] deleted
 * language becomes <del>. A deletion can continue into later paragraphs and
 * table cells, so `state.deleting` carries an open bracket between calls; each
 * piece is closed where it ends, keeping the HTML valid.
 */
function renderRuns(runs, maps, state) {
  return runs.map((run) => {
    if (typeof run !== "string") return `<ins class="revision-addition">${renderLinkedText(run.ins, maps)}</ins>`;
    const parts = run.split(/([[\]])/);
    return parts.map((part, index) => {
      if (part === "[" || part === "]") {
        state.deleting = part === "[";
        // A bracket with no deleted text beside it in this run still needs a home.
        const neighbor = parts[part === "[" ? index + 1 : index - 1];
        return neighbor ? "" : `<del class="revision-deletion">${bracket(part)}</del>`;
      }
      if (!part) return "";
      if (!state.deleting) return renderLinkedText(part, maps);
      const open = parts[index - 1] === "[" ? bracket("[") : "";
      const close = parts[index + 1] === "]" ? bracket("]") : "";
      return `<del class="revision-deletion">${open}${renderLinkedText(part, maps)}${close}</del>`;
    }).join("");
  }).join("");
}

function renderActTable(block, maps, state) {
  const rows = block.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderRuns(cell, maps, state)}</td>`).join("")}</tr>`).join("");
  return `<div class="act-table-wrap" role="region" tabindex="0" aria-label="Table from page ${block.page} of the act"><table class="act-table"><tbody>${rows}</tbody></table></div>`;
}

/**
 * The act's body: paragraphs with added and deleted language marked, tables,
 * and the Governor's action. Given `sections`, only those sections' blocks are
 * shown; every block is still rendered so a deletion carried across blocks
 * stays open where it should.
 */
export function renderActDocument(document, maps = {}, { sections = null } = {}) {
  const state = { deleting: false };
  const parts = [];
  let action = [];
  const flushAction = () => {
    if (action.length) parts.push(`<p class="act-action">${action.join("<br>")}</p>`);
    action = [];
  };
  for (const block of document.blocks) {
    const shown = !sections || sections.has(block.section);
    if (block.type === "action") {
      const html = renderRuns(block.runs, maps, state);
      if (!sections) action.push(html);
      continue;
    }
    flushAction();
    const html = block.type === "table"
      ? renderActTable(block, maps, state)
      : `<p${block.anchor ? ` id="${escapeHtml(block.anchor)}" class="act-section-start" tabindex="-1"` : ""}>${renderRuns(block.runs, maps, state)}</p>`;
    if (shown) parts.push(html);
  }
  flushAction();
  return `<div class="act-document statute-text" data-act-text>${parts.join("")}</div>`;
}

/** A jump list of the act's sections and when each takes effect. */
export function renderActSections(document, sectionHref, { sections = null } = {}) {
  const listed = sections ? document.sections.filter((section) => sections.has(section.number)) : document.sections;
  if (!listed.length) return "";
  const count = listed.length;
  const items = listed.map((section) =>
    `<li><a href="${escapeHtml(sectionHref(section))}">Sec. ${escapeHtml(section.number)}</a>${section.effective ? ` <small>${escapeHtml(section.effective)}</small>` : ""}</li>`
  ).join("");
  return `<details class="act-sections"${count <= 12 ? " open" : ""}>
    <summary>${count.toLocaleString()} section${count === 1 ? "" : "s"} and effective dates</summary>
    <ol>${items}</ol>
  </details>`;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE_TEXT = /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/;
const EFFECTIVE_TEXT = /^Effective\s+(from passage|([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4}))\s*,?\s*(?:and\s+)?(.*)$/i;

function isoDate(month, day, year) {
  const index = MONTHS.indexOf(month.toLowerCase());
  return index < 0 ? null : `${year}-${String(index + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)} ${day}, ${year}`;
}

/**
 * Read a section's effective-date wording. `date` is the day it takes effect
 * ("YYYY-MM-DD"); a section effective from passage takes effect the day its
 * act was approved. `qualifier` keeps any terms after the date, such as
 * "Applicable to sales occurring on or after October 1, 2026".
 */
export function parseEffective(effective, approved = null) {
  const match = String(effective ?? "").match(EFFECTIVE_TEXT);
  if (!match) return { date: null, fromPassage: false, label: effective || "No effective date stated", qualifier: "" };
  const rest = match[5].trim();
  const qualifier = rest && `${rest[0].toUpperCase()}${rest.slice(1)}`;
  const fromPassage = match[1].toLowerCase() === "from passage";
  const approval = fromPassage ? String(approved ?? "").match(DATE_TEXT) : null;
  const date = fromPassage ? approval && isoDate(approval[1], approval[2], approval[3]) : isoDate(match[2], match[3], match[4]);
  if (!date) return { date: null, fromPassage, label: effective, qualifier: "" };
  return { date, fromPassage, label: formatIsoDate(date), qualifier };
}

const byDate = (left, right) => (left.date ?? "9999").localeCompare(right.date ?? "9999");
const byAct = (left, right) => left.act.number - right.act.number;
const bySection = (left, right) => Number(left.sections[0]) - Number(right.sections[0]);

/**
 * One row per act and effective-date wording. Rows sort by effective date
 * (rows without one last) or by act number, then by the other, then by section.
 */
export function effectiveRows(acts, index, { sort = "effective", order = "asc" } = {}) {
  const dates = new Map((index?.acts ?? []).map((entry) => [entry.id, entry]));
  const rows = acts.flatMap((act) => {
    const entry = dates.get(act.id);
    return (entry?.dates ?? []).map(({ effective, sections }) => ({ act, sections, ...parseEffective(effective, entry.approved) }));
  });
  const direction = order === "desc" ? -1 : 1;
  const primary = sort === "act"
    ? (left, right) => direction * byAct(left, right)
    : (left, right) => (!left.date || !right.date ? byDate(left, right) : direction * byDate(left, right));
  const secondary = sort === "act" ? byDate : byAct;
  return rows.sort((left, right) => primary(left, right) || secondary(left, right) || bySection(left, right));
}

/** The dates a reader can filter effective-date rows by, in order. */
export function effectiveDateOptions(rows) {
  return [...new Set(rows.map((row) => row.date).filter(Boolean))].sort().map((date) => [date, formatIsoDate(date)]);
}

// Act titles are printed in capitals. These names keep their capitals when a
// title is shown in sentence case; any other word is lowercased.
const PROPER_NAMES = [
  "Americans with Disabilities Act", "American Sign Language", "Connecticut Unfair Trade Practices Act",
  "Department of Administrative Services", "Department of Agriculture", "Department of Banking",
  "Department of Children and Families", "Department of Consumer Protection", "Department of Correction",
  "Department of Developmental Services", "Department of Economic and Community Development",
  "Department of Education", "Department of Emergency Services and Public Protection",
  "Department of Energy and Environmental Protection", "Department of Housing", "Department of Labor",
  "Department of Mental Health and Addiction Services", "Department of Motor Vehicles",
  "Department of Public Health", "Department of Revenue Services", "Department of Social Services",
  "Department of Transportation", "Department of Veterans Affairs",
  "Office of Early Childhood", "Office of Higher Education", "Office of Policy and Management",
  "Office of State Ethics", "Office of the Attorney General", "Office of Workforce Strategy",
  "State Elections Enforcement Commission", "Governor's Workforce Council", "Banking Commissioner",
  "Attorney General", "General Assembly", "National Guard", "Probate Court", "Boys and Girls Club",
  "State Building Code", "State Fire Prevention Code", "Fire Safety Code", "Firefighters Cancer Relief Fund",
  "Second Injury Fund", "Independent Mortality Review Board", "Fatality Review Board",
  "Intergovernmental Policy and Planning Division", "Data Link Connecticut",
  "Comptroller", "Governor", "Treasurer", "Connecticut", "Germany", "India", "Medicaid", "Medicare",
  "Putnam", "Plainville", "January", "February", "April", "June", "July", "August", "September",
  "October", "November", "December"
].sort((left, right) => right.length - left.length);
const PROPER_NAME = new RegExp(`(?<![a-z])(?:${PROPER_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![a-z])`, "gi");
const PROPER_CASING = new Map(PROPER_NAMES.map((name) => [name.toLowerCase(), name]));

/** "AN ACT CONCERNING THE OFFICE OF EARLY CHILDHOOD." → "An act concerning the Office of Early Childhood." */
export function sentenceCaseTitle(title) {
  const lower = String(title ?? "").toLowerCase()
    .replace(PROPER_NAME, (match) => PROPER_CASING.get(match.toLowerCase()))
    .replace(/\bclass (i{1,3}|iv|v)\b/g, (_, numeral) => `Class ${numeral.toUpperCase()}`);
  return lower.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/** Collapse ascending section numbers into [first, last] runs. */
export function sectionRuns(numbers) {
  const runs = [];
  for (const number of numbers.map(Number)) {
    const last = runs.at(-1);
    if (last && last[1] + 1 === number) last[1] = number;
    else runs.push([number, number]);
  }
  return runs;
}

/** "1-3,7" for the act route. */
export function sectionsParameter(numbers) {
  return sectionRuns(numbers).map(([first, last]) => (first === last ? `${first}` : `${first}-${last}`)).join(",");
}

/** The section numbers a "1-3,7" route parameter names, or null. */
export function parseSectionsParameter(value) {
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value ?? "")) return null;
  const numbers = new Set();
  for (const run of value.split(",")) {
    const [first, last = first] = run.split("-").map(Number);
    if (last < first || last - first > 5000) return null;
    for (let number = first; number <= last; number += 1) numbers.add(String(number));
  }
  return numbers;
}

/** "Sec. 4" or "Secs. 1–3, 7". */
export function sectionsLabel(numbers) {
  const runs = sectionRuns(numbers).map(([first, last]) => (first === last ? `${first}` : `${first}–${last}`));
  return `${numbers.length === 1 ? "Sec." : "Secs."} ${runs.join(", ")}`;
}

const LONG_SECTION_LIST = 6;

/** "Secs. 1–3, 7 of 12 sections", or "40 of 115 sections" when the list is long. */
export function sectionsSummary(numbers, total) {
  const shown = sectionRuns(numbers).length > LONG_SECTION_LIST ? numbers.length.toLocaleString() : sectionsLabel(numbers);
  return `${shown} of ${total.toLocaleString()} section${total === 1 ? "" : "s"}`;
}

export function renderEffectiveRow(row, session) {
  const { act, sections } = row;
  const actHref = escapeHtml(actRouteHref(session, act));
  const sectionsHref = escapeHtml(actRouteHref(session, act, { sections: sectionsParameter(sections) }));
  const label = sectionsLabel(sections);
  const long = sectionRuns(sections).length > LONG_SECTION_LIST;
  return `<tr>
    <th scope="row"><a href="${actHref}">${escapeHtml(act.citation)}</a></th>
    <td class="act-effective">${row.date ? `<time datetime="${row.date}">${escapeHtml(row.label)}</time>` : escapeHtml(row.label)}</td>
    <td class="act-effective-title">${escapeHtml(sentenceCaseTitle(act.title))}</td>
    <td class="act-effective-sections">${long
      ? `<a href="${sectionsHref}">${sections.length.toLocaleString()} sections</a><small>${escapeHtml(label)}</small>`
      : `<a href="${sectionsHref}">${escapeHtml(label)}</a>`}${row.qualifier ? `<small>${escapeHtml(row.qualifier)}</small>` : ""}</td>
  </tr>`;
}

/**
 * The effective-date table. `sortHref(column, order)` links a sortable column
 * header to the table sorted by that column.
 */
export function renderEffectiveTable(rows, caption, { session, sort = "effective", order = "asc", sortHref }) {
  const header = (column) => {
    const label = EFFECTIVE_SORTS[column];
    if (column !== sort) {
      return `<th scope="col"><a class="sort-link" href="${escapeHtml(sortHref(column, "asc"))}" data-sort-column="${column}">${label}<span class="visually-hidden">, sort ascending</span></a></th>`;
    }
    const next = order === "asc" ? "desc" : "asc";
    return `<th scope="col" aria-sort="${order === "asc" ? "ascending" : "descending"}"><a class="sort-link" href="${escapeHtml(sortHref(column, next))}" data-sort-column="${column}">${label}<span class="sort-arrow" aria-hidden="true">${order === "asc" ? "▲" : "▼"}</span><span class="visually-hidden">, sort ${next === "asc" ? "ascending" : "descending"}</span></a></th>`;
  };
  return `<div class="acts-table-wrap"><table class="acts-table acts-effective-table">
    <caption class="visually-hidden">${escapeHtml(caption)}</caption>
    <thead><tr>${header("act")}${header("effective")}<th scope="col">Title</th><th scope="col">Sections</th></tr></thead>
    <tbody>${rows.map((row) => renderEffectiveRow(row, session)).join("")}</tbody>
  </table></div>`;
}
