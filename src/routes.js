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

export function chapterDisplayLabel(chapter) {
  const number = String(chapter?.number ?? chapter ?? "");
  const article = number.match(/^art[-_](.+)$/i);
  if (article) {
    const display = article[1]
      .replace(/^0+(?=\d)/, "")
      .replace(/[a-z]+$/i, (suffix) => suffix.toUpperCase());
    return `Article ${display}`;
  }
  if (number.startsWith("former-")) {
    return `Former Chapter ${number.slice("former-".length).replace(/^0+(?=\d)/, "")}`;
  }
  return `Chapter ${number.replace(/^0+(?=\d)/, "")}`;
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

export function titlesRouteHref() {
  return "#/titles";
}

export function indexRouteHref(letter = null, {
  topic = null,
  query = null,
  heading = null,
  subheading = null
} = {}) {
  let route = "#/index";
  if (letter) route += `/${encodeSegment(String(letter).toLowerCase().slice(0, 1))}`;
  if (topic) route += `/topic/${encodeSegment(topic)}`;
  const parameters = new URLSearchParams();
  if (query) parameters.set("q", query);
  if (heading) parameters.set("heading", heading);
  if (subheading) parameters.set("subheading", subheading);
  if (parameters.size) route += `?${parameters.toString().replaceAll("+", "%20")}`;
  return route;
}

export function searchRouteHref(query = null, options = {}) {
  const parameters = new URLSearchParams();
  if (query) parameters.set("q", query);
  for (const key of ["title", "chapter", "status", "supplement", "field", "within", "sort"]) {
    if (options[key] && !({ field: "statute", sort: "relevance" }[key] === options[key])) parameters.set(key, options[key]);
  }
  return parameters.size ? `#/search?${parameters.toString().replaceAll("+", "%20")}` : "#/search";
}

export function infractionsRouteHref(category = null, { entry = null, query = null } = {}) {
  let route = "#/infractions";
  if (category) route += `/${encodeSegment(category)}`;
  if (entry) route += `/entry/${encodeSegment(entry)}`;
  if (query) route += `?q=${encodeSegment(query)}`;
  return route;
}

export function actsRouteHref({ session = null, type = null, query = null, sort = null, order = null, view = null, on = null } = {}) {
  const parameters = new URLSearchParams();
  if (view && view !== "acts") parameters.set("view", view);
  if (session) parameters.set("session", session);
  if (type) parameters.set("type", type);
  if (query) parameters.set("q", query);
  if (sort && sort !== (view === "effective" ? "effective" : "newest")) parameters.set("sort", sort);
  if (order === "desc") parameters.set("order", order);
  if (on) parameters.set("on", on);
  return parameters.size ? `#/acts?${parameters.toString().replaceAll("+", "%20")}` : "#/acts";
}

export function actRouteHref(session, act, { section = null, sections = null, query = null } = {}) {
  const parameters = new URLSearchParams();
  if (sections) parameters.set("sections", sections);
  if (section) parameters.set("section", section);
  if (query) parameters.set("q", query);
  const route = `#/acts/${encodeURIComponent(session)}/${act.type === "public" ? "pa" : "sa"}-${act.number}`;
  return parameters.size ? `${route}?${parameters.toString().replaceAll("+", "%20").replaceAll("%2C", ",")}` : route;
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

  if (parts[0] === "search" && parts.length === 1) {
    const parameters = new URLSearchParams(hashQuery);
    return {
      kind: "search",
      query: parameters.get("q") || null,
      title: parameters.get("title") || null,
      chapter: parameters.get("chapter") || null,
      status: parameters.get("status") || null,
      supplement: parameters.get("supplement") || null,
      field: parameters.get("field") || "statute",
      within: parameters.get("within") || null,
      sort: parameters.get("sort") || "relevance"
    };
  }

  if (parts[0] === "infractions") {
    const queryValue = new URLSearchParams(hashQuery).get("q") || null;
    if (parts.length === 1) return { kind: "infractions", category: null, entry: null, query: queryValue };
    if (parts.length === 2 && parts[1]) return { kind: "infractions", category: parts[1], entry: null, query: queryValue };
    if (parts.length === 4 && parts[1] && parts[2] === "entry" && parts[3]) {
      return { kind: "infractions", category: parts[1], entry: parts[3], query: queryValue };
    }
    return { kind: "not-found" };
  }

  if (parts[0] === "acts" && parts.length === 3) {
    const act = parts[2].match(/^(pa|sa)-(\d+)$/);
    if (!parts[1] || !act) return { kind: "not-found" };
    const parameters = new URLSearchParams(hashQuery);
    return {
      kind: "act",
      session: parts[1],
      act: `${act[1]}-${parts[1]}-${Number(act[2])}`,
      section: parameters.get("section") || null,
      sections: parameters.get("sections") || null,
      query: parameters.get("q") || null
    };
  }

  if (parts[0] === "acts" && parts.length === 1) {
    const parameters = new URLSearchParams(hashQuery);
    return {
      kind: "acts",
      session: parameters.get("session") || null,
      type: parameters.get("type") || null,
      query: parameters.get("q") || null,
      sort: parameters.get("sort") || null,
      order: parameters.get("order") || null,
      view: parameters.get("view") || null,
      on: parameters.get("on") || null
    };
  }

  if (parts[0] === "bookmarks" && parts.length === 1) return { kind: "bookmarks" };
  if (parts[0] === "history" && parts.length === 1) return { kind: "history" };

  if (parts[0] === "titles" && parts.length === 1) return { kind: "titles" };

  if (["about", "a"].includes(parts[0]) && parts.length === 1) return { kind: "about" };

  if (parts[0] === "index") {
    const parameters = new URLSearchParams(hashQuery);
    const queryValue = parameters.get("q") || null;
    const target = parameters.has("heading") ? {
      heading: parameters.get("heading"),
      subheading: parameters.get("subheading") || null
    } : {};
    if (parts.length === 1) return { kind: "index", letter: null, topic: null, query: queryValue, ...target };
    if (!/^[a-z0-9]$/i.test(parts[1])) return { kind: "not-found" };
    if (parts.length === 2) return { kind: "index", letter: parts[1].toLowerCase(), topic: null, query: queryValue, ...target };
    if (parts.length === 4 && parts[2] === "topic" && parts[3]) {
      return { kind: "index", letter: parts[1].toLowerCase(), topic: parts[3], query: queryValue, ...target };
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
