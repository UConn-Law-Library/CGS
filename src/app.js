import { SearchRepository } from "./search.js";
import { applyChapterOverlay, SupplementRepository } from "./supplements.js";
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
  navigationSections,
  renderLinkedText,
  routeForDocument
} from "./reader.js";
import { SecondarySourceRepository } from "./secondary-sources.js";
import { applyPreferences, DeviceState } from "./device-state.js";
import { PwaManager } from "./pwa.js";
import {
  buildOmniRows,
  findIndexMatches,
  findInfractionMatches,
  findNavigationMatches,
  indexLetterForQuery,
  statuteMatches
} from "./omnisearch.js";
import {
  formatMoney,
  renderIndexEntry,
  renderIndexReferences,
  renderSecondaryContext,
  searchIndexTopics,
  topicLetter
} from "./secondary-ui.js";

const app = document.querySelector("#app");
const supplementRepository = new SupplementRepository();
const repository = new SearchRepository({ supplementRepository });
const searchClient = new ProgressiveSearchClient({ repository });
const secondaryRepository = new SecondarySourceRepository();
const deviceState = new DeviceState();
const pwaManager = new PwaManager();
const catalogPromise = getJson("./data/catalog.json");
let renderSequence = 0;
let activeSearchController = null;
let activeOmniController = null;
let omniTimer = null;
let omniSelection = -1;
let pwaState = pwaManager.state;
const SEARCH_BATCH_SIZE = 50;
applyPreferences(deviceState.preferences());
pwaManager.subscribe((state) => {
  pwaState = state;
  updatePwaControls();
});
pwaManager.init();

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

function installStatus(state) {
  if (state.installed) return "Installed on this device";
  if (state.installable) return "Ready to install";
  return state.supported ? "Use the browser menu if unavailable" : "Not supported by this browser";
}

function offlineStatus(state) {
  if (state.error) return state.error;
  if (state.busy && state.totalFiles) return `Downloading ${state.cachedFiles.toLocaleString()} of ${state.totalFiles.toLocaleString()} files…`;
  if (state.complete) return `${state.cachedFiles.toLocaleString()} files available offline`;
  if (state.ready) return "Download the complete published dataset";
  return state.supported ? "Preparing offline storage…" : "Offline storage is unavailable";
}

