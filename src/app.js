import { SearchRepository } from "./search.js";
import { ProgressiveSearchClient } from "./search-client.js";
import {
  findChapter,
  findSection,
  findTitle,
  infractionsRouteHref,
  indexRouteHref,
  parseRoute,
  routeHref,
  searchRouteHref,
  sectionRouteKey
} from "./routes.js";
import {
  escapeHtml,
  extractLegalReferences,
  leadingSubsection,
  renderLinkedText,
  routeForDocument
} from "./reader.js";
import { SecondarySourceRepository } from "./secondary-sources.js";
import { applyPreferences, DeviceState } from "./device-state.js";
import {
  formatMoney,
  renderIndexEntry,
  renderIndexReferences,
  renderSecondaryContext,
  searchIndexTopics,
  topicLetter
} from "./secondary-ui.js";

const app = document.querySelector("#app");
const repository = new SearchRepository();
const searchClient = new ProgressiveSearchClient({ repository });
const secondaryRepository = new SecondarySourceRepository();
const deviceState = new DeviceState();
const catalogPromise = getJson("./data/catalog.json");
let renderSequence = 0;
let activeSearchController = null;
applyPreferences(deviceState.preferences());

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

function activeDestination(route = parseRoute(location)) {
  if (route.kind === "index") return "index";
  if (route.kind === "infractions") return "infractions";
  if (route.kind === "bookmarks") return "bookmarks";
  return "statutes";
}

function navLink({ href, id, icon, label }, active) {
  return `<a href="${href}"${active === id ? ` aria-current="page"` : ""}><span aria-hidden="true">${icon}</span><span>${label}</span></a>`;
}

function settingsPanel() {
  const preferences = deviceState.preferences();
  const bookmarkCount = deviceState.bookmarks().length;
  return `<section class="settings-panel" role="dialog" aria-label="Settings" data-settings-panel hidden>
    <div class="settings-heading"><strong>Settings</strong><button type="button" class="icon-button" data-close-settings aria-label="Close settings">×</button></div>
    <div class="setting-group"><span>Theme</span><div class="segmented" role="group" aria-label="Theme">
      ${["auto", "light", "dark", "oled"].map((theme) => `<button type="button" data-theme-value="${theme}" aria-pressed="${preferences.theme === theme}">${theme[0].toUpperCase()}${theme.slice(1)}</button>`).join("")}
    </div></div>
    <div class="setting-row"><span><strong>Text size</strong><small data-text-size-value>${Math.round(preferences.textScale * 100)}%</small></span><div class="text-size-controls"><button type="button" data-text-size="decrease" aria-label="Decrease text size">A−</button><button type="button" data-text-size="increase" aria-label="Increase text size">A+</button></div></div>
    <label class="setting-row"><span><strong>Compact lists</strong><small>Show more items on screen</small></span><input type="checkbox" data-compact-lists${preferences.compactLists ? " checked" : ""}></label>
    <button type="button" class="settings-action" data-clear-bookmarks${bookmarkCount ? "" : " disabled"}>Clear bookmarks <small>${bookmarkCount ? `${bookmarkCount} saved` : "None saved"}</small></button>
    <a class="settings-action" href="./discover/">Static discovery index <small>Script-free browsing</small></a>
    <p class="settings-note">Installation and full offline data controls will be added with the PWA service-worker phase.</p>
  </section>`;
}

function siteHeader() {
  const route = parseRoute(location);
  const active = activeDestination(route);
  const searchValue = route.kind === "search" ? route.query ?? "" : "";
  return `<header class="site-header">
    <div class="header-bar">
      <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">§</span><span>Connecticut General Statutes</span></a>
      <nav class="app-nav" aria-label="Main sections">
        ${navLink({ href: "#/", id: "statutes", icon: "§", label: "Statutes" }, active)}
        ${navLink({ href: "#/index", id: "index", icon: "A–Z", label: "Index" }, active)}
        ${navLink({ href: "#/infractions", id: "infractions", icon: "⚖", label: "Infractions" }, active)}
        ${navLink({ href: "#/bookmarks", id: "bookmarks", icon: "★", label: "Bookmarks" }, active)}
        <button type="button" data-open-settings aria-expanded="false"><span aria-hidden="true">⚙</span><span>Settings</span></button>
      </nav>
    </div>
    <form class="global-search" data-global-search role="search">
      <label class="visually-hidden" for="global-query">Search statutes</label>
      <input id="global-query" name="query" type="search" minlength="2" required value="${escapeHtml(searchValue)}" placeholder="Search statutes by citation or keyword">
      <button type="submit" class="global-search-button">Search</button>
    </form>
    ${settingsPanel()}
  </header>`;
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items.map((item) =>
    `<li>${item.href ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` : `<span aria-current="page">${escapeHtml(item.label)}</span>`}</li>`
  ).join("")}</ol></nav>`;
}

function titleLabel(title) {
  return `Title ${String(title.number).replace(/^0+(?=\d)/, "")}`;
}

