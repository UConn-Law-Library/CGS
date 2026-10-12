import { isExactActQuery, matchActText, matchesActMetadata, sentenceCaseTitle } from "./acts.js";
import { routeForDocument } from "./reader.js";
import { actRouteHref, actsRouteHref, indexRouteHref, infractionsRouteHref, routeHref } from "./routes.js";
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

/**
 * Acts whose citation, bill, or title match the query, then acts whose text
 * does. `sessions` is [{ entry, acts, index }], newest session first. A row
 * marked `exact` answers a query that names an act or bill ("PA 26-2", "SB 299").
 */
export function findActMatches(sessions, query, limit = 3) {
  const value = String(query ?? "").trim();
  if (!value) return [];
  const exact = isExactActQuery(value);
  const wanted = value.toLowerCase();
  const matches = [];
  sessions.forEach(({ entry, acts, index }, sessionOrder) => {
    const textMatches = matchActText(index, value);
    for (const act of acts) {
      const metadata = matchesActMetadata(act, value);
      if (!metadata && !textMatches?.has(act.id)) continue;
      // "26-2" or "sb 299" names this act even without the "P.A." prefix.
      const named = exact || act.citation.match(/\d+-\d+/)?.[0] === wanted || act.bill.toLowerCase() === wanted;
      matches.push({ entry, act, metadata, sessionOrder, rank: named ? 0 : metadata ? 1 : 2 });
    }
  });
  return matches
    .sort((left, right) => left.rank - right.rank
      || (left.act.type === right.act.type ? 0 : left.act.type === "public" ? -1 : 1)
      || left.sessionOrder - right.sessionOrder
      || left.act.number - right.act.number)
    .slice(0, limit)
    .map(({ entry, act, metadata }) => ({
      kind: act.type === "public" ? "Public Act" : "Special Act",
      label: act.citation,
      subtitle: `${sentenceCaseTitle(act.title)} · ${metadata ? act.bill : "Found in the act's text"}`,
      // An act without text is listed with its PDF link.
      href: act.text
        ? actRouteHref(entry.id, act, { query: metadata ? null : value })
        : actsRouteHref({ session: entry.id, query: act.citation }),
      exact
    }));
}

export function buildOmniRows({ statutes = [], titles = [], chapters = [], acts = [], index = [], infractions = [] } = {}) {
  // A query that names an act or bill is looking for that act, not statute text.
  if (acts.some((row) => row.exact)) return [...acts, ...statutes, ...titles, ...chapters, ...index, ...infractions];
  return [...statutes, ...titles, ...chapters, ...acts, ...index, ...infractions];
}