function formatStorage(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function storageStatus(state) {
  const usage = formatStorage(state.storageUsage);
  const quota = formatStorage(state.storageQuota);
  if (usage && quota) return `Browser storage for this site: ${usage} used of ${quota}`;
  if (usage) return `Browser storage for this site: ${usage} used`;
  return "Storage usage is not reported by this browser.";
}

function updatePwaControls() {
  const install = document.querySelector("[data-install-app]");
  const download = document.querySelector("[data-download-offline]");
  const clear = document.querySelector("[data-clear-offline]");
  const status = document.querySelector("[data-pwa-status]");
  const storage = document.querySelector("[data-storage-status]");
  const update = document.querySelector("[data-apply-update]");
  const progress = document.querySelector("[data-pwa-progress]");
  if (!install) return;
  install.disabled = pwaState.installed || !pwaState.installable;
  install.querySelector("small").textContent = installStatus(pwaState);
  download.disabled = !pwaState.ready || pwaState.busy;
  download.querySelector("[data-offline-action-label]").textContent = pwaState.complete ? "Refresh offline data" : "Download for offline use";
  clear.disabled = !pwaState.cachedFiles || pwaState.busy;
  status.textContent = offlineStatus(pwaState);
  storage.textContent = storageStatus(pwaState);
  update.hidden = !pwaState.updateAvailable;
  progress.hidden = !pwaState.busy || !pwaState.totalFiles;
  progress.max = Math.max(1, pwaState.totalFiles);
  progress.value = pwaState.cachedFiles;
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
    <label class="setting-row"><span><strong>Hide repealed sections</strong><small>Remove them from chapter navigation</small></span><input type="checkbox" data-hide-repealed${preferences.hideRepealedSections ? " checked" : ""}></label>
    <button type="button" class="settings-action update-action" data-apply-update${pwaState.updateAvailable ? "" : " hidden"}>Update available <small>Reload to use the latest published app</small></button>
    <button type="button" class="settings-action" data-install-app${pwaState.installed || !pwaState.installable ? " disabled" : ""}>Install app <small>${escapeHtml(installStatus(pwaState))}</small></button>
    <button type="button" class="settings-action" data-download-offline${!pwaState.ready || pwaState.busy ? " disabled" : ""}><span data-offline-action-label>${pwaState.complete ? "Refresh offline data" : "Download for offline use"}</span><small>Statutes, supplements, search, index, and infractions</small></button>
    <progress class="offline-progress" data-pwa-progress value="${pwaState.cachedFiles}" max="${Math.max(1, pwaState.totalFiles)}"${!pwaState.busy || !pwaState.totalFiles ? " hidden" : ""}>Offline download progress</progress>
    <button type="button" class="settings-action" data-clear-offline${!pwaState.cachedFiles || pwaState.busy ? " disabled" : ""}>Remove offline data <small>Keep the installed app shell</small></button>
    <p class="settings-note" data-pwa-status role="status" aria-live="polite">${escapeHtml(offlineStatus(pwaState))}</p>
    <p class="settings-note" data-storage-status>${escapeHtml(storageStatus(pwaState))}</p>
    <button type="button" class="settings-action" data-clear-bookmarks${bookmarkCount ? "" : " disabled"}>Clear bookmarks <small>${bookmarkCount ? `${bookmarkCount} saved` : "None saved"}</small></button>
    <a class="settings-action" href="./discover/">Static discovery index <small>Script-free browsing</small></a>
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
      <label class="visually-hidden" for="global-query">Search statutes, index topics, and infractions</label>
      <div class="global-search-field">
        <input id="global-query" name="query" type="search" minlength="2" required value="${escapeHtml(searchValue)}" placeholder="Search statutes, index, and infractions" autocomplete="off" spellcheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="omni-results" data-omni-input>
        <kbd class="omni-shortcut" aria-hidden="true">/</kbd>
        <div class="omni-panel" id="omni-results" role="listbox" hidden data-omni-panel></div>
      </div>
      <button type="submit" class="global-search-button">Search</button>
    </form>
    ${settingsPanel()}
  </header>`;
}

function omniItems() {
  return [...document.querySelectorAll("[data-omni-option]")];
}

function closeOmni({ abort = true } = {}) {
  clearTimeout(omniTimer);
  omniTimer = null;
  if (abort) activeOmniController?.abort();
  if (abort) activeOmniController = null;
  const input = document.querySelector("[data-omni-input]");
  const panel = document.querySelector("[data-omni-panel]");
  if (panel) panel.hidden = true;
  input?.setAttribute("aria-expanded", "false");
  input?.removeAttribute("aria-activedescendant");
  omniSelection = -1;
}

function renderOmniPanel(query, groups, { completed = 0, total = 0, pending = false } = {}) {
  const input = document.querySelector("[data-omni-input]");
  const panel = document.querySelector("[data-omni-panel]");
  if (!input || !panel || input.value.trim() !== query) return;
  const previousHref = omniItems()[omniSelection]?.getAttribute("href") ?? null;
  const rows = buildOmniRows(groups);
  const body = rows.length ? rows.map((row, index) => `<a class="omni-item" id="omni-option-${index}" role="option" aria-selected="false" data-omni-option href="${escapeHtml(row.href)}">
      <span class="omni-kind">${escapeHtml(row.kind)}</span>
      <strong class="omni-main">${escapeHtml(row.label)}</strong>
      <small class="omni-sub">${escapeHtml(row.subtitle)}</small>
    </a>`).join("") : `<p class="omni-empty">${pending ? "Searching published legal data…" : "No quick matches. Press Enter for complete statute results."}</p>`;
  const progress = pending && total ? `Searching ${completed} of ${total} statute titles…` : pending ? "Searching published legal data…" : `${rows.length} quick match${rows.length === 1 ? "" : "es"}`;
  panel.innerHTML = `${body}<div class="omni-foot"><span>${escapeHtml(progress)}</span><span>Enter: full statute results · ↑↓: choose · Esc: close</span></div>`;
  panel.hidden = false;
  input.setAttribute("aria-expanded", "true");
  omniSelection = previousHref ? omniItems().findIndex((item) => item.getAttribute("href") === previousHref) : -1;
  if (omniSelection >= 0) {
    const active = omniItems()[omniSelection];
    active.classList.add("selected");
    active.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", active.id);
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function moveOmniSelection(delta) {
  const input = document.querySelector("[data-omni-input]");
  const items = omniItems();
  if (!items.length) return false;
  omniSelection = (omniSelection + delta + items.length) % items.length;
  items.forEach((item, index) => {
    const selected = index === omniSelection;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  const active = items[omniSelection];
  input?.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
  return true;
}

async function runOmnisearch(query) {
  activeOmniController?.abort();
  const controller = new AbortController();
  activeOmniController = controller;
  const catalog = await catalogPromise;
  if (controller.signal.aborted) return;
  const groups = { statutes: [], ...findNavigationMatches(catalog, query), index: [], infractions: [] };
  const letter = indexLetterForQuery(query);
  let completed = 0;
  let total = 0;
  let pendingTasks = letter ? 3 : 2;
  const render = () => renderOmniPanel(query, groups, { completed, total, pending: pendingTasks > 0 });
  const finish = () => {
    pendingTasks -= 1;
    if (!controller.signal.aborted) render();
  };
  render();

  const statutes = searchClient.search(query, {
    limit: 5,
    signal: controller.signal,
    onProgress(update) {
      if (controller.signal.aborted) return;
      completed = update.completed;
      total = update.total;
      groups.statutes = statuteMatches(update.results);
      render();
    }
  }).then((outcome) => {
    groups.statutes = statuteMatches(outcome.results);
  }).catch((error) => {
    if (error.name !== "AbortError") console.warn("Quick statute search failed", error);
  }).finally(finish);

  const infractions = secondaryRepository.loadAllInfractions().then((entries) => {
    if (!controller.signal.aborted) groups.infractions = findInfractionMatches(entries, query);
  }).catch((error) => console.warn("Quick infraction search failed", error)).finally(finish);

  const index = letter ? secondaryRepository.loadIndexLetter(letter).then((topics) => {
    if (!controller.signal.aborted) groups.index = findIndexMatches(topics, query);
  }).catch((error) => console.warn("Quick index search failed", error)).finally(finish) : Promise.resolve();

  await Promise.all([statutes, infractions, index]);
  if (activeOmniController === controller) activeOmniController = null;
}

function scheduleOmnisearch(input, delay = 180) {
  clearTimeout(omniTimer);
  activeOmniController?.abort();
  activeOmniController = null;
  const query = input.value.trim();
  if (query.length < 2) return closeOmni();
  omniTimer = setTimeout(() => {
    omniTimer = null;
    runOmnisearch(query);
  }, delay);
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

async function referenceMaps(provisions, catalog) {
  const values = (Array.isArray(provisions) ? provisions : [provisions]).flatMap((section) => [
    ...section.content.body,
    ...section.content.sourceNotes,
    ...section.content.history,
    ...section.content.annotations.map((annotation) => annotation.text)
  ]);
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

function supplementLabel(change, { short = false } = {}) {
  if (!change) return "";
  const labels = { amended: "Amended", new: "New", repealed: "Repealed" };
  return short
    ? `${change.presentation === "amended" ? "" : `${labels[change.presentation]} · `}${change.editionYear} Supp.`
    : `${labels[change.presentation]} — ${change.editionYear} Supplement`;
}

function renderPreviousRevision(change, maps) {
  if (!change?.previousSections?.length) return "";
  const priorYear = change.editionYear - 1;
  return `<details class="prior-revision">
    <summary>Text of the ${priorYear} revision (superseded by the ${change.editionYear} Supplement)</summary>
    <div>${change.previousSections.map((section) => `<section class="prior-provision">
      <h2>${escapeHtml(section.heading)}</h2>
      <div class="statute-text">${section.content.body.map((paragraph) => `<p>${renderLinkedText(paragraph, maps)}</p>`).join("")}</div>
      <div class="section-notes">
        ${renderNotes("Source", section.content.sourceNotes, maps, { open: true })}
        ${renderNotes("History", section.content.history, maps)}
        ${renderAnnotations(section.content.annotations, maps)}
      </div>
    </section>`).join("")}</div>
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

function readerSidebar(title, chapter, sections, selected = null, changeBySection = new Map()) {
  return `<aside class="reader-sidebar" aria-label="Chapter sections">
    <a class="sidebar-parent" href="${escapeHtml(titleRoute(title))}">← ${escapeHtml(titleLabel(title))}</a>
    <h2>${escapeHtml(chapterLabel(chapter))}</h2>
    <p>${escapeHtml(chapter.name)}</p>
    <nav><ol>${sections.map((section) => {
      const active = selected === section;
      const change = changeBySection.get(section.id);
      const statusPill = change
        ? `<span class="supplement-pill supplement-${escapeHtml(change.presentation)}">${escapeHtml(supplementLabel(change, { short: true }))}</span>`
        : section.status === "repealed" ? `<span class="section-status-pill">Repealed</span>` : "";
      return `<li><a${active ? " aria-current=\"page\"" : ""} href="${escapeHtml(provisionRoute(title, chapter, section))}">
        <strong>${escapeHtml(sectionLabel(section))}</strong>${statusPill}<span>${escapeHtml(section.heading.replace(/^Secs?\.\s*[^.]+\.\s*/, ""))}</span>
      </a></li>`;
    }).join("")}</ol></nav>
  </aside>`;
}

function renderProvision(title, chapter, section, maps, secondaryContext = null, change = null) {
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
      <p class="eyebrow">${escapeHtml(change ? supplementLabel(change) : status)}</p>
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
      ${renderNotes(change ? `Source (${change.editionYear} Supplement)` : "Source", section.content.sourceNotes, maps, { open: true })}
      ${renderNotes(change ? `History (${change.editionYear} Supplement)` : "History", section.content.history, maps)}
      ${renderAnnotations(section.content.annotations, maps)}
    </div>
    ${renderPreviousRevision(change, maps)}
  </article>`;
}

function renderSearchResults(matches, results) {
  results.innerHTML = matches.map(({ document, score }) => {
    const documentStatus = document.status === "active" ? "" : `<span class="status">${escapeHtml(document.status)}</span>`;
    const supplement = document.supplement ? `<span class="supplement-pill supplement-${escapeHtml(document.supplement.presentation)}">${escapeHtml(supplementLabel(document.supplement, { short: true }))}</span>` : "";
    const excerpt = document.text.slice(0, 240);
    return `<li><a href="${escapeHtml(routeForDocument(document))}"><span class="result-citation">${escapeHtml(document.citation ?? document.citations.join("–"))}</span>${escapeHtml(document.heading)} ${documentStatus}${supplement}</a>
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
      <a href="#/" data-browse-statutes><span aria-hidden="true">§</span><strong>Browse statutes</strong><small>Navigate by title, chapter, or section.</small></a>
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

async function runStatuteSearch(query, titleId = null, { limit = SEARCH_BATCH_SIZE } = {}) {
  const status = document.querySelector("#search-status");
  const results = document.querySelector("#results");
  const progress = document.querySelector("#search-progress");
  const warning = document.querySelector("#search-supplement-warning");
  const more = document.querySelector("[data-search-more]");
  activeSearchController?.abort();
  const controller = new AbortController();
  activeSearchController = controller;
  status.textContent = "Preparing search…";
  results.innerHTML = "";
  results.setAttribute("aria-busy", "true");
  warning.hidden = true;
  more.hidden = true;
  progress.hidden = false;
  progress.value = 0;
  try {
    const outcome = await searchClient.search(query, {
      titleIds: titleId ? [titleId] : undefined,
      limit,
      signal: controller.signal,
      onProgress(update) {
        if (controller !== activeSearchController) return;
        progress.max = Math.max(1, update.total);
        progress.value = update.completed;
        renderSearchResults(update.results, results);
        warning.hidden = !update.supplementUnavailable;
        status.textContent = `Searching ${update.completed} of ${update.total} title shard${update.total === 1 ? "" : "s"}… ${update.totalMatches.toLocaleString()} match${update.totalMatches === 1 ? "" : "es"} found so far.`;
      }
    });
    if (controller !== activeSearchController) return;
    const { results: matches, totalMatches, supplementUnavailable } = outcome;
    status.textContent = totalMatches
      ? `Showing ${matches.length.toLocaleString()} of ${totalMatches.toLocaleString()} result${totalMatches === 1 ? "" : "s"}`
      : "No results";
    warning.hidden = !supplementUnavailable;
    renderSearchResults(matches, results);
    const remaining = Math.min(SEARCH_BATCH_SIZE, totalMatches - matches.length);
    if (remaining > 0) {
      more.hidden = false;
      more.textContent = `Show ${remaining.toLocaleString()} more result${remaining === 1 ? "" : "s"}`;
      more.dataset.searchQuery = query;
      more.dataset.searchTitle = titleId ?? "";
      more.dataset.searchLimit = String(matches.length + remaining);
    }
  } catch (error) {
    if (error.name !== "AbortError" && controller === activeSearchController) {
      status.textContent = error.message;
      more.hidden = true;
    }
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
      <input id="search-page-query" name="query" type="search" minlength="2" required aria-describedby="search-help" value="${escapeHtml(query)}">
      <label for="search-title">Limit to a title</label>
      <select id="search-title" name="title"><option value="">All titles</option>${catalog.titles.map((title) => `<option value="${escapeHtml(title.id)}">${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</option>`).join("")}</select>
      <button type="submit">Search</button>
    </form>
    <p class="search-help" id="search-help">Use AND, OR, NOT, parentheses, and quoted phrases. Multiple words use AND automatically.</p>
    <progress id="search-progress" value="0" max="1" hidden>Search progress</progress>
    <div id="search-status" role="status" aria-live="polite">${query ? "Preparing search…" : "Enter at least two characters."}</div>
    <p class="supplement-warning" id="search-supplement-warning" role="alert" hidden>The published supplement search data could not be loaded. These results use the base revision and may be incomplete; reload while online before relying on them.</p>
    <ol id="results" class="results"></ol>
    <button type="button" class="search-more" data-search-more hidden>Show more results</button>
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
  const baseChapter = await getJson(`./data/${chapterMeta.path}`);
  let chapter = baseChapter;
  let overlay = null;
  let supplementError = null;
  try {
    const latest = await supplementRepository.loadLatestChapter(chapterMeta.number);
    if (latest.chapter) {
      const applied = applyChapterOverlay(baseChapter, latest.chapter, latest.edition.editionYear);
      chapter = applied.chapter;
      overlay = applied.overlay;
    }
  } catch (error) {
    supplementError = error;
    console.warn("Could not load the published supplement", error);
  }
  const changeBySection = new Map((overlay?.changes ?? []).map((change) => [change.sectionId, { ...change, editionYear: overlay.editionYear }]));
  const selected = route.kind === "section" ? findSection(chapter, route.section) : null;
  if (route.kind === "section" && !selected) return renderNotFound("That provision was not found.");

  if (route.legacyQuery) {
    const canonicalRoute = selected ? provisionRoute(title, chapter, selected) : chapterRoute(title, chapter);
    history.replaceState(null, "", `${location.pathname}${canonicalRoute}`);
  }

  const [maps, secondaryContext] = selected
    ? await Promise.all([
        referenceMaps([selected, ...(changeBySection.get(selected.id)?.previousSections ?? [])], catalog),
        sectionSecondaryContext(title, selected, route.section)
      ])
    : [null, null];
  const preferences = deviceState.preferences();
  const chapterNavigation = navigationSections(chapter.sections, {
    hideRepealed: preferences.hideRepealedSections,
    selected
  });
  const hiddenRepealed = chapter.sections.length - chapterNavigation.length;
  setDocumentTitle(selected ? sectionLabel(selected) : chapterLabel(chapter), titleLabel(title));
  app.innerHTML = `${siteHeader()}<div class="reader-shell" id="main-content">
    ${readerSidebar(title, chapter, chapterNavigation, selected, changeBySection)}
    <main class="reader-content">
      ${breadcrumbs([
        { label: "Titles", href: "#/" },
        { label: titleLabel(title), href: titleRoute(title) },
        { label: chapterLabel(chapter), href: selected ? chapterRoute(title, chapter) : null },
        ...(selected ? [{ label: sectionLabel(selected) }] : [])
      ])}
      ${supplementError ? `<p class="supplement-warning" role="alert">The published supplement could not be loaded. This page is showing the base revision only; reload before relying on it.</p>` : ""}
      ${selected ? `${renderProvision(title, chapter, selected, maps, secondaryContext, changeBySection.get(selected.id))}${sectionNavigation(title, chapter, chapterNavigation, selected)}` : `<div class="chapter-overview"><p class="eyebrow">${chapterNavigation.length} provisions${hiddenRepealed ? ` · ${hiddenRepealed} repealed hidden` : ""}</p><h1>${escapeHtml(chapterLabel(chapter))} — ${escapeHtml(chapter.name)}</h1>${overlay?.changes.length ? `<p class="supplement-summary"><strong>${overlay.editionYear} Supplement applied.</strong> ${overlay.changes.length} updated provision${overlay.changes.length === 1 ? "" : "s"} are labeled in the chapter list.</p>` : ""}<p>Choose a provision from the chapter list.</p><a href="${escapeHtml(chapter.sourceUrl)}">Official chapter source</a></div>`}
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
      const href = indexRouteHref(topicLetter(topic.label), { heading: topic.label });
      if (!entry) return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(topic.label)}</strong></a><p>Subject heading · ${topic.items.length.toLocaleString()} entries</p></li>`;
      return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(topic.label)}</strong></a><p>${escapeHtml(entry.text)} ${renderIndexReferences(entry.references)}</p></li>`;
    }).join("")}</ol>`;
}

function renderIndexTopic(topic, open = false) {
  return `<details class="index-topic" id="${escapeHtml(topic.id)}" tabindex="-1"${open ? " open" : ""}>
    <summary><strong>${escapeHtml(topic.label)}</strong><span>${topic.items.length.toLocaleString()} entr${topic.items.length === 1 ? "y" : "ies"}</span></summary>
    <ol class="index-entries">${topic.items.map(renderIndexEntry).join("")}</ol>
  </details>`;
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
  const selected = route.topic
    ? topics.find((topic) => topic.id === route.topic)
    : route.heading ? topics.find((topic) => topic.label.toLowerCase() === route.heading.toLowerCase()) : null;
  if ((route.topic || route.heading) && !selected) return renderNotFound("That index heading was not found.");
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
      ${search ? renderIndexSearchResults(search) : `<div class="index-result-heading"><h2>${escapeHtml(letter.toUpperCase())} headings</h2><p>${topics.length.toLocaleString()} subjects on this page</p></div>
        <div class="index-topic-list">${topics.map((topic) => renderIndexTopic(topic, topic === selected)).join("")}</div>`}
    </section>
    <aside class="legal-data-note"><strong>About this index</strong><p>This is a derived access copy of the official index, not legal text. Verify coverage and citations with the Legislative Commissioners' Office source.</p></aside>
  </main><footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;

  document.querySelector("#index-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("query").trim();
    location.hash = indexRouteHref(topicLetter(query), { query });
  });
  if (selected && !search) {
    const matchingEntry = route.subheading
      ? selected.items.find((entry) => entry.text.toLowerCase().includes(route.subheading.toLowerCase()))
      : null;
    const target = matchingEntry ? document.getElementById(matchingEntry.id) : document.getElementById(selected.id);
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  } else window.scrollTo({ top: 0 });
}

function renderNotFound(message = "That page was not found.") {
  setDocumentTitle("Not found");
  app.innerHTML = `${siteHeader()}<main class="error" id="main-content"><p class="eyebrow">Not found</p><h1>${escapeHtml(message)}</h1><p><a href="#/">Browse the statutes</a></p></main>`;
}

async function renderCurrentRoute() {
  closeOmni();
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

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-omni-input]")) scheduleOmnisearch(event.target);
});