function chapterLabel(chapter) {
  return `Chapter ${String(chapter.number).replace(/^0+(?=\d)/, "")}`;
}

function sectionLabel(section) {
  return section.citation ? `Sec. ${section.citation}` : section.citations?.length ? `Secs. ${section.citations.join(" to ")}` : section.heading;
}

function setDocumentTitle(...parts) {
  document.title = [...parts.filter(Boolean), "Connecticut General Statutes"].join(" · ");
}

function titleRoute(title) {
  return routeHref({ title: title.number });
}

function chapterRoute(title, chapter) {
  return routeHref({ title: title.number, chapter: chapter.number });
}

function provisionRoute(title, chapter, section, subsection = null) {
  return routeHref({
    title: title.number,
    chapter: chapter.number,
    section: sectionRouteKey(section),
    subsection
  });
}

async function referenceMaps(section, catalog) {
  const values = [
    ...section.content.body,
    ...section.content.sourceNotes,
    ...section.content.history,
    ...section.content.annotations.map((annotation) => annotation.text)
  ];
  const references = extractLegalReferences(values);
  const sections = new Map();
  const chapters = new Map();
  const referencedTitles = new Map();

  for (const citation of references.sections) {
    const title = findTitle(catalog, citation.split("-")[0]);
    if (title) referencedTitles.set(title.id, title);
  }

  await Promise.all([...referencedTitles.values()].map(async (title) => {
    const shard = await repository.loadTitle(title.id);
    for (const document of shard.documents) {
      for (const citation of document.citations) {
        if (references.sections.includes(citation.toLowerCase())) {
          sections.set(citation.toLowerCase(), routeHref({
            title: title.number,
            chapter: document.chapter.number,
            section: document.citation ?? document.citations[0] ?? document.id
          }));
        }
      }
    }
  }));

  for (const number of references.chapters) {
    const match = findChapter(catalog, number);
    if (match) chapters.set(number, chapterRoute(match.title, match.chapter));
  }
  return { sections, chapters };
}

function renderParagraph(text, maps, title, chapter, section) {
  const subsection = leadingSubsection(text);
  if (!subsection) return `<p>${renderLinkedText(text, maps)}</p>`;
  const href = provisionRoute(title, chapter, section, subsection.key);
  return `<p id="subsection-${escapeHtml(subsection.key)}" class="statute-paragraph">
    <a class="subsection-link" href="${escapeHtml(href)}" aria-label="Link to subsection ${escapeHtml(subsection.label)}">${escapeHtml(subsection.label)}</a>
    ${renderLinkedText(subsection.text, maps)}
  </p>`;
}

function renderNotes(title, values, maps, { open = false } = {}) {
  if (!values.length) return "";
  return `<details class="notes"${open ? " open" : ""}>
    <summary>${escapeHtml(title)} <span>${values.length}</span></summary>
    <div>${values.map((value) => `<p>${renderLinkedText(value, maps)}</p>`).join("")}</div>
  </details>`;
}

function renderAnnotations(annotations, maps) {
  if (!annotations.length) return "";
  return `<details class="notes annotations">
    <summary>Annotations <span>${annotations.length}</span></summary>
    <div>${annotations.map((annotation) => `<p${annotation.first ? " class=\"annotation-first\"" : ""}>${renderLinkedText(annotation.text, maps)}</p>`).join("")}</div>
  </details>`;
}

function sectionNavigation(title, chapter, sections, selected) {
  const index = sections.indexOf(selected);
  const previous = index > 0 ? sections[index - 1] : null;
  const next = index < sections.length - 1 ? sections[index + 1] : null;
  return `<nav class="adjacent" aria-label="Adjacent sections">
    ${previous ? `<a rel="prev" href="${escapeHtml(provisionRoute(title, chapter, previous))}"><span>Previous</span>${escapeHtml(sectionLabel(previous))}</a>` : "<span></span>"}
    ${next ? `<a rel="next" href="${escapeHtml(provisionRoute(title, chapter, next))}"><span>Next</span>${escapeHtml(sectionLabel(next))}</a>` : ""}
  </nav>`;
}

function readerSidebar(title, chapter, sections, selected = null) {
  return `<aside class="reader-sidebar" aria-label="Chapter sections">
    <a class="sidebar-parent" href="${escapeHtml(titleRoute(title))}">← ${escapeHtml(titleLabel(title))}</a>
    <h2>${escapeHtml(chapterLabel(chapter))}</h2>
    <p>${escapeHtml(chapter.name)}</p>
    <nav><ol>${sections.map((section) => {
      const active = selected === section;
      return `<li><a${active ? " aria-current=\"page\"" : ""} href="${escapeHtml(provisionRoute(title, chapter, section))}">
        <strong>${escapeHtml(sectionLabel(section))}</strong><span>${escapeHtml(section.heading.replace(/^Secs?\.\s*[^.]+\.\s*/, ""))}</span>
      </a></li>`;
    }).join("")}</ol></nav>
  </aside>`;
}

