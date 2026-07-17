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
  sectionRouteKey,
  titlesRouteHref
} from "./routes.js";
import {
  escapeHtml,
  extractLegalReferences,
  leadingSubsection,
  navigationSectionLabel,
  navigationSections,
  renderLinkedText,
  routeForDocument
} from "./reader.js";
import { SecondarySourceRepository } from "./secondary-sources.js";
import { applyPreferences, DeviceState } from "./device-state.js";
import { PwaManager } from "./pwa.js";
import { NativeDialogController } from "./dialog.js";
import { aggregateShardCounts, contextualColumnCount } from "./context-navigation.js";
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
  findIndexSubheadingEntry,
  groupIndexEntries,
  renderIndexEntry,
  renderIndexEntryText,
  renderIndexReferences,
  renderSecondaryContext,
  searchIndexEntries,
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
let chapterDialogController = null;
let pwaState = pwaManager.state;
const SEARCH_BATCH_SIZE = 50;
const LARGE_INDEX_TOPIC_THRESHOLD = 200;
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
  if (route.kind === "about") return "settings";
  return "statutes";
}

function navLink({ href, id, icon, label, badge = null }, active) {
  const badgeMarkup = badge === null ? "" : `<span class="nav-badge" aria-label="${badge} saved bookmark${badge === 1 ? "" : "s"}">${badge}</span>`;
  return `<a href="${href}"${active === id ? ` aria-current="page"` : ""}><span aria-hidden="true">${icon}</span><span>${label}</span>${badgeMarkup}</a>`;
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
  const recentCount = deviceState.recents().length;
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
    <button type="button" class="settings-action" data-clear-recents${recentCount ? "" : " disabled"}>Clear recent history <small>${recentCount ? `${recentCount} item${recentCount === 1 ? "" : "s"}` : "No recent history"}</small></button>
    <a class="settings-action" href="#/about">About this app <small>Sources, coverage, and project information</small></a>
    <a class="settings-action" href="./discover/">Static discovery index <small>Script-free browsing</small></a>
  </section>`;
}

function siteHeader() {
  const route = parseRoute(location);
  const active = activeDestination(route);
  const searchValue = route.kind === "search" ? route.query ?? "" : "";
  const bookmarkCount = deviceState.bookmarks().length;
  return `<header class="site-header">
    <div class="header-bar">
      <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">§</span><span>Connecticut General Statutes</span></a>
      <nav class="app-nav" aria-label="Main sections">
        ${navLink({ href: "#/", id: "statutes", icon: "§", label: "Statutes" }, active)}
        ${navLink({ href: "#/index", id: "index", icon: "A–Z", label: "Index" }, active)}
        ${navLink({ href: "#/infractions", id: "infractions", icon: "⚖", label: "Infractions" }, active)}
        ${navLink({ href: "#/bookmarks", id: "bookmarks", icon: "★", label: "Bookmarks", badge: bookmarkCount }, active)}
        <button type="button" data-open-settings aria-expanded="false"${active === "settings" ? ` aria-current="page"` : ""}><span aria-hidden="true">⚙</span><span>Settings</span></button>
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

function applicationShell({
  contextualNavigation = [],
  mainContent,
  columnCount = contextualNavigation.length,
  mobilePresentationMode = "focused",
  footer = "Unofficial access copy. Verify legal text with the Connecticut General Assembly."
}) {
  return `${siteHeader()}<div class="application-shell mobile-${escapeHtml(mobilePresentationMode)}" data-context-columns="${columnCount}">
    ${contextualNavigation.map((column) => `<aside class="context-column ${escapeHtml(column.className ?? "")}" aria-label="${escapeHtml(column.label)}">
      ${column.heading ? `<div class="context-column-heading">${column.heading}</div>` : ""}${column.content}
    </aside>`).join("")}
    ${mainContent}
  </div><footer>${footer}</footer>`;
}

function railList(items, { className = "", empty = "No items are available." } = {}) {
  if (!items.length) return `<p class="context-empty">${escapeHtml(empty)}</p>`;
  return `<ol class="context-list ${escapeHtml(className)}">${items.join("")}</ol>`;
}

function statuteTitleColumn(catalog, selected = null) {
  return {
    label: "Statute titles",
    className: "titles-column",
    heading: `<p class="eyebrow">Statutes</p><strong>Titles</strong>`,
    content: railList(catalog.titles.map((title) => `<li><a href="${escapeHtml(titleRoute(title))}"${selected?.id === title.id ? ` aria-current="page"` : ""}><strong>${escapeHtml(titleLabel(title))}</strong><span>${escapeHtml(title.name)}</span></a></li>`))
  };
}

function statuteChapterColumn(title, selected = null) {
  return {
    label: `Chapters in ${titleLabel(title)}`,
    className: "chapters-column",
    heading: `<p class="eyebrow">${escapeHtml(titleLabel(title))}</p><strong>Chapters</strong>`,
    content: railList(title.chapters.map((chapter) => `<li><a href="${escapeHtml(chapterRoute(title, chapter))}"${selected?.id === chapter.id ? ` aria-current="page"` : ""}><strong>${escapeHtml(chapterLabel(chapter))}</strong><span>${escapeHtml(chapter.name)}</span><small>${chapter.sectionCount} provisions</small></a></li>`))
  };
}

function statuteSectionItems(title, chapter, sections, selected, changeBySection = new Map()) {
  return sections.map((section) => {
    const change = changeBySection.get(section.id);
    const status = section.status === "repealed" ? `<span class="section-status-pill">Repealed</span>` : "";
    const supplement = change ? `<span class="supplement-pill supplement-${escapeHtml(change.presentation)}">${escapeHtml(supplementLabel(change, { short: true }))}</span>` : "";
    return `<li><a href="${escapeHtml(provisionRoute(title, chapter, section))}"${selected?.id === section.id ? ` aria-current="page"` : ""}><strong>${escapeHtml(navigationSectionLabel(section))}</strong>${status}${supplement}<span>${escapeHtml(section.heading)}</span></a></li>`;
  });
}

function statuteSectionColumn(title, chapter, sections, selected, changeBySection) {
  return {
    label: `Sections in ${chapterLabel(chapter)}`,
    className: "sections-column",
    heading: `<p class="eyebrow">${escapeHtml(chapterLabel(chapter))}</p><strong>Sections</strong>`,
    content: railList(statuteSectionItems(title, chapter, sections, selected, changeBySection))
  };
}

function chapterSheet(title, chapter, sections, selected, changeBySection) {
  return `<dialog class="chapter-sheet" data-chapter-sheet aria-labelledby="chapter-sheet-title">
    <div class="chapter-sheet-panel"><header><div><p class="eyebrow">${escapeHtml(titleLabel(title))}</p><h2 id="chapter-sheet-title">${escapeHtml(chapterLabel(chapter))} sections</h2></div><button type="button" data-close-chapter-sheet>Close</button></header>
      ${railList(statuteSectionItems(title, chapter, sections, selected, changeBySection), { className: "chapter-sheet-list" })}
    </div>
  </dialog>`;
}

function bindChapterSheet() {
  chapterDialogController?.destroy();
  chapterDialogController = null;
  const dialog = document.querySelector("[data-chapter-sheet]");
  if (dialog) chapterDialogController = new NativeDialogController(dialog);
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

function renderInformationReferences(section, maps, secondaryContext, change) {
  const groups = [
    renderNotes(change ? `Source (${change.editionYear} Supplement)` : "Source", section.content.sourceNotes, maps, { open: true }),
    renderNotes(change ? `History (${change.editionYear} Supplement)` : "History", section.content.history, maps),
    renderAnnotations(section.content.annotations, maps),
    renderSecondaryContext(secondaryContext)
  ].filter(Boolean).join("");
  if (!groups) return "";
  return `<section class="information-references" aria-labelledby="information-references-heading">
    <div class="information-references-heading">
      <h2 id="information-references-heading">Information &amp; References</h2>
      <p>Official sources, legislative history, annotations, and related legal records.</p>
    </div>
    <div class="information-reference-groups">${groups}</div>
  </section>`;
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
      const grouped = section.citations.length > 1;
      const description = section.heading.replace(/^Secs?\.\s*[^.]+\.\s*/, "");
      return `<li${grouped ? " class=\"grouped-section\"" : ""}><a${active ? " aria-current=\"page\"" : ""} href="${escapeHtml(provisionRoute(title, chapter, section))}">
        <strong>${escapeHtml(navigationSectionLabel(section))}</strong>${statusPill}${description !== section.citation ? `<span>${escapeHtml(description)}</span>` : ""}
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
    ${renderInformationReferences(section, maps, secondaryContext, change)}
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

function activityTypeLabel(type) {
  if (type === "index") return "Index";
  if (type === "infraction") return "Infraction";
  return "Statute";
}

function renderActivityList(items, emptyMessage) {
  if (!items.length) return `<p class="activity-empty">${escapeHtml(emptyMessage)}</p>`;
  return `<ol class="activity-list">${items.map((item) => `<li><a href="${escapeHtml(item.href)}">
    <span>${activityTypeLabel(item.type)}</span><strong>${escapeHtml(item.title)}</strong>${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ""}
  </a></li>`).join("")}</ol>`;
}

async function renderHome(catalog) {
  const recents = deviceState.recents().slice(0, 5);
  const bookmarks = deviceState.bookmarks().slice(0, 5);
  setDocumentTitle();
  const mainContent = `<main class="home-page application-main" id="main-content">
    <header class="home-intro">
      <p class="eyebrow">UConn Law Library</p>
      <h1>Connecticut General Statutes</h1>
      <p>Browse and search the statutes, the official subject index, and the Judicial Branch infraction schedule. Save frequently used material on this device.</p>
    </header>
    <section class="destination-grid" aria-label="Explore legal materials">
      <a href="${titlesRouteHref()}"><span aria-hidden="true">§</span><strong>Browse statutes</strong><small>Navigate by title, chapter, or section.</small></a>
      <a href="#/index"><span aria-hidden="true">A–Z</span><strong>Subject index</strong><small>Find statutes by topic in the official LCO index.</small></a>
      <a href="#/infractions"><span aria-hidden="true">⚖</span><strong>Infraction schedule</strong><small>Review violations, amounts, and linked statutes.</small></a>
      <a href="#/bookmarks"><span aria-hidden="true">★</span><strong>Bookmarks</strong><small>Return to sections and infractions saved on this device.</small></a>
    </section>
    <section class="home-activity" aria-label="Your activity">
      <div><div class="section-heading"><div><p class="eyebrow">On this device</p><h2>Recently viewed</h2></div>${recents.length ? `<button type="button" class="text-button" data-clear-recents>Clear</button>` : ""}</div>${renderActivityList(recents, "Sections, index topics, and infractions you open will appear here.")}</div>
      <div><div class="section-heading"><div><p class="eyebrow">Saved</p><h2>Recent bookmarks</h2></div>${bookmarks.length ? `<a href="#/bookmarks">View all</a>` : ""}</div>${renderActivityList(bookmarks, "Your most recently saved bookmarks will appear here.")}</div>
    </section>
  </main>`;
  app.innerHTML = applicationShell({
    contextualNavigation: [statuteTitleColumn(catalog)],
    mainContent,
    columnCount: contextualColumnCount("statutes", { kind: "home" }),
    mobilePresentationMode: "home"
  });
}

function renderTitles(catalog) {
  setDocumentTitle("Titles");
  app.innerHTML = `${siteHeader()}<main class="browse-page titles-page" id="main-content">
    <header class="browse-heading"><div><p class="eyebrow">${catalog.counts.chapters.toLocaleString()} chapters · ${catalog.counts.sections.toLocaleString()} provisions</p><h1>Statute titles</h1></div></header>
    <ol class="title-list">${catalog.titles.map((title) => `<li><a href="${escapeHtml(titleRoute(title))}"><strong>${escapeHtml(titleLabel(title))}</strong><span>${escapeHtml(title.name)}</span><small>${title.chapters.length} chapter${title.chapters.length === 1 ? "" : "s"}</small></a></li>`).join("")}</ol>
  </main><footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;
  window.scrollTo({ top: 0 });
}

function formatSnapshotDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function aboutSourceCard({ publisher, name, description, details = [], caveat, url }) {
  const visibleDetails = details.filter(Boolean);
  return `<article class="about-source-card">
    <p class="eyebrow">${escapeHtml(publisher)}</p>
    <h3>${escapeHtml(name)}</h3>
    <p>${escapeHtml(description)}</p>
    ${visibleDetails.length ? `<p class="about-source-details">${visibleDetails.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</p>` : ""}
    <p class="about-caveat">${escapeHtml(caveat)}</p>
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Official source <span aria-hidden="true">↗</span></a>
  </article>`;
}

async function renderAbout(catalog) {
  const [secondaryResult, supplementResult] = await Promise.allSettled([
    secondaryRepository.init(),
    (async () => {
      const edition = await supplementRepository.latestEdition();
      return edition ? { edition, manifest: await supplementRepository.loadEdition(edition.editionYear) } : null;
    })()
  ]);
  const secondary = secondaryResult.status === "fulfilled" ? secondaryResult.value : null;
  const supplement = supplementResult.status === "fulfilled" ? supplementResult.value : null;
  const statuteDate = formatSnapshotDate(catalog.source?.retrievedAt ?? catalog.generatedAt);
  const indexSource = secondary?.index?.source ?? {};
  const infractionSource = secondary?.infractions?.source ?? {};
  const cards = [
    aboutSourceCard({
      publisher: "Connecticut General Assembly",
      name: "General Statutes",
      description: "Connecticut General Statutes text organized into canonical title, chapter, and provision artifacts.",
      details: [statuteDate && `Captured ${statuteDate}`, `${catalog.counts.sections.toLocaleString()} provisions`],
      caveat: "Changes published after the capture date appear after the next reviewed corpus update.",
      url: catalog.source?.url ?? "https://www.cga.ct.gov/current/pub/titles.htm"
    }),
    ...(supplement ? [aboutSourceCard({
      publisher: "Connecticut General Assembly",
      name: `${supplement.edition.editionYear} Supplement`,
      description: "Sections amended, added, or repealed by the published supplement and consolidated into the reader when applicable.",
      details: [formatSnapshotDate(supplement.manifest.generatedAt) && `Captured ${formatSnapshotDate(supplement.manifest.generatedAt)}`, `${supplement.manifest.counts.sections.toLocaleString()} provisions`],
      caveat: `Read the supplement together with the General Statutes revised to January 1, ${supplement.edition.editionYear - 1}.`,
      url: supplement.manifest.source?.url ?? `https://www.cga.ct.gov/${supplement.edition.editionYear}/sup/titles.htm`
    })] : []),
    aboutSourceCard({
      publisher: indexSource.publisher ?? "Connecticut General Assembly, Legislative Commissioners' Office",
      name: "Subject index",
      description: "The official subject index, parsed into letter-level artifacts with resolved links to statute sections.",
      details: [indexSource.revision, secondary?.index?.counts?.headings && `${secondary.index.counts.headings.toLocaleString()} headings`],
      caveat: "The index is an access aid rather than legal text and can trail recently enacted legislation.",
      url: indexSource.url ?? "https://www.cga.ct.gov/lco/statutes-index.asp"
    }),
    aboutSourceCard({
      publisher: infractionSource.publisher ?? "State of Connecticut Judicial Branch",
      name: "Infractions schedule",
      description: "Chart A of the Judicial Branch mail-in violations and infractions schedule, with links to relevant statutes.",
      details: [infractionSource.effective && `Effective ${infractionSource.effective}`, secondary?.infractions?.counts?.entries && `${secondary.infractions.counts.entries.toLocaleString()} entries`],
      caveat: "Fine amounts and eligibility can change. Confirm them in the current Judicial Branch schedule before relying on this copy.",
      url: infractionSource.url ?? "https://www.jud.ct.gov/webforms/forms/infractions.pdf"
    })
  ];
  const headingCount = secondary?.index?.counts?.headings;
  const infractionCount = secondary?.infractions?.counts?.entries;
  setDocumentTitle("About");
  app.innerHTML = `${siteHeader()}<main class="about-page" id="main-content">
    ${breadcrumbs([{ label: "Titles", href: "#/" }, { label: "About" }])}
    <section class="about-brand" aria-label="UConn School of Law, Law Library and Technology">
      <div><strong>UCONN</strong><span>School of Law</span></div>
      <small>Law Library and Technology</small>
    </section>
    <header class="about-intro">
      <p class="eyebrow">About this app</p>
      <h1>Connecticut General Statutes Explorer</h1>
      <p>The UConn Law Library provides this mobile-first tool for searching and browsing the Connecticut General Statutes, the official subject index, and the Judicial Branch infraction schedule.</p>
      <p><a class="primary-link" href="https://library.law.uconn.edu/" target="_blank" rel="noopener">Visit the Law Library <span aria-hidden="true">↗</span></a></p>
    </header>
    <ul class="about-counts" aria-label="Published data coverage">
      <li><strong>${catalog.titles.length.toLocaleString()}</strong><span>titles</span></li>
      <li><strong>${catalog.counts.chapters.toLocaleString()}</strong><span>chapters</span></li>
      <li><strong>${catalog.counts.sections.toLocaleString()}</strong><span>provisions</span></li>
      ${headingCount ? `<li><strong>${headingCount.toLocaleString()}</strong><span>index headings</span></li>` : ""}
      ${infractionCount ? `<li><strong>${infractionCount.toLocaleString()}</strong><span>infractions</span></li>` : ""}
    </ul>
    <section class="about-section" aria-labelledby="about-sources-heading">
      <div class="about-section-heading"><p class="eyebrow">Provenance</p><h2 id="about-sources-heading">Data and official sources</h2></div>
      <div class="about-source-list">${cards.join("")}</div>
    </section>
    <section class="about-section about-project" aria-labelledby="about-project-heading">
      <div><p class="eyebrow">Privacy and architecture</p><h2 id="about-project-heading">Built for public access</h2></div>
      <div>
        <p>This is a database-free, static Progressive Web App hosted on GitHub Pages. Searches run in the browser, and bookmarks, display preferences, and downloaded offline data remain on this device.</p>
        <p>Data refreshes are parsed, validated, and reviewed before publication. The application and ingestion tools are maintained in the <a href="https://github.com/UConn-Law-Library/CGS" target="_blank" rel="noopener">public source repository <span aria-hidden="true">↗</span></a>.</p>
      </div>
    </section>
    <aside class="legal-data-note"><strong>Unofficial access copy</strong><p>This application is not legal advice and is not the official legal publication. Verify statute text with the Connecticut General Assembly and infraction information with the Judicial Branch.</p></aside>
  </main><footer>UConn Law Library · Unofficial access copy.</footer>`;
  window.scrollTo({ top: 0 });
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

function renderTitle(catalog, title) {
  setDocumentTitle(titleLabel(title));
  const mainContent = `<main class="browse-page application-main" id="main-content">
    ${breadcrumbs([{ label: "Titles", href: titlesRouteHref() }, { label: titleLabel(title) }])}
    <div class="browse-heading"><div><p class="eyebrow">${title.chapters.length} chapters</p><h1>${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</h1></div><a href="${escapeHtml(title.sourceUrl)}">Official title source</a></div>
    <ol class="chapter-list">${title.chapters.map((chapter) => `<li><a href="${escapeHtml(chapterRoute(title, chapter))}"><strong>${escapeHtml(chapterLabel(chapter))}</strong><span>${escapeHtml(chapter.name)}</span><small>${chapter.sectionCount} provision${chapter.sectionCount === 1 ? "" : "s"}</small></a></li>`).join("")}</ol>
  </main>`;
  app.innerHTML = applicationShell({
    contextualNavigation: [statuteTitleColumn(catalog, title)],
    mainContent,
    columnCount: contextualColumnCount("statutes", { kind: "title" }),
    mobilePresentationMode: "drilldown"
  });
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
  const sectionItems = statuteSectionItems(title, chapter, chapterNavigation, selected, changeBySection);
  const mobileChapterList = `<section class="mobile-only mobile-section-browser" aria-labelledby="mobile-sections-heading"><div class="section-heading"><div><p class="eyebrow">${chapterNavigation.length} provisions${hiddenRepealed ? ` · ${hiddenRepealed} repealed hidden` : ""}</p><h2 id="mobile-sections-heading">Sections</h2></div></div>${railList(sectionItems)}</section>`;
  const mainContent = `<main class="reader-content application-main" id="main-content">
      ${breadcrumbs([
        { label: "Titles", href: titlesRouteHref() },
        { label: titleLabel(title), href: titleRoute(title) },
        { label: chapterLabel(chapter), href: selected ? chapterRoute(title, chapter) : null },
        ...(selected ? [{ label: sectionLabel(selected) }] : [])
      ])}
      ${supplementError ? `<p class="supplement-warning" role="alert">The published supplement could not be loaded. This page is showing the base revision only; reload before relying on it.</p>` : ""}
      ${selected ? `<div class="mobile-reader-tools"><button type="button" data-open-chapter-sheet aria-haspopup="dialog">Browse chapter</button></div>${renderProvision(title, chapter, selected, maps, secondaryContext, changeBySection.get(selected.id))}${sectionNavigation(title, chapter, chapterNavigation, selected)}${chapterSheet(title, chapter, chapterNavigation, selected, changeBySection)}` : `<div class="chapter-overview"><p class="eyebrow">${chapterNavigation.length} provisions${hiddenRepealed ? ` · ${hiddenRepealed} repealed hidden` : ""}</p><h1>${escapeHtml(chapterLabel(chapter))} — ${escapeHtml(chapter.name)}</h1>${overlay?.changes.length ? `<p class="supplement-summary"><strong>${overlay.editionYear} Supplement applied.</strong> ${overlay.changes.length} updated provision${overlay.changes.length === 1 ? "" : "s"} are labeled in the chapter list.</p>` : ""}<p class="desktop-only">Choose a provision from the sections column.</p><a href="${escapeHtml(chapter.sourceUrl)}">Official chapter source</a></div>${mobileChapterList}`}
    </main>`;
  app.innerHTML = applicationShell({
    contextualNavigation: [
      statuteTitleColumn(catalog, title),
      statuteChapterColumn(title, chapter),
      statuteSectionColumn(title, chapter, chapterNavigation, selected, changeBySection)
    ],
    mainContent,
    columnCount: contextualColumnCount("statutes", route),
    mobilePresentationMode: selected ? "reader" : "drilldown"
  });
  bindChapterSheet();
  if (selected) {
    deviceState.recordRecent({
      id: `statute:${selected.id}`,
      type: "statute",
      title: sectionLabel(selected),
      subtitle: `${titleLabel(title)} · ${chapterLabel(chapter)} — ${selected.heading}`,
      href: provisionRoute(title, chapter, selected)
    });
  }

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
  if (topic.items.length > LARGE_INDEX_TOPIC_THRESHOLD) {
    const href = indexRouteHref(topicLetter(topic.label), { topic: topic.id });
    return `<a class="index-topic index-topic-link" href="${escapeHtml(href)}">
      <strong>${escapeHtml(topic.label)}</strong>
      <span aria-hidden="true">&rarr;</span><span class="visually-hidden">Open topic</span>
    </a>`;
  }
  return `<details class="index-topic" id="${escapeHtml(topic.id)}" tabindex="-1"${open ? " open" : ""}>
    <summary><strong>${escapeHtml(topic.label)}</strong></summary>
    <ol class="index-entries">${topic.items.map(renderIndexEntry).join("")}</ol>
  </details>`;
}

function indexGroupLetter(entry) {
  return String(entry?.text ?? "").trim().match(/[a-z0-9]/i)?.[0].toUpperCase() ?? "#";
}

function indexGroupBody(group) {
  const parent = group[0];
  const parentHasAnnotations = (parent.references?.length ?? 0) > 0 || (parent.see?.length ?? 0) > 0;
  return parentHasAnnotations ? group : group.slice(1);
}

function renderLargeIndexTopic(topic, groups, targetEntry, query = "") {
  const letters = [...new Set(groups.map((group) => indexGroupLetter(group[0])))];
  let currentLetter = null;
  const sections = [];
  for (const group of groups) {
    const letter = indexGroupLetter(group[0]);
    if (letter !== currentLetter) {
      if (currentLetter !== null) sections.push(`</div></section>`);
      currentLetter = letter;
      sections.push(`<section class="index-topic-letter" id="index-topic-letter-${escapeHtml(letter.toLowerCase())}" data-index-topic-letter="${escapeHtml(letter)}" tabindex="-1">
        <h3>${escapeHtml(letter)}</h3><div class="index-topic-groups">`);
    }
    const parent = group[0];
    if (group.length === 1) {
      sections.push(`<div class="index-topic-leaf">${renderIndexEntry(parent)}</div>`);
      continue;
    }
    const open = group.some((entry) => entry === targetEntry);
    sections.push(`<details class="index-subtopic" data-index-group="${escapeHtml(parent.id)}" tabindex="-1"${open ? " open" : ""}>
      <summary><strong>${renderIndexEntryText(parent).html}</strong><span>${(group.length - 1).toLocaleString()} subentr${group.length === 2 ? "y" : "ies"}</span></summary>
      <ol class="index-entries" data-index-group-entries${open ? "" : " hidden"}></ol>
    </details>`);
  }
  if (currentLetter !== null) sections.push(`</div></section>`);
  return `<section class="index-topic-detail" aria-labelledby="index-topic-heading">
    <div class="index-result-heading"><h2 id="index-topic-heading">Browse this topic</h2><p>${topic.items.length.toLocaleString()} entries</p></div>
    <label class="index-topic-search" for="index-topic-query">
      <span>Search within ${escapeHtml(topic.label)}</span>
      <input id="index-topic-query" type="search" value="${escapeHtml(query)}" placeholder="Filter this topic" autocomplete="off">
    </label>
    <nav class="index-topic-jumps" aria-label="Jump to a topic letter">${letters.map((letter) =>
      `<button type="button" data-index-jump="${escapeHtml(letter)}">${escapeHtml(letter)}</button>`
    ).join("")}</nav>
    <div data-index-topic-results hidden></div>
    <div data-index-topic-browser>${sections.join("")}</div>
  </section>`;
}

function renderSelectedIndexTopic(topic, groups, targetEntry, query = "") {
  if (topic.items.length > LARGE_INDEX_TOPIC_THRESHOLD) {
    return renderLargeIndexTopic(topic, groups, targetEntry, query);
  }
  return `<section class="index-topic-detail" aria-labelledby="index-topic-heading">
    <div class="index-result-heading"><h2 id="index-topic-heading">${escapeHtml(topic.label)}</h2><p>${topic.items.length.toLocaleString()} entries</p></div>
    <ol class="index-entries">${topic.items.map(renderIndexEntry).join("")}</ol>
  </section>`;
}

function attachLargeIndexTopic(topic, groups, targetEntry) {
  const groupById = new Map(groups.map((group) => [group[0].id, group]));
  const populate = (details) => {
    const list = details.querySelector("[data-index-group-entries]");
    if (!list || list.dataset.rendered === "true") return;
    const group = groupById.get(details.dataset.indexGroup);
    list.innerHTML = indexGroupBody(group).map(renderIndexEntry).join("");
    list.dataset.rendered = "true";
    list.hidden = false;
  };
  for (const details of document.querySelectorAll(".index-subtopic")) {
    if (details.open) populate(details);
    details.addEventListener("toggle", () => {
      if (details.open) populate(details);
    });
  }
  for (const button of document.querySelectorAll("[data-index-jump]")) {
    button.addEventListener("click", () => {
      const target = document.querySelector(`[data-index-topic-letter="${CSS.escape(button.dataset.indexJump)}"]`);
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
  }
  const input = document.querySelector("#index-topic-query");
  const browser = document.querySelector("[data-index-topic-browser]");
  const results = document.querySelector("[data-index-topic-results]");
  const updateResults = () => {
    const query = input.value.trim();
    if (query.length < 2) {
      browser.hidden = false;
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    const matches = searchIndexEntries(topic.items, query);
    browser.hidden = true;
    results.hidden = false;
    results.innerHTML = `<div class="index-result-heading"><h3>Topic search results</h3><p>${matches.total.toLocaleString()} match${matches.total === 1 ? "" : "es"}${matches.truncated ? "; showing the first 100" : ""}</p></div>
      ${matches.results.length ? `<ol class="index-entries index-topic-search-results">${matches.results.map((entry) => renderIndexEntry({ ...entry, level: 0 })).join("")}</ol>` : `<p class="empty-state">No entries in this topic match the search terms.</p>`}`;
  };
  input.addEventListener("input", updateResults);
  updateResults();
  if (targetEntry) {
    let target = document.getElementById(targetEntry.id);
    if (!target) {
      const group = groups.find((candidate) => candidate.includes(targetEntry));
      const details = group ? document.querySelector(`[data-index-group="${CSS.escape(group[0].id)}"]`) : null;
      details?.classList.add("index-entry-target");
      target = details?.querySelector("summary") ?? details;
    } else target.classList.add("index-entry-target");
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  } else window.scrollTo({ top: 0 });
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
  const categoryItems = groups.map(([category, values]) => `<li><a href="${escapeHtml(infractionsRouteHref(category))}"${selectedGroup?.[0] === category ? ` aria-current="page"` : ""}><strong>${escapeHtml(category)}</strong><span>${values.length.toLocaleString()} entries</span></a></li>`);
  const entryItems = shown.map((entry) => `<li><a href="${escapeHtml(infractionsRouteHref(selectedGroup[0], { entry: entry.id }))}"${selectedEntry?.id === entry.id ? ` aria-current="page"` : ""}><strong>Sec. ${escapeHtml(entry.citation)}</strong><span>${escapeHtml(entry.description)}</span></a></li>`);
  setDocumentTitle(selectedEntry ? `Sec. ${selectedEntry.citation}` : selectedGroup?.[0] ?? "Infractions");
  const mainBody = selectedEntry ? renderInfractionDetail(selectedEntry, manifests.infractions.source) : selectedGroup ? `<header class="section-heading"><div><p class="eyebrow">Judicial Branch schedule</p><h1>${escapeHtml(selectedGroup[0])}</h1></div><p>${selectedGroup[1].length.toLocaleString()} entries</p></header>
      <form class="infraction-search" data-infraction-search>
        <label for="infraction-query">Search this category</label>
        <input id="infraction-query" name="query" type="search" value="${escapeHtml(route.query ?? "")}" placeholder="Citation or description">
        <button type="submit">Search</button>
      </form>
      <p class="note">${filtered.length.toLocaleString()} matching entr${filtered.length === 1 ? "y" : "ies"}${filtered.length > shown.length ? `; showing the first ${shown.length}` : ""}.</p>
      <section class="desktop-only rail-prompt"><p>Select an entry from the adjacent column.</p></section>
      <ol class="infraction-list mobile-only">${shown.map(renderInfractionListItem).join("")}</ol>` : `<header class="index-intro"><p class="eyebrow">State of Connecticut Judicial Branch</p><h1>Infractions and violations</h1><p>Browse the official mail-in schedule by category, then open an entry for amounts and its linked statute.</p><p class="source-note">Effective ${escapeHtml(manifests.infractions.source.effective ?? "date not stated")} · ${entries.length.toLocaleString()} entries · <a href="${escapeHtml(manifests.infractions.source.url)}">Official schedule (PDF)</a></p></header>
      <ol class="infraction-categories mobile-only">${groups.map(([category, values]) => `<li><a href="${escapeHtml(infractionsRouteHref(category))}"><span>${values.length.toLocaleString()} entries</span><strong>${escapeHtml(category)}</strong></a></li>`).join("")}</ol>`;
  const mainContent = `<main class="infractions-page application-main" id="main-content">
    ${breadcrumbs([{ label: "Infractions", ...(selectedGroup ? { href: "#/infractions" } : {}) }, ...(selectedGroup ? [{ label: selectedGroup[0], ...(selectedEntry ? { href: infractionsRouteHref(selectedGroup[0]) } : {}) }] : []), ...(selectedEntry ? [{ label: `Sec. ${selectedEntry.citation}` }] : [])])}
    ${mainBody}
  </main>`;
  const contextualNavigation = [{
    label: "Infraction categories",
    className: "infraction-categories-column",
    heading: `<p class="eyebrow">Infractions</p><strong>Categories</strong>`,
    content: railList(categoryItems)
  }];
  if (selectedGroup) contextualNavigation.push({
    label: `${selectedGroup[0]} infractions`,
    className: "infraction-entries-column",
    heading: `<p class="eyebrow">${escapeHtml(selectedGroup[0])}</p><strong>Entries</strong>`,
    content: railList(entryItems, { empty: "No entries match this search." })
  });
  app.innerHTML = applicationShell({
    contextualNavigation,
    mainContent,
    columnCount: contextualColumnCount("infractions", route),
    mobilePresentationMode: selectedEntry ? "detail" : "drilldown",
    footer: "Unofficial access copy. Verify amounts and eligibility with the Judicial Branch."
  });
  if (selectedEntry) {
    deviceState.recordRecent({
      id: `infraction:${selectedEntry.id}`,
      type: "infraction",
      title: `Sec. ${selectedEntry.citation}`,
      subtitle: `${selectedGroup[0]} · ${selectedEntry.description}`,
      href: infractionsRouteHref(selectedGroup[0], { entry: selectedEntry.id })
    });
  }
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
  const letterCounts = aggregateShardCounts(manifests.index.shards);
  const available = [...letterCounts.keys()].filter((key) => /^[a-z]$/.test(key));
  const letter = route.letter;
  if (letter && !available.includes(letter)) return renderNotFound("That index letter was not found.");
  const topics = letter ? await secondaryRepository.loadIndexLetter(letter) : [];
  const selected = route.topic
    ? topics.find((topic) => topic.id === route.topic)
    : route.heading ? topics.find((topic) => topic.label.toLowerCase() === route.heading.toLowerCase()) : null;
  if ((route.topic || route.heading) && !selected) return renderNotFound("That index heading was not found.");
  const topicGroups = selected ? groupIndexEntries(selected.items) : [];
  const matchingEntry = selected && route.subheading
    ? findIndexSubheadingEntry(selected.items, route.subheading)
    : null;
  const search = !selected && route.query ? searchIndexTopics(topics, route.query) : null;
  const source = manifests.index.source;
  const letterItems = available.map((key) => `<li><a href="${escapeHtml(indexRouteHref(key))}"${key === letter ? ` aria-current="page"` : ""}><strong>${key.toUpperCase()}</strong><span>${(letterCounts.get(key) ?? 0).toLocaleString()} headings</span></a></li>`);
  const headingItems = topics.map((topic) => `<li><a href="${escapeHtml(indexRouteHref(letter, { topic: topic.id }))}"${selected?.id === topic.id ? ` aria-current="page"` : ""}><strong>${escapeHtml(topic.label)}</strong></a></li>`);
  const indexIntro = `<header class="index-intro">
      <p class="eyebrow">Legislative Commissioners' Office</p>
      <h1>Index to the General Statutes</h1>
      <p>Browse official subject headings and follow resolved citations into the statute reader. ${escapeHtml(source.revision)}.</p>
      <p class="source-note"><a href="${escapeHtml(source.url)}">View the official index volumes</a> · ${manifests.index.counts.headings.toLocaleString()} headings · ${manifests.index.counts.items.toLocaleString()} entries</p>
    </header>
    <form class="index-search-form" id="index-search-form">
      <label for="index-query">Search the subject index</label>
      <input id="index-query" name="query" type="search" minlength="2" required value="${escapeHtml(route.query ?? "")}" placeholder="Try motor vehicles">
      <button type="submit">Search index</button>
    </form>`;
  const mainBody = selected ? `<header class="index-intro index-topic-intro">
      <p class="eyebrow">General Statutes index</p>
      <h1>${escapeHtml(selected.label)}</h1>
      <p>Browse this subject heading and follow resolved citations into the statute reader.</p>
      <p class="source-note"><a href="${escapeHtml(indexRouteHref(letter))}">Back to ${escapeHtml(letter.toUpperCase())} headings</a> &middot; <a href="${escapeHtml(source.url)}">Official index volumes</a> &middot; ${escapeHtml(source.revision)}</p>
    </header><section class="index-browser" aria-live="polite">${renderSelectedIndexTopic(selected, topicGroups, matchingEntry, route.query ?? "")}</section>`
    : !letter ? `${indexIntro}<section class="mobile-only mobile-index-browser"><h2>Choose a letter</h2>${railList(letterItems, { className: "mobile-index-list" })}</section>`
      : `${search ? `<section class="index-browser" aria-live="polite">${renderIndexSearchResults(search)}</section>` : `<section class="desktop-only rail-prompt"><p class="eyebrow">${escapeHtml(letter.toUpperCase())} index</p><h1>Choose a heading</h1><p>Select a subject heading from the adjacent column.</p></section><section class="mobile-only mobile-index-browser"><div class="section-heading"><div><p class="eyebrow">General Statutes index</p><h1>${escapeHtml(letter.toUpperCase())} headings</h1></div><p>${topics.length.toLocaleString()}</p></div>${railList(headingItems, { className: "mobile-index-list" })}</section>`}`;
  const mainContent = `<main class="index-page application-main" id="main-content">
    ${breadcrumbs([{ label: "General Statutes index", ...(letter ? { href: indexRouteHref() } : {}) }, ...(letter ? [{ label: letter.toUpperCase(), ...(selected ? { href: indexRouteHref(letter) } : {}) }] : []), ...(selected ? [{ label: selected.label }] : [])])}
    ${mainBody}
    <aside class="legal-data-note"><strong>About this index</strong><p>This is a derived access copy of the official index, not legal text. Verify coverage and citations with the Legislative Commissioners' Office source.</p></aside>
  </main>`;
  const contextualNavigation = [{
    label: "Index letters",
    className: "index-letters-column",
    heading: `<p class="eyebrow">Subject index</p><strong>Letters</strong>`,
    content: railList(letterItems)
  }];
  if (letter) contextualNavigation.push({
    label: `${letter.toUpperCase()} index headings`,
    className: "index-headings-column",
    heading: `<p class="eyebrow">${escapeHtml(letter.toUpperCase())}</p><strong>Headings</strong>`,
    content: railList(headingItems)
  });
  setDocumentTitle(selected?.label ?? (letter ? `Statutes index ${letter.toUpperCase()}` : "Statutes index"));
  app.innerHTML = applicationShell({
    contextualNavigation,
    mainContent,
    columnCount: contextualColumnCount("index", route),
    mobilePresentationMode: selected ? "detail" : "drilldown"
  });

  document.querySelector("#index-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("query").trim();
    location.hash = indexRouteHref(topicLetter(query), { query });
  });
  if (selected?.items.length > LARGE_INDEX_TOPIC_THRESHOLD) {
    attachLargeIndexTopic(selected, topicGroups, matchingEntry);
  } else if (selected && matchingEntry) {
    const target = document.getElementById(matchingEntry.id);
    target?.classList.add("index-entry-target");
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  } else window.scrollTo({ top: 0 });
  if (selected) {
    deviceState.recordRecent({
      id: `index:${selected.id}`,
      type: "index",
      title: selected.label,
      subtitle: `General Statutes index · ${letter.toUpperCase()}`,
      href: indexRouteHref(letter, { topic: selected.id })
    });
  }
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
    if (route.kind === "titles") return renderTitles(catalog);
    if (route.kind === "not-found") return renderNotFound();
    if (route.kind === "search") return renderSearchPage(catalog, route);
    if (route.kind === "infractions") return renderInfractions(route);
    if (route.kind === "bookmarks") return renderBookmarks();
    if (route.kind === "about") return renderAbout(catalog);
    if (route.kind === "index") return renderStatutesIndex(route);

    let title = route.title ? findTitle(catalog, route.title) : null;
    let chapterMatch = route.chapter ? findChapter(catalog, route.chapter, title) : null;
    if (!title && chapterMatch) title = chapterMatch.title;
    if (!title) return renderNotFound("That title was not found.");
    if (route.kind === "title") return renderTitle(catalog, title);
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
  const openChapterSheet = event.target.closest("[data-open-chapter-sheet]");
  if (openChapterSheet) {
    chapterDialogController?.open(openChapterSheet);
    return;
  }
  if (event.target.closest("[data-close-chapter-sheet]")) {
    chapterDialogController?.close();
    return;
  }
  if (event.target.closest("[data-chapter-sheet] a")) {
    chapterDialogController?.close();
    return;
  }
  if (event.target.matches?.("[data-chapter-sheet]")) {
    chapterDialogController?.close();
    return;
  }
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
  const clearRecents = event.target.closest("[data-clear-recents]");
  if (clearRecents) {
    deviceState.clearRecents();
    if (parseRoute(location).kind === "home") renderHome(await catalogPromise);
    else {
      clearRecents.disabled = true;
      clearRecents.querySelector("small")?.replaceChildren("No recent history");
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
    document.querySelectorAll(".nav-badge").forEach((badge) => {
      const count = deviceState.bookmarks().length;
      badge.textContent = String(count);
      badge.setAttribute("aria-label", `${count} saved bookmark${count === 1 ? "" : "s"}`);
    });
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