document.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-omni-input]") && event.target.value.trim().length >= 2) {
    scheduleOmnisearch(event.target, 0);
  }
});

document.addEventListener("keydown", (event) => {
  const input = event.target.closest?.("[data-omni-input]");
  if (input) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (moveOmniSelection(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      const selected = omniSelection >= 0 ? omniItems()[omniSelection] : null;
      const query = input.value.trim();
      if (!selected && query.length < 2) return;
      event.preventDefault();
      const href = selected?.getAttribute("href") ?? searchRouteHref(query);
      closeOmni();
      location.hash = href;
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeOmni();
    }
    return;
  }
  const inField = /^(input|select|textarea)$/i.test(document.activeElement?.tagName ?? "");
  if (event.key === "/" && !inField && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const globalInput = document.querySelector("[data-omni-input]");
    globalInput?.focus();
    globalInput?.select();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("[data-global-search]")) closeOmni();
});

document.addEventListener("click", async (event) => {
  const omniOption = event.target.closest("[data-omni-option]");
  if (omniOption) {
    closeOmni();
    return;
  }
  const searchMore = event.target.closest("[data-search-more]");
  if (searchMore) {
    await runStatuteSearch(searchMore.dataset.searchQuery, searchMore.dataset.searchTitle || null, {
      limit: Number(searchMore.dataset.searchLimit) || SEARCH_BATCH_SIZE
    });
    return;
  }
  const browseStatutes = event.target.closest("[data-browse-statutes]");
  if (browseStatutes) {
    event.preventDefault();
    const heading = document.querySelector("#browse-heading");
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    return;
  }
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
  const applyUpdate = event.target.closest("[data-apply-update]");
  if (applyUpdate) {
    pwaManager.applyUpdate();
    return;
  }
  const installApp = event.target.closest("[data-install-app]");
  if (installApp) {
    await pwaManager.install();
    return;
  }
  const downloadOffline = event.target.closest("[data-download-offline]");
  if (downloadOffline) {
    try {
      await pwaManager.downloadOfflineData({
        refresh: pwaState.complete || pwaState.cachedFiles > 0
      });
    } catch {
      // PwaManager exposes the failure in the live settings status.
    }
    return;
  }
  const clearOffline = event.target.closest("[data-clear-offline]");
  if (clearOffline) {
    try {
      await pwaManager.clearOfflineData();
    } catch {
      // PwaManager exposes the failure in the live settings status.
    }
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
  if (event.target.matches("[data-compact-lists]")) {
    applyPreferences(deviceState.updatePreferences({ compactLists: event.target.checked }));
    return;
  }
  if (event.target.matches("[data-hide-repealed]")) {
    applyPreferences(deviceState.updatePreferences({ hideRepealedSections: event.target.checked }));
    const route = parseRoute(location);
    if (["chapter", "section"].includes(route.kind)) renderCurrentRoute();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.matches("[data-global-search]")) {
    event.preventDefault();
    const query = new FormData(form).get("query").trim();
    closeOmni();
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