function renderProvision(title, chapter, section, maps, secondaryContext = null) {
  const route = provisionRoute(title, chapter, section);
  const absolute = new URL(route, location.href).href;
  const status = section.status === "active" ? section.kind : section.status;
  const email = `mailto:?subject=${encodeURIComponent(section.heading)}&body=${encodeURIComponent(absolute)}`;
  const bookmark = {
    id: `statute:${title.id}:${chapter.id}:${section.id}`,
    type: "statute",
    title: sectionLabel(section),
    subtitle: section.heading,
    href: route
  };
  return `<article class="provision" id="${escapeHtml(section.id)}">
    <div class="provision-heading">
      <p class="eyebrow">${escapeHtml(status)}</p>
      <h1>${escapeHtml(section.heading)}</h1>
    </div>
    <div class="section-actions" aria-label="Section actions">
      ${bookmarkButton(bookmark)}
      <button type="button" data-copy-link="${escapeHtml(route)}">Copy link</button>
      <button type="button" data-share-link="${escapeHtml(route)}" data-share-title="${escapeHtml(section.heading)}">Share</button>
      <a href="${escapeHtml(email)}">Email</a>
      <a href="${escapeHtml(section.sourceUrl)}">Official source</a>
    </div>
    <p class="action-status" role="status" aria-live="polite"></p>
    <div class="statute-text">${section.content.body.map((paragraph) => renderParagraph(paragraph, maps, title, chapter, section)).join("")}</div>
    ${renderSecondaryContext(secondaryContext)}
    <div class="section-notes">
      ${renderNotes("Source", section.content.sourceNotes, maps, { open: true })}
      ${renderNotes("History", section.content.history, maps)}
      ${renderAnnotations(section.content.annotations, maps)}
    </div>
  </article>`;
}

function renderSearchResults(matches, results) {
  results.innerHTML = matches.map(({ document, score }) => {
    const documentStatus = document.status === "active" ? "" : `<span class="status">${escapeHtml(document.status)}</span>`;
    const excerpt = document.text.slice(0, 240);
    return `<li><a href="${escapeHtml(routeForDocument(document))}"><span class="result-citation">${escapeHtml(document.citation ?? document.citations.join("–"))}</span>${escapeHtml(document.heading)} ${documentStatus}</a>
      <p>${escapeHtml(titleLabel(document.title))} · ${escapeHtml(chapterLabel(document.chapter))} · ${escapeHtml(excerpt)}${document.text.length > 240 ? "…" : ""}</p><span class="visually-hidden">Relevance ${score}</span></li>`;
  }).join("");
}

async function renderHome(catalog) {
  setDocumentTitle();
  app.innerHTML = `${siteHeader()}<main class="home-page" id="main-content">
    <header class="home-intro">
      <p class="eyebrow">UConn Law Library</p>
      <h1>Connecticut General Statutes</h1>
      <p>Browse and search the statutes, the official subject index, and the Judicial Branch infraction schedule. Save frequently used material on this device.</p>
    </header>
    <section class="destination-grid" aria-label="Explore legal materials">
      <a href="#browse-titles"><span aria-hidden="true">§</span><strong>Browse statutes</strong><small>Navigate by title, chapter, or section.</small></a>
      <a href="#/index"><span aria-hidden="true">A–Z</span><strong>Subject index</strong><small>Find statutes by topic in the official LCO index.</small></a>
      <a href="#/infractions"><span aria-hidden="true">⚖</span><strong>Infraction schedule</strong><small>Review violations, amounts, and linked statutes.</small></a>
      <a href="#/bookmarks"><span aria-hidden="true">★</span><strong>Bookmarks</strong><small>Return to sections and infractions saved on this device.</small></a>
    </section>
    <section class="catalog" id="browse-titles" aria-labelledby="browse-heading">
      <div class="section-heading"><div><p class="eyebrow">${catalog.counts.chapters.toLocaleString()} chapters</p><h2 id="browse-heading">Statute titles</h2></div><p>${catalog.counts.sections.toLocaleString()} provisions</p></div>
      <div class="title-grid">${catalog.titles.map((title) => `<a class="title-card" href="${escapeHtml(titleRoute(title))}"><p>${escapeHtml(titleLabel(title))}</p><h3>${escapeHtml(title.name)}</h3><span>${title.chapters.length} chapter${title.chapters.length === 1 ? "" : "s"}</span></a>`).join("")}</div>
    </section>
  </main><footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;
}

async function runStatuteSearch(query, titleId = null) {
  const status = document.querySelector("#search-status");
  const results = document.querySelector("#results");
  const progress = document.querySelector("#search-progress");
  activeSearchController?.abort();
  const controller = new AbortController();
  activeSearchController = controller;
  status.textContent = "Preparing search…";
  results.innerHTML = "";
  results.setAttribute("aria-busy", "true");
  progress.hidden = false;
  progress.value = 0;
  try {
    const matches = await searchClient.search(query, {
      titleIds: titleId ? [titleId] : undefined,
      signal: controller.signal,
      onProgress(update) {
        if (controller !== activeSearchController) return;
        progress.max = Math.max(1, update.total);
        progress.value = update.completed;
        renderSearchResults(update.results, results);
        status.textContent = `Searching ${update.completed} of ${update.total} title shard${update.total === 1 ? "" : "s"}… ${update.results.length} match${update.results.length === 1 ? "" : "es"} so far.`;
      }
    });
    if (controller !== activeSearchController) return;
    status.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;
    renderSearchResults(matches, results);
  } catch (error) {
    if (error.name !== "AbortError" && controller === activeSearchController) status.textContent = error.message;
  } finally {
    if (controller === activeSearchController) {
      results.removeAttribute("aria-busy");
      progress.hidden = true;
      activeSearchController = null;
    }
  }
}

async function renderSearchPage(catalog, route) {
  const query = route.query ?? "";
  setDocumentTitle(query ? `Search: ${query}` : "Search");
  app.innerHTML = `${siteHeader()}<main class="search-page" id="main-content">
    <header><p class="eyebrow">Statutes</p><h1>Search results</h1></header>
    <form class="search-refine" data-search-refine>
      <label for="search-page-query">Citation, phrase, or keyword</label>
      <input id="search-page-query" name="query" type="search" minlength="2" required value="${escapeHtml(query)}">
      <label for="search-title">Limit to a title</label>
      <select id="search-title" name="title"><option value="">All titles</option>${catalog.titles.map((title) => `<option value="${escapeHtml(title.id)}">${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</option>`).join("")}</select>
      <button type="submit">Search</button>
    </form>
    <progress id="search-progress" value="0" max="1" hidden>Search progress</progress>
    <div id="search-status" role="status" aria-live="polite">${query ? "Preparing search…" : "Enter at least two characters."}</div>
    <ol id="results" class="results"></ol>
  </main><footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;
  if (query.length >= 2) await runStatuteSearch(query);
}

