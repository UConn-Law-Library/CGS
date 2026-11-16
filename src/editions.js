import { checkDataResponse, dataUrl } from "./data-loader.js";
import { escapeHtml } from "./reader.js";
import { SupplementRepository } from "./supplements.js";
import { statuteTextEdition } from "./publications.js";

// Archived editions: an earlier full revision and the supplement read with it, kept byte for
// byte as published, plus earlier editions of the secondary sources. The build lists them in
// data/editions/manifest.json. Statute search and the default reader use only the active edition.

export function statuteEditionLabel(revisionYear, supplementYears = []) {
  const supplements = supplementYears.length
    ? `, with the ${supplementYears.map((year) => `${year} Supplement`).join(" and ")}`
    : "";
  return `General Statutes revised to January 1, ${revisionYear}${supplements}`;
}

export function shortEditionLabel(revisionYear, supplementYears = []) {
  return supplementYears.length ? `${revisionYear} revision with the ${supplementYears.join(" and ")} Supplement` : `${revisionYear} revision`;
}

// Archived chapters keep the URL they were captured from. CGA's /current/ pages always show the
// newest revision, so the archive record maps them to the edition's own year-scoped pages.
export function officialSourceUrl(url, officialSources = []) {
  const value = String(url ?? "");
  for (const { from, to } of officialSources) {
    if (value.startsWith(from)) return `${to}${value.slice(from.length)}`;
  }
  return value;
}

export class EditionsRepository {
  #baseUrl;
  #fetch;
  #index;
  #editions = new Map();

  constructor({ baseUrl = "./data/editions/", fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async #json(relativePath) {
    const response = await this.#fetch(dataUrl(new URL(relativePath, this.#baseUrl)), { signal: AbortSignal.timeout(15000) });
    checkDataResponse(response, `edition ${relativePath}`);
    return response.json();
  }

  index() {
    this.#index ??= this.#json("manifest.json").catch((error) => {
      this.#index = undefined;
      throw error;
    });
    return this.#index;
  }

  // Everything the reader needs to open one archived statute edition. Null when no archived
  // edition has that id.
  statuteEdition(id) {
    if (!this.#editions.has(id)) {
      const promise = (async () => {
        const index = await this.index();
        const entry = index.statutes.find((edition) => edition.id === String(id));
        if (!entry) return null;
        const root = new URL(entry.path, this.#baseUrl);
        const catalog = await this.#json(`${entry.path}catalog.json`);
        const citations = new Map();
        return {
          id: entry.id,
          entry,
          catalog,
          dataRoot: root.href,
          supplements: new SupplementRepository({ baseUrl: new URL("supplements/", root).href, fetchImpl: this.#fetch }),
          loadCitations: (titleId) => {
            if (!citations.has(titleId)) {
              const shard = entry.citationShards.find((candidate) => candidate.titleId === titleId);
              const load = shard
                ? this.#json(`${entry.path}${shard.path}`).then((value) => value.sections)
                : Promise.resolve({});
              citations.set(titleId, load.catch((error) => {
                citations.delete(titleId);
                throw error;
              }));
            }
            return citations.get(titleId);
          }
        };
      })().catch((error) => {
        this.#editions.delete(id);
        throw error;
      });
      this.#editions.set(id, promise);
    }
    return this.#editions.get(id);
  }
}

function formatYearList(years) {
  return years.length === 2 ? `${years[0]} and ${years[1]}` : years.join(", ");
}

// The active edition, described from the catalog and the supplement merged over it.
export function currentEditionSummary(catalog, supplementEdition) {
  const revisionYear = catalog?.source?.revisionYear ?? null;
  const supplementYears = supplementEdition?.editionYear ? [supplementEdition.editionYear] : [];
  const newest = statuteTextEdition({ baseRevisionYear: revisionYear, supplementYear: supplementYears[0] ?? null });
  return {
    revisionYear,
    supplementYears,
    label: revisionYear ? statuteEditionLabel(revisionYear, supplementYears) : "The current General Statutes",
    legislationThrough: newest?.legislationThrough ?? null
  };
}

export function renderEditionsPage({ current, index, routes, formatDate }) {
  const archived = index?.statutes ?? [];
  const currentCard = `<section class="edition-card edition-current" aria-labelledby="edition-current-heading">
      <p class="eyebrow">Current edition</p>
      <h2 id="edition-current-heading">${escapeHtml(current.label)}</h2>
      ${current.legislationThrough ? `<p>Reflects legislation through the ${escapeHtml(String(current.legislationThrough))} sessions. Statute search, act notices, the subject index, and the infractions schedule use this edition.</p>` : ""}
      <p class="edition-actions"><a class="primary-action" href="${escapeHtml(routes.current)}">Browse the current statutes</a></p>
    </section>`;
  const list = archived.length
    ? `<ol class="edition-list">${archived.map((edition) => `<li class="edition-card">
        <p class="eyebrow">Archived · superseded by the ${escapeHtml(String(edition.supersededBy))} revision</p>
        <h3><a href="${escapeHtml(routes.edition(edition.id))}">${escapeHtml(edition.label)}</a></h3>
        <p>Reflects legislation through the ${escapeHtml(String(edition.legislationThrough))} sessions. ${escapeHtml(edition.counts.chapters.toLocaleString("en-US"))} chapters and ${escapeHtml(edition.counts.sections.toLocaleString("en-US"))} sections${edition.supplementYears.length ? `, with the ${escapeHtml(formatYearList(edition.supplementYears))} Supplement text and comparisons` : ""}. Captured ${escapeHtml(formatDate(edition.retrievedAt) ?? "date unavailable")}.</p>
        <p class="edition-actions"><a href="${escapeHtml(routes.edition(edition.id))}">Browse the ${escapeHtml(shortEditionLabel(edition.revisionYear, edition.supplementYears))}</a>${edition.officialSources[0] ? `<a href="${escapeHtml(`${edition.officialSources[0].to}titles.htm`)}">Official ${escapeHtml(String(edition.revisionYear))} revision</a>` : ""}</p>
      </li>`).join("")}</ol>`
    : `<p class="empty-state">No earlier editions are archived yet. When CGA publishes the next full revision, the edition it replaces, with its supplement, is kept here.</p>`;
  return `<header class="browse-heading"><div><p class="eyebrow">General Statutes of Connecticut</p><h1>Editions</h1></div></header>
    <p class="editions-intro">The app reads from the current edition. Earlier editions stay here, as published, for research into the law on an earlier date. Archived text is not the current law.</p>
    ${currentCard}
    <section class="editions-archived" aria-labelledby="editions-archived-heading">
      <h2 id="editions-archived-heading">Archived statute editions</h2>
      ${list}
    </section>`;
}

// The notice at the top of every archived statute page.
export function renderArchivedEditionNotice({ edition, currentHref, editionsHref }) {
  return `<aside class="edition-notice" aria-label="Archived edition">
      <p><strong>Archived edition.</strong> ${escapeHtml(edition.label)}. The ${escapeHtml(String(edition.supersededBy))} revision replaced this text; it is not the current law.</p>
      <p class="edition-notice-links"><a href="${escapeHtml(currentHref)}">Current text</a><a href="${escapeHtml(editionsHref)}">All editions</a></p>
    </aside>`;
}
