import { routeForDocument } from "./reader.js";
import { indexRouteHref, infractionsRouteHref, routeHref } from "./routes.js";
import { searchIndexTopics, topicLetter } from "./secondary-ui.js";

function tokensFor(query) {
  return String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function includesTokens(value, tokens) {
  const normalized = String(value ?? "").toLowerCase();
  return tokens.every((token) => normalized.includes(token));
}

function scoreLabel(label, query) {
  const normalized = String(label ?? "").toLowerCase();
  const wanted = String(query ?? "").trim().toLowerCase();
  if (normalized === wanted) return 0;
  if (normalized.startsWith(wanted)) return 1;
  return 2;
}

export function findNavigationMatches(catalog, query, { titleLimit = 2, chapterLimit = 3 } = {}) {
  const tokens = tokensFor(query);
  if (!tokens.length) return { titles: [], chapters: [] };
  const titles = [];
  const chapters = [];
  for (const title of catalog.titles) {
    const titleText = `${title.number} ${title.name}`;
    if (includesTokens(titleText, tokens)) {
      titles.push({
        kind: "Title",
        label: `Title ${title.number}`,
        subtitle: title.name,
        href: routeHref({ title: title.number }),
        score: scoreLabel(title.number, query)
      });
    }
    for (const chapter of title.chapters) {
      const chapterText = `${chapter.number} ${chapter.name} ${title.number} ${title.name}`;
      if (!includesTokens(chapterText, tokens)) continue;
      chapters.push({
        kind: "Chapter",
        label: `Chapter ${chapter.number}`,
        subtitle: `${chapter.name} · Title ${title.number}`,
        href: routeHref({ title: title.number, chapter: chapter.number }),
        score: scoreLabel(chapter.number, query)
      });
    }
  }
  const byScore = (left, right) => left.score - right.score || left.label.localeCompare(right.label);
  return { titles: titles.sort(byScore).slice(0, titleLimit), chapters: chapters.sort(byScore).slice(0, chapterLimit) };
}

export function statuteMatches(results, limit = 5) {
  return results.slice(0, limit).map(({ document }) => ({
    kind: "Section",
    label: `Sec. ${document.citation ?? document.citations.join("–")}`,
    subtitle: `${document.heading} · Title ${document.title.number}, Chapter ${document.chapter.number}${document.supplement ? ` · ${document.supplement.editionYear} Supp.` : ""}`,
    href: routeForDocument(document)
  }));
}

export function findInfractionMatches(entries, query, limit = 3) {
  const tokens = tokensFor(query);
  if (!tokens.length) return [];
  return entries
    .filter((entry) => includesTokens(`${entry.citation} ${entry.description} ${entry.category}`, tokens))
    .sort((left, right) => scoreLabel(left.citation, query) - scoreLabel(right.citation, query)
      || left.citation.localeCompare(right.citation))
    .slice(0, limit)
    .map((entry) => ({
      kind: "Infraction",
      label: `Sec. ${entry.citation}`,
      subtitle: `${entry.description} · ${entry.category}`,
      href: infractionsRouteHref(entry.category, { entry: entry.id })
    }));
}

export function indexLetterForQuery(query) {
  return String(query ?? "").toLowerCase().match(/[a-z]/)?.[0] ?? null;
}

export function findIndexMatches(topics, query, limit = 3) {
  return searchIndexTopics(topics, query, limit).results.map(({ topic, entry }) => ({
    kind: "Index",
    label: topic.label,
    subtitle: entry?.text ?? `Subject heading · ${topic.items.length.toLocaleString()} entries`,
    href: indexRouteHref(topicLetter(topic.label), { topic: topic.id })
  }));
}

export function buildOmniRows({ statutes = [], titles = [], chapters = [], index = [], infractions = [] } = {}) {
  return [...statutes, ...titles, ...chapters, ...index, ...infractions];
}
