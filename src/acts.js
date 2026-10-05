import { escapeHtml } from "./reader.js";

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

  #json(relativePath) {
    if (!this.#cache.has(relativePath)) {
      this.#cache.set(relativePath, (async () => {
        const response = await this.#fetch(new URL(relativePath, this.#baseUrl));
        if (!response.ok) throw new Error(`Could not load the acts list (${response.status})`);
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

export function filterActs(acts, options = {}) {
  const { type, query, sort } = normalizeActsOptions(options);
  const matchesQuery = queryMatcher(query);
  const matches = acts.filter((act) => (!type || act.type === type) && matchesQuery(act));
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

export function renderActRow(act) {
  return `<tr>
    <th scope="row"><a href="${escapeHtml(act.url)}" target="_blank" rel="noopener">${escapeHtml(act.citation)}<span class="visually-hidden"> (PDF)</span></a>
      <a class="act-bill" href="${escapeHtml(act.billUrl)}" target="_blank" rel="noopener">${escapeHtml(act.bill)}<span class="visually-hidden"> bill status</span></a></th>
    <td>${escapeHtml(act.title)}</td>
  </tr>`;
}

export function renderActsTable(acts, caption) {
  return `<div class="acts-table-wrap"><table class="acts-table">
    <caption class="visually-hidden">${escapeHtml(caption)}</caption>
    <thead><tr><th scope="col">Act and bill</th><th scope="col">Title</th></tr></thead>
    <tbody>${acts.map(renderActRow).join("")}</tbody>
  </table></div>`;
}