function renderTitle(title) {
  setDocumentTitle(titleLabel(title));
  app.innerHTML = `${siteHeader()}<main class="browse-page" id="main-content">
    ${breadcrumbs([{ label: "Titles", href: "#/" }, { label: titleLabel(title) }])}
    <div class="browse-heading"><div><p class="eyebrow">${title.chapters.length} chapters</p><h1>${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</h1></div><a href="${escapeHtml(title.sourceUrl)}">Official title source</a></div>
    <ol class="chapter-list">${title.chapters.map((chapter) => `<li><a href="${escapeHtml(chapterRoute(title, chapter))}"><strong>${escapeHtml(chapterLabel(chapter))}</strong><span>${escapeHtml(chapter.name)}</span><small>${chapter.sectionCount} provision${chapter.sectionCount === 1 ? "" : "s"}</small></a></li>`).join("")}</ol>
  </main><footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;
}

async function sectionSecondaryContext(title, section, requestedCitation) {
  const wanted = String(requestedCitation ?? "").toLowerCase();
  const citation = section.citations.find((value) => value.toLowerCase() === wanted)
    ?? section.citation
    ?? section.citations[0];
  try {
    return await secondaryRepository.loadSectionContext(title.id, citation);
  } catch (error) {
    console.warn("Could not load related legal data", error);
    return { error };
  }
}

async function renderChapter(catalog, title, chapterMeta, route) {
  const chapter = await getJson(`./data/${chapterMeta.path}`);
  const selected = route.kind === "section" ? findSection(chapter, route.section) : null;
  if (route.kind === "section" && !selected) return renderNotFound("That provision was not found.");

  if (route.legacyQuery) {
    const canonicalRoute = selected ? provisionRoute(title, chapter, selected) : chapterRoute(title, chapter);
    history.replaceState(null, "", `${location.pathname}${canonicalRoute}`);
  }

  const [maps, secondaryContext] = selected
    ? await Promise.all([
        referenceMaps(selected, catalog),
        sectionSecondaryContext(title, selected, route.section)
      ])
    : [null, null];
  setDocumentTitle(selected ? sectionLabel(selected) : chapterLabel(chapter), titleLabel(title));
  app.innerHTML = `${siteHeader()}<div class="reader-shell" id="main-content">
    ${readerSidebar(title, chapter, chapter.sections, selected)}
    <main class="reader-content">
      ${breadcrumbs([
        { label: "Titles", href: "#/" },
        { label: titleLabel(title), href: titleRoute(title) },
        { label: chapterLabel(chapter), href: selected ? chapterRoute(title, chapter) : null },
        ...(selected ? [{ label: sectionLabel(selected) }] : [])
      ])}
      ${selected ? `${renderProvision(title, chapter, selected, maps, secondaryContext)}${sectionNavigation(title, chapter, chapter.sections, selected)}` : `<div class="chapter-overview"><p class="eyebrow">${chapter.sections.length} provisions</p><h1>${escapeHtml(chapterLabel(chapter))} — ${escapeHtml(chapter.name)}</h1><p>Choose a provision from the chapter list.</p><a href="${escapeHtml(chapter.sourceUrl)}">Official chapter source</a></div>`}
    </main>
  </div>`;

  if (route.subsection) {
    const target = document.querySelector(`#subsection-${CSS.escape(route.subsection.toLowerCase())}`);
    if (target) {
      target.tabIndex = -1;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    }
  } else {
    window.scrollTo({ top: 0 });
  }
}

