// The General Statutes publication cycle. The Legislative Commissioners' Office publishes the
// revised General Statutes in odd-numbered years and the Supplement in even-numbered years
// (https://www.cga.ct.gov/lco/about-services.asp). Each edition is "revised to January 1" of its
// year, so it reflects legislation through the end of the year before
// (https://www.cga.ct.gov/lco/resources-aboutbills.asp).
//
// Only the editions below are described as published. Add a year after confirming it on
// cga.ct.gov; every "published", "anticipated", and "latest" label in the guide derives from
// this list, so nothing else needs to change when a new edition appears.
export const PUBLISHED_EDITIONS = Object.freeze([
  Object.freeze({ year: 2023, url: "https://www.cga.ct.gov/2023/pub/titles.htm" }),
  Object.freeze({ year: 2024, url: "https://www.cga.ct.gov/2024/sup/titles.htm" }),
  Object.freeze({ year: 2025, url: "https://www.cga.ct.gov/2025/pub/titles.htm" }),
  Object.freeze({ year: 2026, url: "https://www.cga.ct.gov/2026/sup/titles.htm" })
]);

const MONTH_DAY = "January 1";

export function editionType(year) {
  return Math.abs(year) % 2 === 1 ? "revision" : "supplement";
}

export function editionLabel(year) {
  return editionType(year) === "revision" ? `${year} General Statutes` : `${year} Supplement`;
}

// The newest edition in the app's statute text: the base revision the corpus records, or a later
// supplement merged over it. Legislation is covered through the year before that edition. Null
// when neither year is known.
export function statuteTextEdition({ baseRevisionYear = null, supplementYear = null } = {}) {
  const years = [baseRevisionYear, supplementYear].filter(Number.isInteger);
  if (!years.length) return null;
  const year = Math.max(...years);
  return { year, label: editionLabel(year), legislationThrough: year - 1 };
}

export function latestPublishedYear(editions = PUBLISHED_EDITIONS) {
  return editions.reduce((latest, edition) => Math.max(latest, edition.year), -Infinity);
}

// "published" only for a confirmed edition; "anticipated" only for a year after the latest
// confirmed one. Anything else (a gap in the list) has no status claim at all.
export function editionStatus(year, editions = PUBLISHED_EDITIONS) {
  if (editions.some((edition) => edition.year === year)) return "published";
  if (year > latestPublishedYear(editions)) return "anticipated";
  return null;
}

export function publicationForYear(year, editions = PUBLISHED_EDITIONS) {
  const type = editionType(year);
  const revision = type === "revision";
  return {
    year,
    type,
    label: editionLabel(year),
    kindLabel: revision ? "Full revision" : "Supplement",
    revisedTo: `${year}-01-01`,
    revisedToLabel: `${MONTH_DAY}, ${year}`,
    legislationThrough: year - 1,
    // Sessions whose changes are new since the previous full revision.
    newSessionYears: revision ? [year - 2, year - 1] : [year - 1],
    // A supplement is read together with the revision published the year before it.
    usedWith: revision ? null : year - 1,
    // A revision replaces the previous revision and the supplement that followed it.
    replaces: revision ? [year - 2, year - 1] : [],
    status: editionStatus(year, editions),
    url: editions.find((edition) => edition.year === year)?.url ?? null
  };
}

// A cycle is a full revision and the supplement that follows it.
export function cycleStartYear(year) {
  return editionType(year) === "revision" ? year : year - 1;
}

// Three cycles: the one before the latest published edition, the latest, and the next.
export function publicationCycle(editions = PUBLISHED_EDITIONS) {
  const first = cycleStartYear(latestPublishedYear(editions)) - 2;
  return Array.from({ length: 6 }, (_, index) => publicationForYear(first + index, editions));
}

// The years the guide's worked examples use: the latest published supplement, the revision it
// is read with, and the revision that will consolidate them.
export function exampleCycle(editions = PUBLISHED_EDITIONS) {
  const supplementYears = editions.map((edition) => edition.year).filter((year) => editionType(year) === "supplement");
  const supplementYear = supplementYears.length ? Math.max(...supplementYears) : cycleStartYear(latestPublishedYear(editions)) + 1;
  return { revisionYear: supplementYear - 1, supplementYear, nextRevisionYear: supplementYear + 1 };
}

// A regular session begins in January in odd-numbered years and in February in even-numbered
// years, as LCO's conversion tables name them ("January 2025 regular session").
export function regularSessionMonth(year) {
  return Math.abs(year) % 2 === 1 ? "January" : "February";
}
