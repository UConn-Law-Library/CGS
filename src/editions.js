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

  // An archived subject index or infractions edition: its record, manifest, and a loader for its
  // shards. Null when no archived edition has that id.
  async sourceEdition(kind, id) {
    const index = await this.index();
    const entry = (index.secondary ?? []).find((candidate) => candidate.kind === kind && candidate.id === id);
    if (!entry) return null;
    const manifest = await this.#json(`${entry.path}manifest.json`);
    return { entry, manifest, load: (relative) => this.#json(`${entry.path}${relative}`) };
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

// Where a statute link recorded in an archived index or infractions edition leads now. The record
// was resolved against the statute text named by the edition's statuteSnapshot: while that
// revision is still current the link opens it; once it is archived, the archived edition. A
// citation that never resolved, or whose statute edition is not available, gets no link.
export function historicalStatuteHref(resolution, snapshot, { currentRevisionYear = null, statutes = [] } = {}) {
  if (!resolution?.href || !["exact", "section-only"].includes(resolution.status)) return { href: null, reason: "unresolved" };
  if (!resolution.href.startsWith("#/t/")) return { href: resolution.href, reason: null };
  if (snapshot?.revisionYear === currentRevisionYear) return { href: resolution.href, reason: null };
  const archived = statutes.find((edition) => edition.revisionYear === snapshot?.revisionYear);
  if (archived) return { href: resolution.href.replace(/^#\//, `#/editions/${archived.id}/`), reason: null };
  return { href: null, reason: "edition-unavailable" };
}

function citationMarkup(text, link) {
  if (link.href) return `<a class="legal-reference" href="${escapeHtml(link.href)}">${escapeHtml(text)}</a>`;
  const note = link.reason === "edition-unavailable" ? "statute edition not archived" : "not resolved";
  return `${escapeHtml(text)} <span class="citation-unresolved">(${note})</span>`;
}

const SOURCE_KIND_TITLES = { infractions: "Infractions schedule", "statutes-index": "Subject index" };
const lowerFirst = (label) => label.charAt(0).toLowerCase() + label.slice(1);

// The subject index and infractions schedule sections of the editions page.
export function renderSecondaryEditions({ index, routes }) {
  return Object.keys(SOURCE_KIND_TITLES).map((kind) => {
    const current = (index?.currentSecondary ?? []).find((entry) => entry.kind === kind);
    const archived = (index?.secondary ?? []).filter((entry) => entry.kind === kind);
    const noun = kind === "infractions" ? "schedule" : "index";
    return `<section class="editions-archived" aria-labelledby="editions-${kind}-heading">
      <h2 id="editions-${kind}-heading">${escapeHtml(SOURCE_KIND_TITLES[kind])} editions</h2>
      ${current ? `<p>Current: ${escapeHtml(current.name)}, ${escapeHtml(lowerFirst(current.label))}. <a href="${escapeHtml(routes.currentSource(kind))}">Open the current ${noun}</a></p>` : ""}
      ${archived.length ? `<ol class="edition-list">${archived.map((entry) => `<li class="edition-card">
        <p class="eyebrow">Archived · replaced by the edition ${escapeHtml(lowerFirst(entry.supersededBy.label))}</p>
        <h3><a href="${escapeHtml(routes.source(kind, entry.id))}">${escapeHtml(entry.name)}, ${escapeHtml(lowerFirst(entry.label))}</a></h3>
        <p>Published by ${escapeHtml(entry.publisher)}. Statute links as resolved against the ${escapeHtml(String(entry.statuteSnapshot.revisionYear))} revision. Source ${entry.sources.length === 1 ? "PDF" : "PDFs"}: ${entry.sources.map((source) => source.retained ? `kept (SHA-256 ${escapeHtml(source.sha256.slice(0, 12))})` : `recorded by SHA-256 ${escapeHtml(source.sha256.slice(0, 12))}, not kept`).join("; ")}.</p>
      </li>`).join("")}</ol>` : `<p class="empty-state">No earlier ${kind === "infractions" ? "schedules" : "index editions"} are archived yet.</p>`}
    </section>`;
  }).join("");
}

function archivedSourceNotice(entry, { editionsHref, currentHref }) {
  return `<aside class="edition-notice" aria-label="Archived edition">
      <p><strong>Archived edition.</strong> ${escapeHtml(entry.name)}, ${escapeHtml(lowerFirst(entry.label))}, published by ${escapeHtml(entry.publisher)}. The edition ${escapeHtml(lowerFirst(entry.supersededBy.label))} replaced it. Statute links open the text they were resolved against, the ${escapeHtml(String(entry.statuteSnapshot.revisionYear))} revision.</p>
      <p class="edition-notice-links"><a href="${escapeHtml(currentHref)}">Current edition</a><a href="${escapeHtml(editionsHref)}">All editions</a>${entry.sources.filter((source) => source.retained).map((source) => `<a href="${escapeHtml(new URL(source.path, new URL(entry.path, "https://x/data/editions/")).pathname.replace(/^\//, "./"))}">Archived PDF</a>`).join("")}</p>
    </aside>`;
}

export function renderArchivedInfractions({ entry, entries, linkFor, editionsHref, currentHref }) {
  const byCategory = new Map();
  for (const item of entries) byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
  const money = (cents) => Number.isInteger(cents) ? `$${(cents / 100).toFixed(2)}` : "";
  return `<header class="browse-heading"><div><p class="eyebrow">${escapeHtml(entry.publisher)}</p><h1>${escapeHtml(entry.name)}</h1></div></header>
    ${archivedSourceNotice(entry, { editionsHref, currentHref })}
    <p class="note">${entries.length.toLocaleString("en-US")} entries in ${byCategory.size} categories.</p>
    ${[...byCategory].sort(([left], [right]) => left.localeCompare(right)).map(([category, items]) => `<details class="archived-source-group"><summary>${escapeHtml(category)} (${items.length})</summary>
      <ul class="archived-source-list">${items.map((item) => `<li><strong>${citationMarkup(item.citation ?? item.printedCitation, linkFor(item.resolution))}</strong><span>${escapeHtml(item.description)}</span><small>${escapeHtml(money(item.amounts?.total_due))}${item.page ? ` · page ${item.page}` : ""}</small></li>`).join("")}</ul>
    </details>`).join("")}`;
}

export function renderArchivedIndex({ entry, letters, letter, headings, linkFor, letterHref, editionsHref, currentHref }) {
  return `<header class="browse-heading"><div><p class="eyebrow">${escapeHtml(entry.publisher)}</p><h1>${escapeHtml(entry.name)}</h1></div></header>
    ${archivedSourceNotice(entry, { editionsHref, currentHref })}
    <nav class="archived-index-letters" aria-label="Index letters">${letters.map((value) => `<a href="${escapeHtml(letterHref(value))}"${value === letter ? ' aria-current="page"' : ""}>${escapeHtml(value.toUpperCase())}</a>`).join("")}</nav>
    ${letter ? headings.map((heading) => `<details class="archived-source-group"><summary>${escapeHtml(heading.label)}</summary>
      <ul class="archived-source-list">${heading.items.map((item) => `<li class="index-level-${Math.min(Number(item.level) || 0, 4)}"><span>${escapeHtml(item.text)}</span>${item.references.length ? `<small>${item.references.map((reference) => citationMarkup(reference.display, linkFor(reference.resolution))).join(", ")}</small>` : ""}</li>`).join("")}</ul>
    </details>`).join("") : '<p class="note">Choose a letter.</p>'}`;
}