function renderIndexSearchResults(search) {
  if (!search.results.length) return `<p class="empty-state">No entries in this letter match the search terms.</p>`;
  return `<div class="index-result-heading"><h2>Search results</h2><p>${search.total.toLocaleString()} match${search.total === 1 ? "" : "es"}${search.truncated ? "; showing the first 100" : ""}</p></div>
    <ol class="index-search-results">${search.results.map(({ topic, entry }) => {
      const href = indexRouteHref(topicLetter(topic.label), { topic: topic.id });
      if (!entry) return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(topic.label)}</strong></a><p>Subject heading · ${topic.items.length.toLocaleString()} entries</p></li>`;
      return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(topic.label)}</strong></a><p>${escapeHtml(entry.text)} ${renderIndexReferences(entry.references)}</p></li>`;
    }).join("")}</ol>`;
}

function renderTopic(topic, initialCount = 250) {
  const shown = Math.min(initialCount, topic.items.length);
  return `<article class="index-topic" id="${escapeHtml(topic.id)}" tabindex="-1">
    <p class="eyebrow">Subject heading</p>
    <h2>${escapeHtml(topic.label)}</h2>
    <p>${topic.items.length.toLocaleString()} index entr${topic.items.length === 1 ? "y" : "ies"}</p>
    <ol class="index-entries" data-index-entries>${topic.items.slice(0, shown).map(renderIndexEntry).join("")}</ol>
    ${shown < topic.items.length ? `<button type="button" class="index-more" data-index-more data-shown="${shown}">Show 250 more entries</button>` : ""}
  </article>`;
}

function bookmarkButton(bookmark, className = "") {
  const saved = deviceState.isBookmarked(bookmark.id);
  return `<button type="button" class="bookmark-button${className ? ` ${className}` : ""}"
    data-bookmark-id="${escapeHtml(bookmark.id)}"
    data-bookmark-type="${escapeHtml(bookmark.type)}"
    data-bookmark-title="${escapeHtml(bookmark.title)}"
    data-bookmark-subtitle="${escapeHtml(bookmark.subtitle ?? "")}"
    data-bookmark-href="${escapeHtml(bookmark.href)}"
    aria-pressed="${saved}">${saved ? "★ Saved" : "☆ Bookmark"}</button>`;
}

function groupInfractions(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.category)) groups.set(entry.category, []);
    groups.get(entry.category).push(entry);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right));
}

function infractionBookmark(entry) {
  return {
    id: `infraction:${entry.id}`,
    type: "infraction",
    title: `Sec. ${entry.citation}`,
    subtitle: entry.description,
    href: infractionsRouteHref(entry.category, { entry: entry.id })
  };
}

function renderInfractionListItem(entry) {
  const href = infractionsRouteHref(entry.category, { entry: entry.id });
  const total = entry.amounts?.total_due;
  return `<li class="infraction-card">
    <a href="${escapeHtml(href)}"><span class="infraction-citation">Sec. ${escapeHtml(entry.citation)}</span><strong>${escapeHtml(entry.description)}</strong>${total != null ? `<small>Total due ${escapeHtml(formatMoney(total))}</small>` : ""}</a>
    ${bookmarkButton(infractionBookmark(entry), "compact-bookmark")}
  </li>`;
}

