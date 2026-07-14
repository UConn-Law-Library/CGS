function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeSegment(value) {
  return encodeURIComponent(String(value));
}

export function comparableNumber(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, "");
}

export function routeHref({ title, chapter, section, subsection } = {}) {
  if (!title) return "#/";
  let route = `#/t/${encodeSegment(title)}`;
  if (!chapter) return route;
  route += `/c/${encodeSegment(chapter)}`;
  if (!section) return route;
  route += `/s/${encodeSegment(section)}`;
  if (subsection) route += `/p/${encodeSegment(subsection)}`;
  return route;
}

export function indexRouteHref(letter = null, { topic = null, query = null } = {}) {
  let route = "#/index";
  if (letter) route += `/${encodeSegment(String(letter).toLowerCase().slice(0, 1))}`;
  if (topic) route += `/topic/${encodeSegment(topic)}`;
  if (query) route += `?q=${encodeSegment(query)}`;
  return route;
}

export function parseRoute({ hash = "", search = "" } = {}) {
  const query = new URLSearchParams(search);
  if ((!hash || hash === "#" || hash === "#/") && query.has("chapter")) {
    return {
      kind: query.has("section") ? "section" : "chapter",
      title: null,
      chapter: query.get("chapter"),
      section: query.get("section"),
      subsection: null,
      legacyQuery: true
    };
  }

  const [hashPath, hashQuery = ""] = hash.split("?", 2);
  const path = hashPath.replace(/^#\/?/, "").replace(/\/$/, "");
  if (!path) return { kind: "home" };
  const parts = path.split("/").map(decodeSegment);

  if (parts[0] === "index") {
    const queryValue = new URLSearchParams(hashQuery).get("q") || null;
    if (parts.length === 1) return { kind: "index", letter: null, topic: null, query: queryValue };
    if (!/^[a-z0-9]$/i.test(parts[1])) return { kind: "not-found" };
    if (parts.length === 2) return { kind: "index", letter: parts[1].toLowerCase(), topic: null, query: queryValue };
    if (parts.length === 4 && parts[2] === "topic" && parts[3]) {
      return { kind: "index", letter: parts[1].toLowerCase(), topic: parts[3], query: queryValue };
    }
    return { kind: "not-found" };
  }

  if (parts[0] !== "t" || !parts[1]) return { kind: "not-found" };
  if (parts.length === 2) return { kind: "title", title: parts[1] };
  if (parts[2] !== "c" || !parts[3]) return { kind: "not-found" };
  if (parts.length === 4) return { kind: "chapter", title: parts[1], chapter: parts[3] };
  if (parts[4] !== "s" || !parts[5]) return { kind: "not-found" };
  if (parts.length === 6) {
    return { kind: "section", title: parts[1], chapter: parts[3], section: parts[5], subsection: null };
  }
  if (parts.length === 8 && parts[6] === "p" && parts[7]) {
    return { kind: "section", title: parts[1], chapter: parts[3], section: parts[5], subsection: parts[7] };
  }
  return { kind: "not-found" };
}

export function findTitle(catalog, number) {
  const wanted = comparableNumber(number);
  return catalog.titles.find((title) => comparableNumber(title.number) === wanted);
}

export function findChapter(catalog, number, title = null) {
  const wanted = comparableNumber(number);
  const titles = title ? [title] : catalog.titles;
  for (const candidateTitle of titles) {
    const chapter = candidateTitle.chapters.find((item) => comparableNumber(item.number) === wanted);
    if (chapter) return { title: candidateTitle, chapter };
  }
  return null;
}

export function sectionRouteKey(section) {
  return section.citation ?? section.citations?.[0] ?? section.id;
}

export function findSection(chapter, key) {
  const wanted = String(key ?? "").toLowerCase();
  return chapter.sections.find((section) =>
    section.id.toLowerCase() === wanted
    || section.citation?.toLowerCase() === wanted
    || section.citations.some((citation) => citation.toLowerCase() === wanted)
  );
}