function amountLabel(key) {
  return ({ total_due: "Total due", fine: "Fine", fee: "Fee", surcharge: "Surcharge", cost: "Cost" })[key]
    ?? key.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function renderInfractionDetail(entry, source) {
  return `<article class="infraction-detail">
    <p class="eyebrow">${escapeHtml(entry.category)}</p>
    <h1>Sec. ${escapeHtml(entry.citation)}</h1>
    <p class="infraction-description">${escapeHtml(entry.description)}</p>
    ${entry.subsequent ? `<span class="record-tag">Subsequent offense</span>` : ""}
    ${Object.keys(entry.amounts ?? {}).length ? `<dl class="amounts">${Object.entries(entry.amounts).map(([key, value]) => `<div><dt>${escapeHtml(amountLabel(key))}</dt><dd>${escapeHtml(formatMoney(value))}</dd></div>`).join("")}</dl>` : `<p>See the official schedule for the applicable amount.</p>`}
    <div class="section-actions">
      ${bookmarkButton(infractionBookmark(entry))}
      ${entry.resolution?.href ? `<a href="${escapeHtml(entry.resolution.href)}">Open statute</a>` : ""}
      <a href="${escapeHtml(source.url)}">Official schedule</a>
    </div>
    <p class="source-note">Judicial Branch schedule effective ${escapeHtml(source.effective ?? "date not stated")} · Source page ${entry.page}</p>
  </article>`;
}

async function renderInfractions(route) {
  const [manifests, entries] = await Promise.all([
    secondaryRepository.init(),
    secondaryRepository.loadAllInfractions()
  ]);
  const groups = groupInfractions(entries);
  const selectedGroup = route.category ? groups.find(([category]) => category === route.category) : null;
  if (route.category && !selectedGroup) return renderNotFound("That infraction category was not found.");
  const selectedEntry = route.entry ? selectedGroup[1].find((entry) => entry.id === route.entry) : null;
  if (route.entry && !selectedEntry) return renderNotFound("That infraction entry was not found.");
  const query = route.query?.trim().toLowerCase() ?? "";
  const tokens = query.split(/\s+/).filter(Boolean);
  const filtered = selectedGroup ? selectedGroup[1].filter((entry) => {
    const text = `${entry.citation} ${entry.description}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  }) : [];
  const shown = filtered.slice(0, 150);
  setDocumentTitle(selectedEntry ? `Sec. ${selectedEntry.citation}` : selectedGroup?.[0] ?? "Infractions");
  app.innerHTML = `${siteHeader()}<main class="infractions-page" id="main-content">
    ${breadcrumbs([{ label: "Infractions", ...(selectedGroup ? { href: "#/infractions" } : {}) }, ...(selectedGroup ? [{ label: selectedGroup[0], ...(selectedEntry ? { href: infractionsRouteHref(selectedGroup[0]) } : {}) }] : []), ...(selectedEntry ? [{ label: `Sec. ${selectedEntry.citation}` }] : [])])}
    ${selectedEntry ? renderInfractionDetail(selectedEntry, manifests.infractions.source) : selectedGroup ? `<header class="section-heading"><div><p class="eyebrow">Judicial Branch schedule</p><h1>${escapeHtml(selectedGroup[0])}</h1></div><p>${selectedGroup[1].length.toLocaleString()} entries</p></header>
      <form class="infraction-search" data-infraction-search>
        <label for="infraction-query">Search this category</label>
        <input id="infraction-query" name="query" type="search" value="${escapeHtml(route.query ?? "")}" placeholder="Citation or description">
        <button type="submit">Search</button>
      </form>
      <p class="note">${filtered.length.toLocaleString()} matching entr${filtered.length === 1 ? "y" : "ies"}${filtered.length > shown.length ? `; showing the first ${shown.length}` : ""}.</p>
      <ol class="infraction-list">${shown.map(renderInfractionListItem).join("")}</ol>` : `<header class="index-intro"><p class="eyebrow">State of Connecticut Judicial Branch</p><h1>Infractions and violations</h1><p>Browse the official mail-in schedule by category, then open an entry for amounts and its linked statute.</p><p class="source-note">Effective ${escapeHtml(manifests.infractions.source.effective ?? "date not stated")} · ${entries.length.toLocaleString()} entries · <a href="${escapeHtml(manifests.infractions.source.url)}">Official schedule (PDF)</a></p></header>
      <ol class="infraction-categories">${groups.map(([category, values]) => `<li><a href="${escapeHtml(infractionsRouteHref(category))}"><span>${values.length.toLocaleString()} entries</span><strong>${escapeHtml(category)}</strong></a></li>`).join("")}</ol>`}
  </main><footer>Unofficial access copy. Verify amounts and eligibility with the Judicial Branch.</footer>`;
  window.scrollTo({ top: 0 });
}

function renderBookmarks() {
  const bookmarks = deviceState.bookmarks();
  setDocumentTitle("Bookmarks");
  app.innerHTML = `${siteHeader()}<main class="bookmarks-page" id="main-content">
    <header><p class="eyebrow">Saved on this device</p><h1>Bookmarks</h1><p>Quick links remain in this browser and are never sent to a server.</p></header>
    ${bookmarks.length ? `<ol class="bookmark-list">${bookmarks.map((bookmark) => `<li><a href="${escapeHtml(bookmark.href)}"><span>${bookmark.type === "infraction" ? "Infraction" : "Statute"}</span><strong>${escapeHtml(bookmark.title)}</strong><small>${escapeHtml(bookmark.subtitle ?? "")}</small></a><button type="button" data-remove-bookmark="${escapeHtml(bookmark.id)}" aria-label="Remove ${escapeHtml(bookmark.title)} from bookmarks">Remove</button></li>`).join("")}</ol>` : `<div class="empty-state"><p>You have not saved any bookmarks.</p><p>Select <strong>☆ Bookmark</strong> on a statute section or infraction to save it here.</p></div>`}
  </main><footer>Bookmarks are stored only on this device.</footer>`;
}

async function renderStatutesIndex(route) {
  const manifests = await secondaryRepository.init();
  const available = [...new Set(manifests.index.shards.map((shard) => shard.key))];
  const letter = route.letter ?? "a";
  if (!available.includes(letter)) return renderNotFound("That index letter was not found.");
  const topics = await secondaryRepository.loadIndexLetter(letter);
  const selected = route.topic ? topics.find((topic) => topic.id === route.topic) : null;
  if (route.topic && !selected) return renderNotFound("That index heading was not found.");
  const search = route.query ? searchIndexTopics(topics, route.query) : null;
  const source = manifests.index.source;
  setDocumentTitle(selected?.label ?? `Statutes index ${letter.toUpperCase()}`);
  app.innerHTML = `${siteHeader()}<main class="index-page" id="main-content">
    ${breadcrumbs([{ label: "Titles", href: "#/" }, { label: "General Statutes index", ...(selected || route.query ? { href: indexRouteHref(letter) } : {}) }, ...(selected ? [{ label: selected.label }] : [])])}
    <header class="index-intro">
      <p class="eyebrow">Legislative Commissioners' Office</p>
      <h1>Index to the General Statutes</h1>
      <p>Browse official subject headings and follow resolved citations into the statute reader. ${escapeHtml(source.revision)}.</p>
      <p class="source-note"><a href="${escapeHtml(source.url)}">View the official index volumes</a> · ${manifests.index.counts.headings.toLocaleString()} headings · ${manifests.index.counts.items.toLocaleString()} entries</p>
    </header>
    <form class="index-search-form" id="index-search-form">
      <label for="index-query">Search the subject index</label>
      <input id="index-query" name="query" type="search" minlength="2" required value="${escapeHtml(route.query ?? "")}" placeholder="Try motor vehicles">
      <button type="submit">Search index</button>
    </form>
    <nav class="index-alphabet" aria-label="Index letters">${available.filter((key) => /^[a-z]$/.test(key)).map((key) =>
      `<a href="${escapeHtml(indexRouteHref(key))}"${key === letter ? ` aria-current="page"` : ""}>${key.toUpperCase()}</a>`
    ).join("")}</nav>
    <section class="index-browser" aria-live="polite">
      ${selected ? renderTopic(selected) : search ? renderIndexSearchResults(search) : `<div class="index-result-heading"><h2>${escapeHtml(letter.toUpperCase())} headings</h2><p>${topics.length.toLocaleString()} subjects</p></div>
        <ol class="index-headings">${topics.map((topic) => `<li><a href="${escapeHtml(indexRouteHref(letter, { topic: topic.id }))}"><strong>${escapeHtml(topic.label)}</strong><span>${topic.items.length.toLocaleString()} entr${topic.items.length === 1 ? "y" : "ies"}</span></a></li>`).join("")}</ol>`}
    </section>
    <aside class="legal-data-note"><strong>About this index</strong><p>This is a derived access copy of the official index, not legal text. Verify coverage and citations with the Legislative Commissioners' Office source.</p></aside>
  </main><footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;

  document.querySelector("#index-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("query").trim();
    location.hash = indexRouteHref(topicLetter(query), { query });
  });
  const more = document.querySelector("[data-index-more]");
  if (more && selected) more.addEventListener("click", () => {
    const start = Number(more.dataset.shown);
    const end = Math.min(start + 250, selected.items.length);
    document.querySelector("[data-index-entries]").insertAdjacentHTML("beforeend", selected.items.slice(start, end).map(renderIndexEntry).join(""));
    more.dataset.shown = String(end);
    if (end === selected.items.length) more.remove();
    else more.textContent = `Show 250 more entries (${(selected.items.length - end).toLocaleString()} remaining)`;
  });
  if (selected) document.querySelector(".index-topic")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function renderNotFound(message = "That page was not found.") {
  setDocumentTitle("Not found");
  app.innerHTML = `${siteHeader()}<main class="error" id="main-content"><p class="eyebrow">Not found</p><h1>${escapeHtml(message)}</h1><p><a href="#/">Browse the statutes</a></p></main>`;
}

async function renderCurrentRoute() {
  activeSearchController?.abort();
  activeSearchController = null;
  const sequence = ++renderSequence;
  try {
    const catalog = await catalogPromise;
    const route = parseRoute(location);
    if (sequence !== renderSequence) return;
    if (route.kind === "home") return renderHome(catalog);
    if (route.kind === "not-found") return renderNotFound();
    if (route.kind === "search") return renderSearchPage(catalog, route);
    if (route.kind === "infractions") return renderInfractions(route);
    if (route.kind === "bookmarks") return renderBookmarks();
    if (route.kind === "index") return renderStatutesIndex(route);

    let title = route.title ? findTitle(catalog, route.title) : null;
    let chapterMatch = route.chapter ? findChapter(catalog, route.chapter, title) : null;
    if (!title && chapterMatch) title = chapterMatch.title;
    if (!title) return renderNotFound("That title was not found.");
    if (route.kind === "title") return renderTitle(title);
    if (!chapterMatch) chapterMatch = findChapter(catalog, route.chapter, title);
    if (!chapterMatch) return renderNotFound("That chapter was not found.");
    return renderChapter(catalog, title, chapterMatch.chapter, route);
  } catch (error) {
    app.innerHTML = `<main class="error" id="main-content"><h1>Unable to load the statutes</h1><p>${escapeHtml(error.message)}</p></main>`;
  }
}

document.addEventListener("click", async (event) => {
  const skip = event.target.closest("[data-skip-link]");
  if (skip) {
    event.preventDefault();
    const target = document.querySelector("#main-content");
    if (target) {
      target.tabIndex = -1;
      target.focus();
    }
    return;
  }
  const openSettings = event.target.closest("[data-open-settings]");
  const closeSettings = event.target.closest("[data-close-settings]");
  if (openSettings || closeSettings) {
    const panel = document.querySelector("[data-settings-panel]");
    const button = document.querySelector("[data-open-settings]");
    const open = Boolean(openSettings) && panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) panel.querySelector("button")?.focus();
    else button.focus();
    return;
  }
  const themeButton = event.target.closest("[data-theme-value]");
  if (themeButton) {
    const preferences = deviceState.updatePreferences({ theme: themeButton.dataset.themeValue });
    applyPreferences(preferences);
    document.querySelectorAll("[data-theme-value]").forEach((button) => button.setAttribute("aria-pressed", String(button === themeButton)));
    return;
  }
  const textSizeButton = event.target.closest("[data-text-size]");
  if (textSizeButton) {
    const current = deviceState.preferences();
    const direction = textSizeButton.dataset.textSize === "increase" ? 1 : -1;
    const preferences = deviceState.updatePreferences({ textScale: Math.round((current.textScale + direction * .1) * 10) / 10 });
    applyPreferences(preferences);
    document.querySelector("[data-text-size-value]").textContent = `${Math.round(preferences.textScale * 100)}%`;
    return;
  }
  const clearBookmarks = event.target.closest("[data-clear-bookmarks]");
  if (clearBookmarks) {
    deviceState.clearBookmarks();
    if (parseRoute(location).kind === "bookmarks") renderBookmarks();
    else {
      clearBookmarks.disabled = true;
      clearBookmarks.querySelector("small").textContent = "None saved";
    }
    return;
  }
  const removeBookmark = event.target.closest("[data-remove-bookmark]");
  if (removeBookmark) {
    deviceState.removeBookmark(removeBookmark.dataset.removeBookmark);
    renderBookmarks();
    return;
  }
  const bookmarkButton = event.target.closest("[data-bookmark-id]");
  if (bookmarkButton) {
    const saved = deviceState.toggleBookmark({
      id: bookmarkButton.dataset.bookmarkId,
      type: bookmarkButton.dataset.bookmarkType,
      title: bookmarkButton.dataset.bookmarkTitle,
      subtitle: bookmarkButton.dataset.bookmarkSubtitle,
      href: bookmarkButton.dataset.bookmarkHref
    });
    bookmarkButton.setAttribute("aria-pressed", String(saved));
    bookmarkButton.textContent = saved ? "★ Saved" : "☆ Bookmark";
    const status = bookmarkButton.closest(".provision")?.querySelector(".action-status");
    if (status) status.textContent = saved ? "Bookmark saved on this device." : "Bookmark removed.";
    return;
  }
  const copy = event.target.closest("[data-copy-link]");
  const share = event.target.closest("[data-share-link]");
  if (!copy && !share) return;
  const button = copy ?? share;
  const url = new URL(button.dataset.copyLink ?? button.dataset.shareLink, location.href).href;
  const status = button.closest(".provision")?.querySelector(".action-status");
  try {
    if (share && navigator.share) await navigator.share({ title: share.dataset.shareTitle, url });
    else await navigator.clipboard.writeText(url);
    if (status) status.textContent = share && navigator.share ? "Share options opened." : "Link copied.";
  } catch (error) {
    if (error.name !== "AbortError" && status) status.textContent = "The link could not be copied automatically.";
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-compact-lists]")) return;
  applyPreferences(deviceState.updatePreferences({ compactLists: event.target.checked }));
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.matches("[data-global-search]")) {
    event.preventDefault();
    const query = new FormData(form).get("query").trim();
    location.hash = searchRouteHref(query);
    return;
  }
  if (form.matches("[data-search-refine]")) {
    event.preventDefault();
    const values = new FormData(form);
    const query = values.get("query").trim();
    history.replaceState(null, "", `${location.pathname}${searchRouteHref(query)}`);
    runStatuteSearch(query, values.get("title") || null);
    return;
  }
  if (form.matches("[data-infraction-search]")) {
    event.preventDefault();
    const route = parseRoute(location);
    const query = new FormData(form).get("query").trim();
    location.hash = infractionsRouteHref(route.category, { query });
  }
});

window.addEventListener("hashchange", renderCurrentRoute);
renderCurrentRoute();
