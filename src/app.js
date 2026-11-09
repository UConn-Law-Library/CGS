import { createOmnisearchController } from "./omnisearch-controller.js";
import { createAboutPage, formatSnapshotDate } from "./about-page.js";
import { createShell, icons, bookmarkButtonLabel, iconActionLabel, statutesNavHref } from "./shell.js";
import { createStatuteTree } from "./statute-tree.js";
import { createGroupTree } from "./group-tree.js";
import { QuickSearchRepository } from "./quick-search.js";
import { renderBookmarkPage } from "./bookmark-page.js";
import { bindBookmarkControls } from "./bookmark-controls.js";
import { explainSearchQuery, normalizeSearchOptions, SearchRepository } from "./search.js";
import { applyChapterOverlay, mergeSupplementTitleChapters, SupplementRepository } from "./supplements.js";
import { ProgressiveSearchClient } from "./search-client.js";
import {
  ACT_SORTS,
  ACT_TYPES,
  ACT_VIEWS,
  ActsRepository,
  actsCountLabel,
  actsCurrencyNote,
  actTextPattern,
  effectiveDateOptions,
  effectiveRows,
  filterActs,
  matchActText,
  normalizeActsOptions,
  parseSectionsParameter,
  renderActDocument,
  renderActSections,
  renderActsTable,
  renderEffectiveTable,
  sectionsSummary
} from "./acts.js";
import {
  actRouteHref,
  actsRouteHref,
  findChapter,
  findSection,
  findTitle,
  chapterDisplayLabel,
  aboutRouteHref,
  guideRouteHref,
  infractionsRouteHref,
  indexRouteHref,
  parseRoute,
  routeHref,
  searchRouteHref,
  sectionRouteKey,
  titlesRouteHref
} from "./routes.js";
import { diffRevisionText } from "./revision-diff.js";
import { amendmentsForSection } from "./act-amendments.js";
import {
  escapeHtml,
  extractLegalReferences,
  leadingSubsection,
  navigationSectionDescription,
  navigationSectionLabel,
  navigationSections,
  renderLinkedText,
  sectionStatuses,
  shortSectionDescription,
  routeForDocument,
  subsectionCitation
} from "./reader.js";
import { renderSearchExcerpt, renderSearchHighlight, searchHighlightTerms } from "./search-highlight.js";
import { SecondarySourceRepository } from "./secondary-sources.js";
import { applyPreferences, DeviceState } from "./device-state.js";
import { PwaManager } from "./pwa.js";
import { NativeDialogController } from "./dialog.js";
import { aggregateShardCounts, contextualColumnCount } from "./context-navigation.js";
import { NavigationHistory } from "./navigation-history.js";
import { getJson, retryableLoader } from "./data-loader.js";
import {
  actSearchLinks,
  findActMatches,
  findInfractionMatches,
  matchInfractions,
  plainSearchWords
} from "./omnisearch.js";
import {
  formatMoney,
  findIndexSubheadingEntry,
  groupIndexEntries,
  renderIndexEntry,
  renderIndexEntryText,
  renderIndexReferences,
  renderLinkedIndexEntries,
  renderSecondaryContext,
  searchIndexEntries,
  searchIndexTopics,
  topicLetter
} from "./secondary-ui.js";

const app = document.querySelector("#app");
const supplementRepository = new SupplementRepository();
const repository = new SearchRepository({ supplementRepository });
const searchClient = new ProgressiveSearchClient({ repository });
const quickSearch = new QuickSearchRepository(repository);
const statuteTree = createStatuteTree({
  titleLabel,
  chapterLabel,
  titleRoute,
  chapterRoute,
  loadHeadings: (titleId) => quickSearch.loadHeadings(titleId),
  // Recent Act tags for heading rows, judged against the same statute text the reader shows.
  loadPendingActs: async (catalog) => {
    const [index, edition] = await Promise.all([actsRepository.amendments(), supplementRepository.latestEdition()]);
    const years = statuteTextYears(catalog, edition);
    return (row) => amendmentsForSection(index, row, years);
  },
  noticePills: headingNoticePills,
  hiddenStatuses: () => deviceState.preferences().hiddenStatuses
});

// Page tree navigation for the subject index and the infraction schedule.
const indexTree = createGroupTree({
  id: "index",
  label: "Index letters and headings",
  heading: "Subject index",
  filterLabel: "Filter letters and headings",
  placeholder: "Heading",
  nouns: { group: ["letter", "letters"], item: ["heading", "headings"] },
  loadItems: async (group) => indexTreeItems(group.key, await secondaryRepository.loadIndexLetter(group.key)),
  // The full index is large, so a filter searches the headings under the letter it starts
  // with, as the index search does.
  searchGroups: (query, groups) => groups.filter((group) => group.key === topicLetter(query)),
  scopeNote: (query) => query.trim().length >= 2 ? `Headings are searched under ${topicLetter(query).toUpperCase()}.` : ""
});

function indexTreeItems(letter, topics) {
  return topics.map((topic) => ({ key: topic.id, label: topic.label, href: indexRouteHref(letter, { topic: topic.id }), text: topic.label.toLocaleLowerCase() }));
}

const infractionTree = createGroupTree({
  id: "infractions",
  label: "Infraction categories and entries",
  heading: "Infractions",
  filterLabel: "Filter categories and entries",
  placeholder: "Citation or description",
  nouns: { group: ["category", "categories"], item: ["entry", "entries"] },
  loadItems: async (group) => (await secondaryRepository.loadAllInfractions()).filter((entry) => entry.category === group.key).map(infractionTreeItem)
});

function infractionTreeItem(entry) {
  return {
    key: entry.id,
    label: `Sec. ${entry.citation}`,
    description: entry.description,
    href: infractionsRouteHref(entry.category, { entry: entry.id }),
    text: `${entry.citation} ${entry.description}`.toLocaleLowerCase()
  };
}
const secondaryRepository = new SecondarySourceRepository();
const actsRepository = new ActsRepository();
const deviceState = new DeviceState();
const navigationHistory = new NavigationHistory();
let lastRecordedPage = null;
const pwaManager = new PwaManager();
const loadCatalog = retryableLoader(() => getJson("./data/catalog.json"));
let renderSequence = 0;
let hasRendered = false;
let activeSearchController = null;
let chapterDialogController = null;
const deferredIndexLinks = new Map();
let pendingClearAction = null;
let unmountGuide = null;
let pwaState = pwaManager.state;
const { closeOmni, scheduleOmnisearch, moveOmniSelection, selectedOmniItem } = createOmnisearchController({ loadCatalog, quickSearch, secondaryRepository, actsRepository });
const SEARCH_BATCH_SIZE = 50;
const LARGE_INDEX_TOPIC_THRESHOLD = 200;
const { siteHeader, navigationSettingsButton, navigationSettingsPanel, updatePwaControls } = createShell({ deviceState, navigationHistory, getPwaState: () => pwaState });
const renderAbout = createAboutPage({ app, secondaryRepository, actsRepository, loadLatestSupplement, setDocumentTitle, siteHeader, breadcrumbs, legalFooter, isCurrent: (sequence) => sequence === renderSequence });
applyPreferences(deviceState.preferences());
pwaManager.subscribe((state) => {
  pwaState = state;
  updatePwaControls();
});
pwaManager.init();

// fetch() rejects with a TypeError when the request never reaches a server; HTTP errors
// arrive as our own Error with the status in its message.
function loadFailureKind(error) {
  if (!navigator.onLine) return "offline";
  return error instanceof TypeError ? "network" : "server";
}

function loadFailurePage(error) {
  const kind = loadFailureKind(error);
  const heading = kind === "offline" ? "This page isn’t saved for offline use" : "The statutes could not be loaded";
  const message = {
    offline: "You’re offline, and this part of the statutes hasn’t been downloaded to this device. The page will load again when you reconnect. To read without a connection later, choose Download for offline use in Settings.",
    network: "The statute data could not be reached. Check your connection and try again.",
    server: "The statute data could not be loaded from the server. Try again in a moment."
  }[kind];
  return `<main class="error load-failure" id="main-content" data-load-failure>
    <h1>${heading}</h1>
    <p>${message}</p>
    <p><button type="button" data-retry-route>Try again</button></p>
    <p class="load-failure-detail">Technical detail: ${escapeHtml(error.message)}</p>
  </main>`;
}

function searchFailureMessage(error) {
  return {
    offline: "You’re offline, and the search data hasn’t been downloaded to this device. Reconnect and search again.",
    network: "The search data could not be reached. Check your connection and search again.",
    server: `Search could not finish because its data did not load (${error.message}). Try again in a moment.`
  }[loadFailureKind(error)];
}

function legalFooter() {
  return `This application is not legal advice and is not the official legal publication. <a href="${aboutRouteHref("sources")}">Verify information with official sources</a>.`;
}

function applicationShell({
  contextualNavigation = [],
  mainContent,
  columnCount = contextualNavigation.length,
  mobilePresentationMode = "focused",
  footer = legalFooter(),
  viewport
}) {
  const layout = deviceState.navigationLayout();
  const defaults = { 1: [256], 2: [208, 272], 3: [176, 208, 240] };
  const paneWidths = contextualNavigation[0]?.defaultWidth
    ? [layout.treeWidth ?? contextualNavigation[0].defaultWidth]
    : (defaults[columnCount] ?? []).map((width, index) => layout.widths[index] ?? width);
  const fit = contextFit(paneWidths, viewport.width, viewport.rem);
  const style = [
    ...fit.widths.map((width, index) => `--context-width-${index + 1}:${width}px`),
    `--context-tracks:${fit.tracks}`,
    `--context-total-width:${fit.total}px`
  ].join(";");
  const hidden = (index) => index < fit.first ? " hidden" : "";
  return `${siteHeader()}${columnCount ? navigationSettingsPanel() : ""}<div class="application-shell mobile-${escapeHtml(mobilePresentationMode)}" data-context-columns="${columnCount}" data-context-widths="${paneWidths.join(",")}" id="context-navigation" data-navigation-collapsed="${layout.collapsed}" style="${style}">
    ${columnCount ? `<button type="button" class="context-collapse-toggle" data-toggle-navigation aria-controls="context-navigation" aria-expanded="${!layout.collapsed}" aria-label="${layout.collapsed ? "Show navigation panes" : "Hide navigation panes"}" title="${layout.collapsed ? "Show navigation panes" : "Hide navigation panes"}"><span aria-hidden="true">${layout.collapsed ? "›" : "‹"}</span></button>` : ""}
    ${contextualNavigation.map((column, index) => `<aside class="context-column ${escapeHtml(column.className ?? "")}" id="context-pane-${index + 1}" data-context-key="${escapeHtml(column.className || column.label)}" aria-label="${escapeHtml(column.label)}"${hidden(index)}>
      ${column.heading ? `<div class="context-column-heading">${navigationSettingsButton()}${column.heading}</div>` : ""}${column.content}
    </aside><div class="context-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize ${escapeHtml(column.label)} pane" aria-controls="context-pane-${index + 1}" aria-valuemin="144" aria-valuemax="420" aria-valuenow="${fit.widths[index]}" data-resize-pane="${index}"${hidden(index)}></div>`).join("")}
    ${mainContent}
  </div><footer>${footer}</footer>`;
}

function contextScrollPositions() {
  return new Map([...document.querySelectorAll(".context-column[data-context-key]")]
    .map((column) => [column.dataset.contextKey, (column.querySelector(':scope > [id^="rail-"]') ?? column).scrollTop]));
}

function restoreContextScrollPositions(positions) {
  requestAnimationFrame(() => {
    for (const pane of document.querySelectorAll(".context-column[data-context-key]")) {
      const column = pane.querySelector(':scope > [id^="rail-"]') ?? pane;
      const previous = positions.get(pane.dataset.contextKey);
      if (previous != null) column.scrollTop = previous;
      const selected = column.querySelector('[aria-current="page"]');
      if (selected) {
        const headingHeight = column.querySelector(".context-column-heading")?.offsetHeight ?? 0;
        const selectedTop = selected.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop;
        const selectedBottom = selectedTop + selected.offsetHeight;
        const visibleTop = column.scrollTop + headingHeight;
        const visibleBottom = column.scrollTop + column.clientHeight;
        if (selectedTop < visibleTop || selectedBottom > visibleBottom) {
          column.scrollTop = Math.max(0, selectedTop - (column.clientHeight - selected.offsetHeight) / 2);
        }
      }
    }
  });
}

function mountApplicationShell(options) {
  const positions = contextScrollPositions();
  // Measured while the outgoing page's layout is still current, so fitting the panes into the
  // new page costs no extra layout pass over it.
  const viewport = {
    width: document.documentElement.clientWidth,
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize)
  };
  app.innerHTML = applicationShell({ ...options, viewport });
  restoreContextScrollPositions(positions);
}

// Statute text keeps about a 64-character measure beside the panes: 36rem for the reading
// column, gutters included. When the panes and that column don't fit side by side, the
// outermost level of the hierarchy gives way first (titles, then chapters); the breadcrumb
// still reaches it. Measured in rem, so a larger text size keeps fewer panes.
const READING_COLUMN_MIN_REM = 36;
const CONTEXT_PANE_MIN = 144;
const CONTEXT_RESIZER = 6;

function readingColumnMinimum() {
  return READING_COLUMN_MIN_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// Which panes fit beside the reading column, at what widths: `first` is the first pane shown.
function contextFit(widths, shellWidth, rem) {
  const available = shellWidth - READING_COLUMN_MIN_REM * rem;
  const span = (from) => widths.slice(from).reduce((total, width) => total + width + CONTEXT_RESIZER, 0);
  let first = 0;
  while (first < widths.length - 1 && span(first) > available) first += 1;
  // Even one pane can be too wide for a narrow window; it shrinks rather than squeezing the text.
  const fitted = widths.map((width, index) => index === widths.length - 1 && span(first) > available
    ? Math.max(CONTEXT_PANE_MIN, Math.floor(available) - CONTEXT_RESIZER)
    : width);
  return {
    first,
    widths: fitted,
    tracks: fitted.slice(first).map((_, offset) => `var(--context-width-${first + offset + 1}) ${CONTEXT_RESIZER}px`).join(" "),
    total: fitted.slice(first).reduce((total, width) => total + width + CONTEXT_RESIZER, 0)
  };
}

function fitContextColumns(shell = document.querySelector(".application-shell")) {
  const columns = shell ? [...shell.querySelectorAll(".context-column")] : [];
  if (!columns.length) return;
  const fit = contextFit(shell.dataset.contextWidths.split(",").map(Number), shell.clientWidth, parseFloat(getComputedStyle(document.documentElement).fontSize));
  columns.forEach((column, index) => {
    column.hidden = index < fit.first;
    column.nextElementSibling.hidden = index < fit.first;
    shell.style.setProperty(`--context-width-${index + 1}`, `${fit.widths[index]}px`);
  });
  shell.style.setProperty("--context-tracks", fit.tracks);
  shell.style.setProperty("--context-total-width", `${fit.total}px`);
}

let contextFitFrame = 0;
function scheduleContextFit() {
  cancelAnimationFrame(contextFitFrame);
  contextFitFrame = requestAnimationFrame(() => fitContextColumns());
}
window.addEventListener("resize", scheduleContextFit);

function railList(items, { className = "", empty = "No items are available." } = {}) {
  if (!items.length) return `<p class="context-empty">${escapeHtml(empty)}</p>`;
  return `<ol class="context-list ${escapeHtml(className)}">${items.join("")}</ol>`;
}

// One small, local list filter shared by navigation panes and touch browse lists.
// It only filters rendered headings; full-text search remains in its existing worker.
function browseFilter(id, label, target, placeholder = "Number or heading") {
  return `<div class="browse-filter"><label for="${id}">${escapeHtml(label)}</label>
    <input id="${id}" type="search" placeholder="${escapeHtml(placeholder)}" data-filter-list="${target}" aria-controls="${target}" autocomplete="off">
    <p class="browse-filter-status" role="status" aria-live="polite" data-filter-status="${target}"></p></div>`;
}

// The three panes are the default. The page tree replaces them when chosen in Settings.
function statuteNavigation(catalog, route, panes, current = {}) {
  if (deviceState.preferences().navigationTree) return { contextualNavigation: [statuteTree.column(catalog, current)], columnCount: 1 };
  return { contextualNavigation: panes(), columnCount: contextualColumnCount("statutes", route) };
}

function statuteTitleColumn(catalog, selected = null) {
  return {
    label: "Statute titles",
    className: "titles-column",
    heading: `<p class="eyebrow">Statutes</p><strong>Titles</strong>${browseFilter("rail-title-filter", "Filter titles", "rail-titles")}`,
    content: `<div id="rail-titles">${railList(catalog.titles.map((title) => `<li><a href="${escapeHtml(titleRoute(title))}"${selected?.id === title.id ? ` aria-current="page"` : ""}><strong>${escapeHtml(titleLabel(title))}</strong><span>${escapeHtml(title.name)}</span></a></li>`))}</div>`
  };
}

function statuteChapterColumn(title, selected = null) {
  return {
    label: `Chapters in ${titleLabel(title)}`,
    className: "chapters-column",
    heading: `<p class="eyebrow">${escapeHtml(titleLabel(title))}</p><strong>Chapters</strong>${browseFilter("rail-chapter-filter", "Filter chapters", "rail-chapters")}`,
    content: `<div id="rail-chapters">${railList(title.chapters.map((chapter) => `<li><a href="${escapeHtml(chapterRoute(title, chapter))}"${selected?.id === chapter.id ? ` aria-current="page"` : ""}><strong>${escapeHtml(chapterLabel(chapter))}</strong><span>${escapeHtml(chapter.name)}</span><small>${chapter.sectionCount} section${chapter.sectionCount === 1 ? "" : "s"}</small></a></li>`))}</div>`
  };
}

// A section that a listed Public Act amends or repeals, before the statute text shows it. The
// wording says "recent" rather than a year; each act's citation carries its year.
function pendingActPill(amendments = []) {
  if (!amendments.length) return "";
  const repealed = amendments.every((amendment) => amendment.action === "repealed");
  const description = `${repealed ? "Repealed" : "Amended"} by ${amendments.length === 1 ? "a recent Public Act" : "recent Public Acts"}`;
  return `<span class="section-status-pill act-pending-pill navigation-notice" title="${description}"><span class="navigation-notice-label" aria-hidden="true">Recent Act</span><span class="visually-hidden">${description}</span></span>`;
}

const STATUS_LABELS = { repealed: "Repealed", transferred: "Transferred", obsolete: "Obsolete", reserved: "Reserved" };

// The status tags (Repealed, Transferred, Obsolete, Reserved) and the supplement tag. Recent Act
// tags load separately.
function sectionNoticePills(statuses, change) {
  const statusPill = statuses.filter((status) => STATUS_LABELS[status]).map((status) => `<span class="section-status-pill ${status}-pill navigation-notice" title="${STATUS_LABELS[status]}"><span class="navigation-notice-label">${STATUS_LABELS[status]}</span></span>`).join("");
  const supplementText = change ? escapeHtml(supplementLabel(change, { short: true })) : "";
  const supplementPill = change ? `<span class="supplement-pill supplement-${escapeHtml(change.presentation)} navigation-notice" title="${supplementText}"><span class="navigation-notice-label">${supplementText}</span></span>` : "";
  return `${statusPill}${supplementPill}`;
}

// The same tags for a row of a heading index, which records each status by name and the
// supplement tag as "supplement-<presentation>".
function headingNoticePills(tags = [], amendments = []) {
  const supplement = tags.find((tag) => tag.startsWith("supplement-"));
  return `${sectionNoticePills(tags.filter((tag) => STATUS_LABELS[tag]), supplement ? { presentation: supplement.slice("supplement-".length) } : null)}${pendingActPill(amendments)}`;
}

function statuteSectionItems(title, chapter, sections, selected, changeBySection = new Map(), pendingBySection = new Map()) {
  return sections.map((section) => {
    const notices = sectionNoticePills(sectionStatuses(section), changeBySection.get(section.id));
    const label = navigationSectionLabel(section);
    const description = navigationSectionDescription(section);
    const shortDescription = shortSectionDescription(description);
    const showDescription = shortDescription && description !== section.citation && label !== section.heading;
    const shortLabel = label === section.heading ? label.split(/(?<=\.)\s+/, 1)[0] : label;
    return `<li data-filter-heading="${escapeHtml(section.heading)}"><a class="section-navigation-link" href="${escapeHtml(provisionRoute(title, chapter, section))}"${selected?.id === section.id ? ` aria-current="page"` : ""}><strong>${escapeHtml(shortLabel)}</strong><span class="section-navigation-notices">${notices}<span data-act-notice-for="${escapeHtml(section.id)}">${pendingActPill(pendingBySection.get(section.id))}</span></span>${showDescription ? `<span class="section-navigation-description">${escapeHtml(shortDescription)}</span>` : ""}</a></li>`;
  });
}

const disclosureChevron = `<svg class="tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

// A collapsed list of a chapter's sections, drawn as a row with a chevron so it reads as
// something to open.
function chapterChangeList(label, items) {
  return `<details class="chapter-change-list"><summary><span>${label}</span>${disclosureChevron}</summary>${railList(items)}</details>`;
}

// The supplement and Recent Act notices share one shape: a heading, one sentence, and the
// sections as collapsed lists. Their colors carry the meaning (blue supplement, amber caution).
function chapterSupplementSummary(title, chapter, overlay, changeBySection) {
  if (!changeBySection.size) return "";
  const updated = [];
  const added = [];
  for (const section of chapter.sections) {
    const change = changeBySection.get(section.id);
    if (change) (change.presentation === "new" ? added : updated).push(section);
  }
  const count = updated.length + added.length;
  const groups = [["Updated sections", updated], ["New sections", added]];
  return `<section class="chapter-notice supplement-summary"><h2>Changed by the ${overlay.editionYear} Supplement</h2>
    <p>The text of ${count} section${count === 1 ? "" : "s"} in this chapter comes from the ${overlay.editionYear} Supplement.</p>
    ${groups.filter(([, sections]) => sections.length).map(([label, sections]) =>
      chapterChangeList(`${label} (${sections.length})`, statuteSectionItems(title, chapter, sections, null, changeBySection))
    ).join("")}</section>`;
}

function pendingChapterSummary(title, chapter, changeBySection, pendingBySection) {
  if (!pendingBySection.size) return "";
  const all = [...pendingBySection.values()].flat();
  const count = pendingBySection.size;
  const oneAct = new Set(all.map((amendment) => amendment.citation)).size === 1;
  const sections = chapter.sections.filter((section) => pendingBySection.has(section.id));
  return `<section class="chapter-notice pending-amendments-summary"><h2>Changed by recent Public Acts</h2>
    <p>${oneAct ? "A recent Public Act changes" : "Recent Public Acts change"} ${count} section${count === 1 ? "" : "s"} in this chapter. The statute text does not include those changes yet.</p>
    ${chapterChangeList(`Affected sections (${count})`, statuteSectionItems(title, chapter, sections, null, changeBySection, pendingBySection))}</section>`;
}

function statuteSectionColumn(title, chapter, sections, selected, changeBySection, pendingBySection) {
  return {
    label: `Sections in ${chapterLabel(chapter)}`,
    className: "sections-column",
    heading: `<p class="eyebrow">${escapeHtml(chapterLabel(chapter))}</p><strong>Sections</strong>${browseFilter("rail-section-filter", "Filter sections", "rail-sections")}`,
    content: `<div id="rail-sections">${railList(statuteSectionItems(title, chapter, sections, selected, changeBySection, pendingBySection))}</div>`
  };
}

function chapterSheet(title, chapter, sections, selected, changeBySection, pendingBySection) {
  return `<dialog class="chapter-sheet" data-chapter-sheet aria-labelledby="chapter-sheet-title">
    <div class="chapter-sheet-panel"><header><div><p class="eyebrow">${escapeHtml(titleLabel(title))}</p><h2 id="chapter-sheet-title">${escapeHtml(chapterLabel(chapter))} sections</h2></div><button type="button" data-close-chapter-sheet autofocus>Close</button></header>
      ${browseFilter("sheet-section-filter", "Filter chapter sections", "sheet-sections")}
      <div id="sheet-sections">${railList(statuteSectionItems(title, chapter, sections, selected, changeBySection, pendingBySection), { className: "chapter-sheet-list" })}</div>
    </div>
  </dialog>`;
}

function bindChapterSheet() {
  chapterDialogController?.destroy();
  chapterDialogController = null;
  const dialog = document.querySelector("[data-chapter-sheet]");
  if (dialog) chapterDialogController = new NativeDialogController(dialog);
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
  return chapterDisplayLabel(chapter);
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

async function referenceMaps(provisions, catalog, { resolve = true } = {}) {
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
    if (!title) continue;
    if (!referencedTitles.has(title.id)) referencedTitles.set(title.id, { title, citations: [] });
    referencedTitles.get(title.id).citations.push(citation);
  }

  for (const citation of references.sections) sections.set(citation, searchRouteHref(citation));
  for (const number of references.chapters) {
    const match = findChapter(catalog, number);
    if (match) chapters.set(number, chapterRoute(match.title, match.chapter));
  }
  if (!resolve) return { sections, chapters };

  await Promise.all([...referencedTitles.values()].map(async ({ title, citations }) => {
    try {
      const routes = await repository.loadCitations(title.id);
      for (const citation of citations) {
        const route = routes[citation];
        if (route) sections.set(citation, routeHref({ title: title.number, chapter: route[0], section: route[1] }));
      }
    } catch (error) {
      // Without the lookup (e.g. older offline data), a search still finds the section.
      console.warn("Could not load citation routes", error);
      for (const citation of citations) sections.set(citation, searchRouteHref(citation));
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
  const citation = subsectionCitation(section, subsection);
  return `<p id="subsection-${escapeHtml(subsection.key)}" class="statute-paragraph">
    <a class="subsection-link" href="${escapeHtml(href)}" aria-label="Link to subsection ${escapeHtml(subsection.label)}"${citation ? ` title="Link to ${escapeHtml(citation)}"` : ""}>${escapeHtml(subsection.label)}</a>
    ${citation ? `<button class="copy-citation" type="button" data-copy-citation="${escapeHtml(citation)}" aria-label="Copy ${escapeHtml(citation)}">Copy citation</button>` : ""}
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
    renderNotes(change ? `Source (${change.editionYear} Supplement)` : "Source", section.content.sourceNotes, maps),
    renderNotes(change ? `History (${change.editionYear} Supplement)` : "History", section.content.history, maps),
    renderAnnotations(section.content.annotations, maps),
    `<div data-secondary-references>${secondaryContext ? renderSecondaryContext(secondaryContext) : '<p role="status">Related references loading…</p>'}</div>`
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
    ? `${change.presentation === "amended" ? "" : `${labels[change.presentation]} · `}Supplement`
    : `${labels[change.presentation]} — ${change.editionYear} Supplement`;
}

function renderPreviousRevision(change, maps) {
  const priorYear = change.editionYear - 1;
  return `<p class="revision-view-note">Text of the ${priorYear} revision, superseded by the ${change.editionYear} Supplement.</p>
    ${change.previousSections.map((section) => `<section class="prior-provision">
      <h2>${escapeHtml(section.heading)}</h2>
      <div class="statute-text">${section.content.body.map((paragraph) => `<p>${renderLinkedText(paragraph, maps)}</p>`).join("")}</div>
      <div class="section-notes">
        ${renderNotes("Source", section.content.sourceNotes, maps)}
        ${renderNotes("History", section.content.history, maps)}
        ${renderAnnotations(section.content.annotations, maps)}
      </div>
    </section>`).join("")}`;
}

function renderRevisionComparison(section, change, maps) {
  const priorYear = change.editionYear - 1;
  const previousText = change.previousSections
    .map((previous) => previous.content.body.join("\n\n"))
    .join("\n\n");
  const currentText = section.content.body.join("\n\n");
  const segments = diffRevisionText(previousText, currentText);
  const diff = segments.map((segment) => {
    const text = renderLinkedText(segment.text, maps);
    if (segment.type === "insert") return `<ins class="revision-addition">${text}</ins>`;
    if (segment.type === "delete") return `<del class="revision-deletion">${text}</del>`;
    return text;
  }).join("");
  return `<div class="revision-comparison-content">
      <header><p class="eyebrow">Language comparison</p><h2>${change.editionYear} Supplement compared with ${priorYear}</h2><p>Formatting changes may appear as textual changes. Verify language with the official sources.</p></header>
      <div class="revision-diff-legend" aria-label="Comparison legend"><span class="revision-addition">Added in ${change.editionYear}</span><span class="revision-deletion">Removed from ${priorYear}</span></div>
      <div class="statute-text revision-diff-text">${diff}</div>
    </div>`;
}

// A section with earlier text switches between three views. The Supplement's text comes first
// because it is the current law. Any other section renders its text directly.
function renderTextViews(section, change, currentView, maps) {
  if (!change?.previousSections?.length) return currentView;
  const id = `revision-views-${section.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const views = [
    ["current", `${change.editionYear} Supplement`, currentView],
    ["previous", `${change.editionYear - 1} text`, renderPreviousRevision(change, maps)],
    ["compare", "Compare", renderRevisionComparison(section, change, maps)]
  ];
  return `<div class="revision-view-switch"><div class="button-group" role="tablist" aria-label="Section text version">
      ${views.map(([key, label], index) => `<button type="button" role="tab" id="${id}-${key}-tab" aria-controls="${id}-${key}" aria-selected="${index === 0}"${index ? ' tabindex="-1"' : ""} data-revision-view>${escapeHtml(label)}</button>`).join("")}
    </div></div>
    ${views.map(([key, , content], index) => `<div class="revision-view" role="tabpanel" id="${id}-${key}" aria-labelledby="${id}-${key}-tab" tabindex="0"${index ? " hidden" : ""}>${content}</div>`).join("")}`;
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

function pendingAmendmentLine(amendment) {
  const href = actRouteHref(amendment.session, { type: "public", number: amendment.number }, { section: amendment.section });
  const what = amendment.action === "repealed" ? "Repeals this section"
    : amendment.scope?.startsWith("adds ") ? `Adds to this section: ${amendment.scope.slice("adds ".length)}`
      : amendment.scope ? `Amends ${amendment.scope}` : "Amends this section";
  const effective = amendment.effective === "Effective from passage" && amendment.approved
    ? `Effective from passage (approved ${amendment.approved})`
    : amendment.effective ?? "Effective date not stated in the act text";
  return `<li><a href="${escapeHtml(href)}">${escapeHtml(amendment.citation)}, § ${escapeHtml(amendment.section)}</a><span>${escapeHtml(what)}. ${escapeHtml(effective)}.</span></li>`;
}

// Listed Public Acts that change this section after the statute text was published.
function renderPendingAmendments(amendments = []) {
  if (!amendments.length) return "";
  const repealed = amendments.every((amendment) => amendment.action === "repealed");
  const heading = amendments.length === 1
    ? `A recent Public Act ${repealed ? "repeals" : "amends"} this section`
    : `Recent Public Acts ${repealed ? "repeal" : "change"} this section`;
  return `<aside class="pending-amendments" aria-labelledby="pending-amendments-heading">
    <h2 id="pending-amendments-heading">${escapeHtml(heading)}</h2>
    <p>The text below does not include ${amendments.length === 1 ? "this change" : "these changes"} yet. Read the act with this section, and check when each change takes effect.</p>
    <ul>${amendments.map(pendingAmendmentLine).join("")}</ul>
    <p class="pending-amendments-note">An act can also affect this section without amending it. <a href="${escapeHtml(guideRouteHref("research"))}">How to check whether a section is current</a></p>
  </aside>`;
}

// Share opens the device's share sheet. Where there is none, it would only repeat Copy link.
function canShareFromDevice() {
  return typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches;
}

function renderProvision(title, chapter, section, maps, secondaryContext = null, change = null, amendments = []) {
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
    <div data-amendments-status><p class="visually-hidden" role="status">Amendment information loading…</p></div>
    <div class="section-actions" aria-label="Section actions">
      <button type="button" class="icon-action" data-copy-citation="${escapeHtml(`Conn. Gen. Stat. ${section.citation ? `§ ${section.citation}` : sectionLabel(section)}`)}">${iconActionLabel(icons.copy, "Copy citation")}</button>
      ${bookmarkButton(bookmark, "icon-action")}
      <button type="button" class="icon-action" data-copy-link="${escapeHtml(route)}">${iconActionLabel(icons.link, "Copy link")}</button>
      ${canShareFromDevice() ? `<button type="button" class="icon-action" data-share-link="${escapeHtml(route)}" data-share-title="${escapeHtml(section.heading)}">${iconActionLabel(icons.share, "Share")}</button>` : ""}
      <a class="icon-action" href="${escapeHtml(email)}">${iconActionLabel(icons.mail, "Email")}</a>
      <a class="primary-action" href="${escapeHtml(section.sourceUrl)}">Official source</a>
    </div>
    <p class="action-status" role="status" aria-live="polite"></p>
    ${renderTextViews(section, change, `<div class="statute-text">${section.content.body.map((paragraph) => renderParagraph(paragraph, maps, title, chapter, section)).join("")}</div>
    ${renderInformationReferences(section, maps, secondaryContext, change)}`, maps)}
  </article>`;
}

const SEARCH_FIELD_LABELS = {
  statute: "Statute text",
  citation: "Citation",
  heading: "Heading",
  body: "Body",
  history: "History",
  annotations: "Annotations"
};

function searchResultContext(document, searchOptions) {
  if (searchOptions.field === "history") return document.history ?? "";
  if (searchOptions.field === "annotations") return document.annotations ?? "";
  return document.text ?? "";
}

function renderSearchResults(matches, results, query, searchOptions = {}) {
  const options = normalizeSearchOptions(searchOptions);
  const highlightTerms = searchHighlightTerms(query, { within: options.within });
  results.innerHTML = matches.map(({ document, score, matchedFields = [] }) => {
    const documentStatus = document.status === "active" ? "" : `<span class="status">${escapeHtml(document.status)}</span>`;
    const supplement = document.supplement ? `<span class="supplement-pill supplement-${escapeHtml(document.supplement.presentation)}">${escapeHtml(supplementLabel(document.supplement, { short: true }))}</span>` : "";
    const field = ["all", "statute"].includes(options.field) && matchedFields.length
      ? `<span class="result-match-field">${escapeHtml(matchedFields.map((name) => SEARCH_FIELD_LABELS[name] ?? name).join(", "))}</span>`
      : "";
    return `<li><a href="${escapeHtml(routeForDocument(document))}"><span class="result-citation">${renderSearchHighlight(document.citation ?? document.citations.join("–"), highlightTerms)}</span>${renderSearchHighlight(document.heading, highlightTerms)} ${documentStatus}${supplement}${field}</a>
      <p>${escapeHtml(titleLabel(document.title))} · ${escapeHtml(chapterLabel(document.chapter))} · ${renderSearchExcerpt(searchResultContext(document, options), highlightTerms)}</p><span class="visually-hidden">Relevance ${score}</span></li>`;
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
      <h1>Connecticut General Statutes</h1>
      <p>Browse and search the statutes, the official subject index, the Judicial Branch infraction schedule, and recent Public and Special Acts. Save frequently used material on this device.</p>
    </header>
    <section class="research-start" aria-label="Search examples">
      <p>Search Connecticut law by citation or keywords. Try <a href="${searchRouteHref("1-210")}">1-210</a>, <a href="${searchRouteHref('"freedom of information"')}">“freedom of information”</a>, or <a href="${searchRouteHref("landlord AND tenant")}">landlord AND tenant</a></p>
    </section>
    <section class="destination-grid" aria-label="Explore legal materials">
      <a data-destination="statutes" href="${titlesRouteHref()}"><span aria-hidden="true">§</span><strong>Browse statutes</strong><small>Navigate by title, chapter, or section.</small></a>
      <a data-destination="index" href="#/index"><span aria-hidden="true">A–Z</span><strong>Subject index</strong><small>Find statutes by topic in the official LCO index.</small></a>
      <a data-destination="infractions" href="#/infractions"><span aria-hidden="true">${icons.scale}</span><strong>Infraction schedule</strong><small>Review violations, amounts, and linked statutes.</small></a>
      <a data-destination="acts" href="#/acts"><span aria-hidden="true">${icons.document}</span><strong>Public and Special Acts</strong><small>See recent laws not yet reflected in the statute text.</small></a>
      <a data-destination="bookmarks" href="#/bookmarks"><span aria-hidden="true">${icons.bookmark}</span><strong>Bookmarks</strong><small>Return to sections and infractions saved on this device.</small></a>
      <a data-destination="guide" href="${guideRouteHref()}"><span aria-hidden="true">${icons.help}</span><strong>Understanding the Statutes</strong><small>How bills become law and how current the published text is.</small></a>
    </section>
    <section class="home-activity" aria-label="Your activity">
      <div><div class="section-heading"><div><p class="eyebrow">On this device</p><h2>Recently viewed</h2></div>${recents.length ? `<button type="button" class="text-button" data-clear-recents>Clear</button>` : ""}</div>${renderActivityList(recents, "Sections, index topics, and infractions you open will appear here.")}</div>
      <div><div class="section-heading"><div><p class="eyebrow">Saved</p><h2>Recent bookmarks</h2></div>${bookmarks.length ? `<a href="#/bookmarks">View all</a>` : ""}</div>${renderActivityList(bookmarks, "Your most recently saved bookmarks will appear here.")}</div>
    </section>
  </main>`;
  mountApplicationShell({
    ...statuteNavigation(catalog, { kind: "home" }, () => [statuteTitleColumn(catalog)]),
    mainContent,
    mobilePresentationMode: "home"
  });
}

function renderTitles(catalog) {
  setDocumentTitle("Titles");
  app.innerHTML = `${siteHeader()}<main class="browse-page titles-page" id="main-content">
    <header class="browse-heading"><div><p class="eyebrow">${catalog.counts.chapters.toLocaleString()} chapters · ${catalog.counts.sections.toLocaleString()} sections</p><h1>Statute titles</h1></div></header>
    ${browseFilter("title-filter", "Find a title", "browse-titles-list")}
    <ol class="title-list" id="browse-titles-list">${catalog.titles.map((title) => `<li><a href="${escapeHtml(titleRoute(title))}"><strong>${escapeHtml(titleLabel(title))}</strong><span>${escapeHtml(title.name)}</span><small>${title.chapters.length} chapter${title.chapters.length === 1 ? "" : "s"}</small></a></li>`).join("")}</ol>
  </main><footer>${legalFooter()}</footer>`;
  window.scrollTo({ top: 0 });
}

function renderHistory() {
  setDocumentTitle("History");
  const pages = deviceState.pageHistory();
  app.innerHTML = `${siteHeader()}<main class="history-page browse-page" id="main-content">
    <header class="section-heading"><div><p class="eyebrow">On this device</p><h1>History</h1></div>
      <button type="button" class="text-button" data-clear-page-history${pages.length ? "" : " disabled"}>Clear history</button></header>
    <p>Your last 100 visited pages, most recent first. Revisiting a page moves it to the top. Saved only in this browser.</p>
    ${pages.length ? `<ol class="page-history-list">${pages.map((item) => `<li><a href="${escapeHtml(item.href)}"><strong>${escapeHtml(item.title)}</strong><time datetime="${escapeHtml(item.viewedAt)}">${escapeHtml(new Date(item.viewedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</time></a></li>`).join("")}</ol>`
      : '<p class="empty-state" role="status">No browsing history yet. Pages you visit will appear here.</p>'}
  </main>`;
  window.scrollTo({ top: 0 });
}

// The editions the statute text reflects: the base revision the catalog records and the latest
// supplement merged over it. Act notices and currency notes judge which sessions are pending
// from the later of the two.
function statuteTextYears(catalog, supplementEdition) {
  return {
    baseRevisionYear: catalog?.source?.revisionYear ?? null,
    supplementEditionYear: supplementEdition?.editionYear ?? null
  };
}

async function loadLatestSupplement() {
  const edition = await supplementRepository.latestEdition();
  return edition ? { edition, manifest: await supplementRepository.loadEdition(edition.editionYear) } : null;
}

// The guide's code loads only on its own route, so other pages don't download it.
async function renderGuide(catalog, route, sequence) {
  const [guide, [supplementResult, actsResult]] = await Promise.all([
    import("./guide.js"),
    Promise.allSettled([loadLatestSupplement(), actsRepository.manifest()])
  ]);
  if (sequence !== renderSequence) return;
  // A source that failed to load is unknown (undefined), which the guide says, rather than absent.
  const coverage = guide.describeCoverage({
    catalog,
    supplement: supplementResult.status === "fulfilled" ? supplementResult.value : undefined,
    acts: actsResult.status === "fulfilled" ? actsResult.value : undefined
  });
  setDocumentTitle("Understanding the Statutes");
  app.innerHTML = `${siteHeader()}<main class="guide-page" id="main-content">
    ${breadcrumbs([{ label: "Home", href: "#/" }, { label: "Understanding the Statutes" }])}
    ${guide.renderGuide({ coverage })}
  </main><footer>${legalFooter()}</footer>`;
  unmountGuide = guide.mountGuide(app.querySelector(".guide-page"), { scrollTo: route.part });
  if (!route.part) window.scrollTo({ top: 0 });
}

function selectAttribute(value, selectedValue) {
  return String(value ?? "") === String(selectedValue ?? "") ? " selected" : "";
}

function searchRouteOptions(route = {}) {
  return {
    title: route.title ?? null,
    chapter: route.chapter ?? null,
    status: route.status ?? null,
    supplement: route.supplement ?? null,
    field: route.field ?? "statute",
    within: route.within ?? null,
    sort: route.sort ?? "relevance"
  };
}

function searchDescription(query, routeOptions = {}) {
  const options = normalizeSearchOptions(routeOptions);
  const parts = [explainSearchQuery(query, options)];
  if (routeOptions.title) parts.push(`Title ${routeOptions.title.replace(/^title-/u, "")}`);
  if (options.chapter) parts.push(`Chapter ${options.chapter}`);
  if (options.field !== "statute") parts.push(SEARCH_FIELD_LABELS[options.field] ?? options.field);
  if (options.status) parts.push(options.status);
  if (options.supplement) parts.push(options.supplement === "updated" ? "Supplement updated" : "Base revision only");
  if (options.sort === "citation") parts.push("Citation order");
  return parts.join(" · ");
}

function searchHistoryMarkup() {
  const searches = deviceState.searchHistory().slice(0, 8);
  if (!searches.length) return `<p class="search-history-empty">Completed searches on this device will appear here.</p>`;
  return `<ol class="search-history-list">${searches.map((item) => `<li><a href="${escapeHtml(item.href)}"><strong>${escapeHtml(item.query)}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</a></li>`).join("")}</ol>`;
}

function queryExplanationMarkup(query, routeOptions = {}) {
  if (!query) return "";
  try {
    const options = normalizeSearchOptions(routeOptions);
    const filters = [];
    if (routeOptions.title) filters.push(`Title ${routeOptions.title.replace(/^title-/u, "")}`);
    if (options.chapter) filters.push(`Chapter ${options.chapter}`);
    if (options.field !== "statute") filters.push(`${SEARCH_FIELD_LABELS[options.field] ?? options.field} field`);
    if (options.status) filters.push(`${options.status} sections`);
    if (options.supplement) filters.push(options.supplement === "updated" ? "supplement-updated sections" : "base revision only");
    return `<section class="query-explanation" aria-labelledby="query-explanation-heading"><p class="eyebrow">Query interpretation</p><h2 id="query-explanation-heading">${escapeHtml(explainSearchQuery(query, options))}</h2>${filters.length ? `<p>${filters.map((value) => escapeHtml(value)).join(" · ")}</p>` : ""}<p>Sorted by ${options.sort === "citation" ? "citation" : "relevance"}.</p></section>`;
  } catch (error) {
    return `<section class="query-explanation query-explanation-error" role="alert"><strong>Query could not be interpreted</strong><p>${escapeHtml(error.message)}</p></section>`;
  }
}

async function runStatuteSearch(query, routeOptions = {}, { limit = SEARCH_BATCH_SIZE } = {}) {
  const options = normalizeSearchOptions(routeOptions);
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
      titleIds: routeOptions.title ? [routeOptions.title] : undefined,
      chapter: options.chapter,
      status: options.status,
      supplement: options.supplement,
      field: options.field,
      within: options.within,
      sort: options.sort,
      limit,
      signal: controller.signal,
      onProgress(update) {
        if (controller !== activeSearchController) return;
        progress.max = Math.max(1, update.total);
        progress.value = update.completed;
        renderSearchResults(update.results, results, query, options);
        warning.hidden = !update.supplementUnavailable;
        status.textContent = `Searching ${update.completed} of ${update.total} statute title${update.total === 1 ? "" : "s"}… ${update.totalMatches.toLocaleString()} match${update.totalMatches === 1 ? "" : "es"} found so far.`;
      }
    });
    if (controller !== activeSearchController) return;
    const { results: matches, totalMatches, supplementUnavailable } = outcome;
    status.textContent = totalMatches
      ? `Showing ${matches.length.toLocaleString()} of ${totalMatches.toLocaleString()} result${totalMatches === 1 ? "" : "s"}`
      : "No results. Try fewer words, check the citation, or broaden the title and chapter filters.";
    warning.hidden = !supplementUnavailable;
    renderSearchResults(matches, results, query, options);
    const href = searchRouteHref(query, { ...options, title: routeOptions.title });
    deviceState.recordSearch({ query, href, description: searchDescription(query, { ...options, title: routeOptions.title }) });
    const history = document.querySelector("[data-search-history]");
    if (history) history.innerHTML = searchHistoryMarkup();
    const remaining = Math.min(SEARCH_BATCH_SIZE, totalMatches - matches.length);
    if (remaining > 0) {
      more.hidden = false;
      more.textContent = `Show ${remaining.toLocaleString()} more result${remaining === 1 ? "" : "s"}`;
      more.dataset.searchLimit = String(matches.length + remaining);
    }
  } catch (error) {
    if (error.name !== "AbortError" && controller === activeSearchController) {
      status.textContent = searchFailureMessage(error);
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
  const options = searchRouteOptions(route);
  const selectedTitle = catalog.titles.find((title) => title.id === options.title) ?? null;
  setDocumentTitle(query ? `Search: ${query}` : "Search");
  app.innerHTML = `${siteHeader()}<main class="search-page" id="main-content">
    <header><p class="eyebrow">Statutes, acts, and infractions</p><h1>Search</h1><p>Find sections by citation, phrase, or keyword. Filters apply to statutes only; matching acts and infractions are listed under “Also found in.”</p></header>
    <form class="search-refine search-v2-refine" data-search-refine>
      <div class="search-primary-controls">
        <div class="search-field search-query-field"><label for="search-page-query">Citation, phrase, or keyword</label>
          <input id="search-page-query" name="query" type="search" minlength="2" required aria-describedby="search-help" value="${escapeHtml(query)}"></div>
        <div class="search-field"><label for="search-title">Title</label>
          <select id="search-title" name="title"><option value="">All titles</option>${catalog.titles.map((title) => `<option value="${escapeHtml(title.id)}"${selectAttribute(title.id, options.title)}>${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</option>`).join("")}</select></div>
        <div class="search-field"><label for="search-chapter">Chapter</label>
          <select id="search-chapter" name="chapter"${selectedTitle ? "" : " disabled"}><option value="">All chapters</option>${selectedTitle?.chapters.map((chapter) => `<option value="${escapeHtml(chapter.number)}"${selectAttribute(chapter.number, options.chapter)}>${escapeHtml(chapterLabel(chapter))} — ${escapeHtml(chapter.name)}</option>`).join("") ?? ""}</select></div>
        <button type="submit">Search</button>
      </div>
      <details class="search-advanced"${options.field !== "statute" || options.status || options.supplement || options.sort !== "relevance" ? " open" : ""}>
        <summary>Advanced search options</summary>
        <div class="search-filter-grid">
          <div class="search-field"><label for="search-field">Search field</label><select id="search-field" name="field">${[["statute", "Statute text"], ["citation", "Citation"], ["heading", "Heading"], ["body", "Body"], ["history", "History"], ["annotations", "Annotations"], ["all", "All fields"]].map(([value, label]) => `<option value="${value}"${selectAttribute(value, options.field)}>${label}</option>`).join("")}</select></div>
          <div class="search-field"><label for="search-status-filter">Section status</label><select id="search-status-filter" name="status"><option value="">Any status</option>${["active", "mixed", "obsolete", "repealed", "reserved", "transferred"].map((value) => `<option value="${value}"${selectAttribute(value, options.status)}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}</select></div>
          <div class="search-field"><label for="search-supplement-filter">Supplement</label><select id="search-supplement-filter" name="supplement"><option value="">Base and supplement</option><option value="updated"${selectAttribute("updated", options.supplement)}>Updated by supplement</option><option value="base"${selectAttribute("base", options.supplement)}>Base revision only</option></select></div>
          <div class="search-field"><label for="search-sort">Sort</label><select id="search-sort" name="sort"><option value="relevance"${selectAttribute("relevance", options.sort)}>Relevance</option><option value="citation"${selectAttribute("citation", options.sort)}>Citation</option></select></div>
        </div>
      </details>
      <details class="search-syntax"><summary>Search tips</summary><div class="search-help" id="search-help">
        <ul>
          <li><code>landlord AND tenant</code> finds both words. Words with no operator between them are joined by AND.</li>
          <li><code>lease OR rental</code> finds either word.</li>
          <li><code>tenant NOT commercial</code> leaves out the word after NOT.</li>
          <li><code>"security deposit"</code> finds the exact phrase.</li>
          <li><code>landlord NEAR/5 tenant</code> finds words within 5 words of each other.</li>
          <li><code>regulat*</code> finds any word starting with those letters. The wildcard works only at the end of a word.</li>
          <li><code>(lease OR rental) AND deposit</code> groups terms with parentheses.</li>
        </ul>
        <p>Stemming and fuzzy matching are off, so <code>tenant</code> does not find “tenants.” Use <code>tenant*</code> to find both.</p>
      </div></details>
    </form>

    ${queryExplanationMarkup(query, options)}
    ${query ? `<details class="search-within-disclosure"${options.within ? " open" : ""}><summary>Search within these results</summary><form class="search-within" data-search-within><label for="search-within-query">Search within these results</label><div><input id="search-within-query" name="within" type="search" minlength="2" value="${escapeHtml(options.within ?? "")}" placeholder="Add another term or Boolean query"><button type="submit">Apply</button></div>${options.within ? `<a href="${escapeHtml(searchRouteHref(query, { ...options, within: null }))}">Clear within search</a>` : ""}</form></details>` : ""}
    ${query.length >= 2 ? alsoFoundMarkup(query) : ""}
    <progress id="search-progress" value="0" max="1" hidden>Search progress</progress>
    <div id="search-status" role="status" aria-live="polite">${query ? "Preparing search…" : "Enter at least two characters."}</div>
    <p class="supplement-warning" id="search-supplement-warning" role="alert" hidden>The published supplement search data could not be loaded. These results use the base revision and may be incomplete; reload while online before relying on them.</p>
    <ol id="results" class="results"></ol>
    <button type="button" class="search-more" data-search-more hidden>Show more results</button>
    <details class="search-history"><summary>Recent searches on this device</summary><div data-search-history>${searchHistoryMarkup()}</div></details>
  </main><footer>${legalFooter()}</footer>`;
  if (query.length < 2) return;
  // Acts and infractions fill in beside the statute search, which does not wait for them.
  searchOtherSources(query);
  await runStatuteSearch(query, options);
}

// Groups for acts and infractions, filled in as their data loads. Each stays
// hidden until it has a match, and a group whose data fails to load stays hidden.
function alsoFoundMarkup(query) {
  if (!plainSearchWords(query)) {
    return `<p class="also-found-note">Public and Special Acts and infractions are not searched when a query uses OR, NOT, NEAR, or parentheses.</p>`;
  }
  return `<section class="also-found" data-also-found aria-labelledby="also-found-heading" hidden>
    <h2 id="also-found-heading">Also found in</h2>
    <div class="also-found-groups">
      <section class="also-found-group" data-also-found-group="acts" aria-labelledby="also-found-acts" hidden></section>
      <section class="also-found-group" data-also-found-group="infractions" aria-labelledby="also-found-infractions" hidden></section>
    </div>
  </section>`;
}

function fillAlsoFoundGroup(section, name, heading, rows, links) {
  if (!section.isConnected || !rows.length) return;
  const group = section.querySelector(`[data-also-found-group="${name}"]`);
  group.innerHTML = `<h3 id="also-found-${name}">${escapeHtml(heading)}</h3>
    <ol>${rows.map((row) => `<li><a href="${escapeHtml(row.href)}"><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(row.subtitle)}</small></a></li>`).join("")}</ol>
    ${links.map((link) => `<a class="also-found-more" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("")}`;
  group.hidden = false;
  section.hidden = false;
}

function searchOtherSources(query) {
  const section = document.querySelector("[data-also-found]");
  const words = plainSearchWords(query);
  if (!section || !words) return;
  actsRepository.loadSearchableSessions().then((sessions) => {
    const links = actSearchLinks(sessions, words);
    fillAlsoFoundGroup(section, "acts", "Public and Special Acts", findActMatches(sessions, words), links.map(({ session, count, href }) => ({
      href,
      label: `See all ${count.toLocaleString()} matching act${count === 1 ? "" : "s"}${links.length > 1 ? ` in the ${session.name}` : ""}`
    })));
  }).catch((error) => console.warn("Could not search the acts", error));
  secondaryRepository.loadAllInfractions().then((entries) => {
    const count = matchInfractions(entries, words).length;
    fillAlsoFoundGroup(section, "infractions", "Infractions", findInfractionMatches(entries, words), [{
      href: infractionsRouteHref(null, { query: words }),
      label: `See all ${count.toLocaleString()} matching infraction${count === 1 ? "" : "s"}`
    }]);
  }).catch((error) => console.warn("Could not search the infractions", error));
}

function renderTitle(catalog, title) {
  setDocumentTitle(titleLabel(title));
  const mainContent = `<main class="browse-page application-main" id="main-content">
    ${breadcrumbs([{ label: "Titles", href: titlesRouteHref() }, { label: titleLabel(title) }])}
    <div class="browse-heading"><div><p class="eyebrow">${title.chapters.length} chapter${title.chapters.length === 1 ? "" : "s"}</p><h1>${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</h1></div><a href="${escapeHtml(title.sourceUrl)}">Official title source</a></div>
    <p class="desktop-only">Choose a chapter from the chapters column.</p>
    <div class="mobile-only">${browseFilter("chapter-filter", "Find a chapter", "browse-chapters-list")}</div>
    <ol class="chapter-list mobile-only" id="browse-chapters-list">${title.chapters.map((chapter) => `<li><a href="${escapeHtml(chapterRoute(title, chapter))}"><strong>${escapeHtml(chapterLabel(chapter))}</strong><span>${escapeHtml(chapter.name)}</span><small>${chapter.sectionCount} section${chapter.sectionCount === 1 ? "" : "s"}</small></a></li>`).join("")}</ol>
  </main>`;
  mountApplicationShell({
    ...statuteNavigation(catalog, { kind: "title" }, () => [statuteTitleColumn(catalog, title), statuteChapterColumn(title)], { title }),
    mainContent,
    mobilePresentationMode: "drilldown"
  });
}

async function sectionSecondaryContext(title, section, requestedCitation) {
  const wanted = String(requestedCitation ?? "").toLowerCase();
  const citation = section.citations.find((value) => value.toLowerCase() === wanted)
    ?? section.citation
    ?? section.citations[0];
  try {
    const context = await secondaryRepository.loadSectionContext(title.id, citation, { includeIndexEntries: false });
    context.indexKey = `${title.id}:${citation}`;
    deferredIndexLinks.set(context.indexKey, context.indexLinks);
    return context;
  } catch (error) {
    console.warn("Could not load related legal data", error);
    return { error };
  }
}

// A chapter file is the largest download on a statute page, so the router starts it as soon as
// the catalog names it, and renderChapter takes over that request rather than starting another.
// Only the latest one is kept, so a request abandoned by navigation is not held in memory.
const pendingChapterLoads = new Map();

function prefetchChapter(path) {
  if (pendingChapterLoads.has(path)) return;
  pendingChapterLoads.clear();
  const load = getJson(`./data/${path}`);
  load.catch(() => {});
  pendingChapterLoads.set(path, load);
}

function loadChapter(path) {
  const pending = pendingChapterLoads.get(path);
  pendingChapterLoads.delete(path);
  return pending ?? getJson(`./data/${path}`);
}

async function renderChapter(catalog, title, chapterMeta, route, sequence) {
  if (route.kind === "section") {
    // The section's reference links and related sources need these; fetch them with the chapter.
    repository.loadCitations(title.id).catch(() => {});
    secondaryRepository.loadSectionLinks(title.id, route.section).catch(() => {});
  }
  // The base chapter and its supplement download together; a supplement failure is reported
  // on the page below rather than replacing it.
  const basePromise = chapterMeta.supplementOnly ? Promise.resolve(null) : loadChapter(chapterMeta.path);
  const latestPromise = chapterMeta.supplementOnly
    ? supplementRepository.loadChapter(chapterMeta.supplementEditionYear, chapterMeta.number, title.id)
      .then((supplementChapter) => ({ edition: { editionYear: chapterMeta.supplementEditionYear }, chapter: supplementChapter }))
    : supplementRepository.loadLatestChapter(chapterMeta.number, title.id);
  latestPromise.catch(() => {});
  const amendmentsPromise = actsRepository.amendments()
    .then((index) => ({ index })).catch((error) => ({ error }));
  const baseChapter = await basePromise;
  if (sequence !== renderSequence) return;
  let chapter = baseChapter;
  let overlay = null;
  let supplementError = null;
  let latestEdition = null;
  try {
    const latest = await latestPromise;
    latestEdition = latest.edition;
    if (latest.chapter) {
      const applied = applyChapterOverlay(baseChapter, latest.chapter, latest.edition.editionYear);
      chapter = applied.chapter;
      overlay = applied.overlay;
    }
  } catch (error) {
    supplementError = error;
    console.warn("Could not load the published supplement", error);
  }
  if (sequence !== renderSequence) return;
  if (!chapter) return renderNotFound("That supplement chapter could not be loaded.");
  const changeBySection = new Map((overlay?.changes ?? []).map((change) => [change.sectionId, { ...change, editionYear: overlay.editionYear }]));
  const pendingBySection = new Map();
  const selected = route.kind === "section" ? findSection(chapter, route.section) : null;
  if (route.kind === "section" && !selected) return renderNotFound("That section was not found.");

  if (route.legacyQuery) {
    const canonicalRoute = selected ? provisionRoute(title, chapter, selected) : chapterRoute(title, chapter);
    history.replaceState(history.state, "", `${location.pathname}${canonicalRoute}`);
  }

  const provisions = selected ? [selected, ...(changeBySection.get(selected.id)?.previousSections ?? [])] : [];
  const maps = selected ? await referenceMaps(provisions, catalog, { resolve: false }) : null;
  const secondaryContext = null;
  if (sequence !== renderSequence) return;
  const preferences = deviceState.preferences();
  const chapterNavigation = navigationSections(chapter.sections, {
    hiddenStatuses: preferences.hiddenStatuses,
    selected
  });
  const hiddenSections = chapter.sections.length - chapterNavigation.length;
  setDocumentTitle(selected ? sectionLabel(selected) : chapterLabel(chapter), titleLabel(title));
  const sectionItems = statuteSectionItems(title, chapter, chapterNavigation, selected, changeBySection, pendingBySection);
  const mobileChapterList = `<section class="mobile-only mobile-section-browser" aria-labelledby="mobile-sections-heading"><div class="section-heading"><div><p class="eyebrow">${chapterNavigation.length} sections${hiddenSections ? ` · ${hiddenSections} hidden` : ""}</p><h2 id="mobile-sections-heading">Sections</h2></div></div>${browseFilter("section-filter", "Find a section", "browse-sections-list")}<div id="browse-sections-list">${railList(sectionItems)}</div></section>`;
  const mainContent = `<main class="reader-content application-main" id="main-content">
      ${breadcrumbs([
        { label: "Titles", href: titlesRouteHref() },
        { label: titleLabel(title), href: titleRoute(title) },
        { label: chapterLabel(chapter), href: selected ? chapterRoute(title, chapter) : null },
        ...(selected ? [{ label: sectionLabel(selected) }] : [])
      ])}
      ${supplementError ? `<p class="supplement-warning" role="alert">The published supplement could not be loaded. This page is showing the base revision only; reload before relying on it.</p>` : ""}
      <p class="source-note">Text: ${escapeHtml(String(catalog.source?.revisionYear ?? "Published"))} revision${latestEdition && !supplementError ? ` with the ${latestEdition.editionYear} Supplement` : ""}. Captured ${escapeHtml(formatSnapshotDate(catalog.source?.retrievedAt ?? catalog.generatedAt) ?? "date unavailable")}.</p>
      <div class="chapter-research-tools"><a href="${escapeHtml(searchRouteHref("", { title: title.id, chapter: chapter.number }))}">Search this chapter</a>${selected ? `<span class="mobile-reader-tools"><button type="button" data-open-chapter-sheet aria-haspopup="dialog">Browse chapter</button></span>` : ""}${selected ? sectionNavigation(title, chapter, chapterNavigation, selected).replace('aria-label="Adjacent sections"', 'aria-label="Section shortcuts"') : ""}</div>
      ${selected ? `${renderProvision(title, chapter, selected, maps, secondaryContext, changeBySection.get(selected.id), pendingBySection.get(selected.id))}${sectionNavigation(title, chapter, chapterNavigation, selected)}${chapterSheet(title, chapter, chapterNavigation, selected, changeBySection, pendingBySection)}` : `<div class="chapter-overview"><p class="eyebrow">${chapterNavigation.length} sections${hiddenSections ? ` · ${hiddenSections} hidden` : ""}</p><h1>${escapeHtml(chapterLabel(chapter))} — ${escapeHtml(chapter.name)}</h1>${chapterSupplementSummary(title, chapter, overlay, changeBySection)}<div data-amendments-status><p class="visually-hidden" role="status">Amendment information loading…</p></div><p class="desktop-only">Choose a section from the sections column.</p><a href="${escapeHtml(chapter.sourceUrl)}">Official chapter source</a></div>${mobileChapterList}`}
    </main>`;
  mountApplicationShell({
    ...statuteNavigation(catalog, route, () => [
      statuteTitleColumn(catalog, title),
      statuteChapterColumn(title, chapter),
      statuteSectionColumn(title, chapter, chapterNavigation, selected, changeBySection, pendingBySection)
    ], {
      title,
      chapter,
      sectionHref: selected ? provisionRoute(title, chapter, selected) : null,
      sectionItems: () => statuteSectionItems(title, chapter, chapterNavigation, selected, changeBySection, pendingBySection)
    }),
    mainContent,
    mobilePresentationMode: selected ? "reader" : "drilldown"
  });
  bindChapterSheet();
  // Enrich the mounted reader without replacing its text, focus, or open disclosures.
  amendmentsPromise.then(({ index, error }) => {
    if (sequence !== renderSequence) return;
    const slot = app.querySelector("[data-amendments-status]");
    if (error || supplementError) {
      slot.innerHTML = '<p class="supplement-warning" role="status">Amendment information is unavailable. Check the official acts before relying on this text.</p>';
      return;
    }
    for (const section of chapter.sections) {
      const amendments = amendmentsForSection(index, section, statuteTextYears(catalog, latestEdition));
      if (amendments.length) pendingBySection.set(section.id, amendments);
    }
    slot.innerHTML = (selected ? renderPendingAmendments(pendingBySection.get(selected.id)) : pendingChapterSummary(title, chapter, changeBySection, pendingBySection)) || "";
    for (const marker of app.querySelectorAll("[data-act-notice-for]")) {
      marker.innerHTML = pendingActPill(pendingBySection.get(marker.dataset.actNoticeFor));
    }
    statuteTree.revealCurrent();
  });
  if (selected) {
    referenceMaps(provisions, catalog).then((resolved) => {
      if (sequence !== renderSequence) return;
      for (const link of app.querySelectorAll(".provision a.legal-reference")) {
        const key = link.textContent.toLowerCase();
        const href = resolved.sections.get(key) ?? resolved.chapters.get(key);
        if (href) link.setAttribute("href", href);
      }
    }).catch((error) => console.warn("Could not enrich references", error));
    sectionSecondaryContext(title, selected, route.section).then((context) => {
      if (sequence !== renderSequence) return;
      app.querySelector("[data-secondary-references]").innerHTML = renderSecondaryContext(context);
    });

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
      target.classList.add("subsection-target");
      target.tabIndex = -1;
      // Start, not center: a long subsection would otherwise open with its first lines hidden.
      target.scrollIntoView({ block: "start" });
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
    aria-pressed="${saved}">${bookmarkButtonLabel(saved)}</button>`;
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

function renderInfractionListItem(entry, { showCategory = false } = {}) {
  const href = infractionsRouteHref(entry.category, { entry: entry.id });
  const total = entry.amounts?.total_due;
  return `<li class="infraction-card">
    <a href="${escapeHtml(href)}"><span class="infraction-citation">Sec. ${escapeHtml(entry.citation)}${showCategory ? ` · ${escapeHtml(entry.category)}` : ""}</span><strong>${escapeHtml(entry.description)}</strong>${total != null ? `<small>Total due ${escapeHtml(formatMoney(total))}</small>` : ""}</a>
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

async function renderInfractions(route, sequence) {
  const [manifests, entries] = await Promise.all([
    secondaryRepository.init(),
    secondaryRepository.loadAllInfractions()
  ]);
  if (sequence !== renderSequence) return;
  const groups = groupInfractions(entries);
  const selectedGroup = route.category ? groups.find(([category]) => category === route.category) : null;
  if (route.category && !selectedGroup) return renderNotFound("That infraction category was not found.");
  const selectedEntry = route.entry ? selectedGroup[1].find((entry) => entry.id === route.entry) : null;
  if (route.entry && !selectedEntry) return renderNotFound("That infraction entry was not found.");
  const query = route.query?.trim() ?? "";
  // Without a category, a query searches every category.
  const searchingAll = !selectedGroup && Boolean(query);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = selectedGroup ? selectedGroup[1].filter((entry) => {
    const text = `${entry.citation} ${entry.description}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  }) : searchingAll ? matchInfractions(entries, query) : [];
  const shown = filtered.slice(0, 150);
  const categoryItems = groups.map(([category, values]) => `<li><a href="${escapeHtml(infractionsRouteHref(category))}"${selectedGroup?.[0] === category ? ` aria-current="page"` : ""}><strong>${escapeHtml(category)}</strong><span>${values.length.toLocaleString()} entries</span></a></li>`);
  const entryItems = shown.map((entry) => `<li><a href="${escapeHtml(infractionsRouteHref(entry.category, { entry: entry.id }))}"${selectedEntry?.id === entry.id ? ` aria-current="page"` : ""}><strong>Sec. ${escapeHtml(entry.citation)}</strong><span>${escapeHtml(entry.description)}</span></a></li>`);
  setDocumentTitle(selectedEntry ? `Sec. ${selectedEntry.citation}` : selectedGroup?.[0] ?? "Infractions");
  const searchForm = (label, placeholder) => `<form class="infraction-search" data-infraction-search>
        <label for="infraction-query">${label}</label>
        <input id="infraction-query" name="query" type="search" value="${escapeHtml(route.query ?? "")}" placeholder="${placeholder}">
        <button type="submit">Search</button>
      </form>`;
  const matchCount = (suffix = "") => `<p class="note">${filtered.length.toLocaleString()} matching entr${filtered.length === 1 ? "y" : "ies"}${filtered.length > shown.length ? `; showing the first ${shown.length}` : ""}.${suffix}</p>`;
  const mainBody = selectedEntry ? renderInfractionDetail(selectedEntry, manifests.infractions.source) : selectedGroup ? `<header class="section-heading"><div><p class="eyebrow">Judicial Branch schedule</p><h1>${escapeHtml(selectedGroup[0])}</h1></div><p>${selectedGroup[1].length.toLocaleString()} entries</p></header>
      ${searchForm("Search this category", "Citation or description")}
      ${matchCount(query ? ` <a href="${escapeHtml(infractionsRouteHref(null, { query }))}">Search all categories</a>` : "")}
      <section class="desktop-only rail-prompt"><p>Select an entry from the adjacent column.</p></section>
      <ol class="infraction-list mobile-only">${shown.map((entry) => renderInfractionListItem(entry)).join("")}</ol>` : `<header class="index-intro"><p class="eyebrow">State of Connecticut Judicial Branch</p><h1>Infractions and violations</h1><p>Browse the official mail-in schedule by category, or search every category, then open an entry for amounts and its linked statute.</p><p class="source-note">Effective ${escapeHtml(manifests.infractions.source.effective ?? "date not stated")} · ${entries.length.toLocaleString()} entries · <a href="${escapeHtml(manifests.infractions.source.url)}">Official schedule (PDF)</a></p></header>
      ${searchForm("Search all categories", "Citation, description, or category")}
      ${searchingAll ? `${matchCount(` <a href="#/infractions">Clear search</a>`)}
      <ol class="infraction-list">${shown.map((entry) => renderInfractionListItem(entry, { showCategory: true })).join("")}</ol>`
    : `<ol class="infraction-categories mobile-only">${groups.map(([category, values]) => `<li><a href="${escapeHtml(infractionsRouteHref(category))}"><span>${values.length.toLocaleString()} entries</span><strong>${escapeHtml(category)}</strong></a></li>`).join("")}</ol>`}`;
  const mainContent = `<main class="infractions-page application-main" id="main-content">
    ${breadcrumbs([{ label: "Infractions", ...(selectedGroup ? { href: "#/infractions" } : {}) }, ...(selectedGroup ? [{ label: selectedGroup[0], ...(selectedEntry ? { href: infractionsRouteHref(selectedGroup[0]) } : {}) }] : []), ...(selectedEntry ? [{ label: `Sec. ${selectedEntry.citation}` }] : [])])}
    ${mainBody}
  </main>`;
  const contextualNavigation = [{
    label: "Infraction categories",
    className: "infraction-categories-column",
    heading: `<p class="eyebrow">Infractions</p><strong>Categories</strong>${browseFilter("rail-category-filter", "Filter categories", "rail-infraction-categories", "Category name")}`,
    content: `<div id="rail-infraction-categories">${railList(categoryItems)}</div>`
  }];
  if (selectedGroup) contextualNavigation.push({
    label: `${selectedGroup[0]} infractions`,
    className: "infraction-entries-column",
    heading: `<p class="eyebrow">${escapeHtml(selectedGroup[0])}</p><strong>Entries</strong>`,
    content: railList(entryItems, { empty: "No entries match this search." })
  });
  const infractionsAsTree = deviceState.preferences().navigationTree;
  mountApplicationShell({
    contextualNavigation: infractionsAsTree ? [infractionTree.column({
      groups: groups.map(([category, values]) => ({ key: category, label: category, description: `${values.length.toLocaleString()} entries`, href: infractionsRouteHref(category) })),
      groupKey: selectedGroup?.[0] ?? null,
      itemHref: selectedEntry ? infractionsRouteHref(selectedEntry.category, { entry: selectedEntry.id }) : null,
      items: groups.map(([category, values]) => [category, values.map(infractionTreeItem)])
    })] : contextualNavigation,
    mainContent,
    columnCount: infractionsAsTree ? 1 : contextualColumnCount("infractions", route),
    mobilePresentationMode: selectedEntry ? "detail" : "drilldown",
    footer: legalFooter()
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

async function renderActs(route, sequence) {
  const options = normalizeActsOptions(route);
  const [{ manifest, entry, acts }, supplementEdition, catalog] = await Promise.all([
    actsRepository.loadSession(options.session),
    supplementRepository.latestEdition().catch(() => null),
    loadCatalog().catch(() => null)
  ]);
  if (sequence !== renderSequence) return;
  if (options.session && !entry) return renderNotFound("That legislative session is not in the acts list.");
  setDocumentTitle("Public and Special Acts");
  const officialList = `<a href="${escapeHtml(manifest.source.url)}" target="_blank" rel="noopener">Official list <span aria-hidden="true">↗</span></a>`;
  if (!entry) {
    app.innerHTML = `${siteHeader()}<main class="acts-page browse-page" id="main-content">
      <header class="index-intro"><p class="eyebrow">${escapeHtml(manifest.source.publisher)}</p><h1>Public and Special Acts</h1></header>
      <p class="empty-state" role="status">No acts have been published yet. ${officialList}</p>
    </main>`;
    return;
  }
  const effectiveView = options.view === "effective";
  // The word index is only needed to search the act text, and the
  // effective-date index only for the effective-date view.
  const [searchIndex, effectiveIndex] = await Promise.all([
    options.query ? actsRepository.loadSearchIndex(entry).catch(() => null) : null,
    effectiveView ? actsRepository.loadEffectiveIndex(entry).catch(() => null) : null
  ]);
  if (sequence !== renderSequence) return;
  const textMatches = matchActText(searchIndex, options.query);
  const shown = filterActs(acts, effectiveView ? { ...options, type: "public" } : options, textMatches);
  const textSearchNote = options.query && entry.search && !searchIndex ? " Act text could not be searched." : "";
  const sessionField = manifest.sessions.length > 1
    ? `<div class="search-field"><label for="acts-session">Session</label><select id="acts-session" name="session">${manifest.sessions.map((session) => `<option value="${escapeHtml(session.id)}"${selectAttribute(session.id, entry.id)}>${escapeHtml(session.name)}</option>`).join("")}</select></div>`
    : "";
  const viewLinks = Object.entries(ACT_VIEWS).map(([view, label]) =>
    `<a href="${escapeHtml(actsRouteHref({ session: options.session, query: options.query, view }))}"${view === options.view ? ` aria-current="page"` : ""}>${label}</a>`).join("");
  const clearFilters = (filtered) => filtered ? ` <a href="${escapeHtml(actsRouteHref({ session: options.session, view: options.view, ...(effectiveView ? { sort: options.sort, order: options.order } : {}) }))}">Clear filters</a>` : "";
  let filterFields;
  let results;
  if (effectiveView) {
    const allRows = effectiveRows(acts.filter((act) => act.type === "public"), effectiveIndex);
    const rows = effectiveRows(shown, effectiveIndex, options).filter((row) => !options.on || row.date?.startsWith(options.on));
    const sortHref = (sort, order) => actsRouteHref({ session: options.session, query: options.query, view: "effective", on: options.on, sort, order });
    filterFields = `<input type="hidden" name="view" value="effective"><input type="hidden" name="sort" value="${options.sort}"><input type="hidden" name="order" value="${options.order}">
        <div class="search-field"><label for="acts-on">Effective</label><select id="acts-on" name="on"><option value="">All dates</option>${effectiveDateOptions(allRows).map(([value, label]) => `<option value="${value}"${selectAttribute(value, options.on)}>${escapeHtml(label)}</option>`).join("")}</select></div>`;
    const publicActs = entry.counts.publicActs.toLocaleString();
    const status = rows.length === allRows.length
      ? `Showing all ${allRows.length.toLocaleString()} effective dates in ${publicActs} Public Acts.`
      : `Showing ${rows.length.toLocaleString()} of ${allRows.length.toLocaleString()} effective dates in ${publicActs} Public Acts.`;
    results = !effectiveIndex
      ? `<p class="empty-state" role="status">${entry.effective ? "Effective dates could not be loaded." : "Effective dates are not available for this session."}</p>`
      : `<p class="note" role="status">${status}${escapeHtml(textSearchNote)}${clearFilters(options.query || options.on)}</p>
    ${rows.length ? renderEffectiveTable(rows, `${entry.name} Public Acts by effective date`, { session: entry.id, sort: options.sort, order: options.order, sortHref }) : `<p class="empty-state">No effective dates match these filters.</p>`}`;
  } else {
    filterFields = `<div class="search-field"><label for="acts-type">Type</label><select id="acts-type" name="type"><option value="">All acts</option>${Object.entries(ACT_TYPES).map(([value, label]) => `<option value="${value}"${selectAttribute(value, options.type)}>${label}</option>`).join("")}</select></div>
        <div class="search-field"><label for="acts-sort">Sort</label><select id="acts-sort" name="sort">${Object.entries(ACT_SORTS).map(([value, label]) => `<option value="${value}"${selectAttribute(value, options.sort)}>${label}</option>`).join("")}</select></div>`;
    results = `<p class="note" role="status">${shown.length === acts.length ? `Showing all ${acts.length.toLocaleString()} acts.` : `Showing ${shown.length.toLocaleString()} of ${acts.length.toLocaleString()} acts.`}${escapeHtml(textSearchNote)}${clearFilters(options.query || options.type)}</p>
    ${shown.length ? renderActsTable(shown, `${entry.name} acts`, { session: entry.id, query: options.query, textMatches }) : `<p class="empty-state">No acts match these filters.</p>`}`;
  }
  // Sorting or filtering the list on screen keeps the reader's place, and
  // focus on the control they used: a sort heading or a filter field or button.
  const refining = app.querySelector("[data-acts-view]")?.dataset.actsView === options.view;
  const focused = document.activeElement;
  const refocus = focused?.dataset?.sortColumn ? `[data-sort-column="${focused.dataset.sortColumn}"]`
    : focused?.closest?.("[data-acts-filter]") ? (focused.id ? `#${focused.id}` : "[data-acts-filter] button[type=submit]")
    : null;
  const scrollTop = window.scrollY;
  app.innerHTML = `${siteHeader()}<main class="acts-page browse-page" id="main-content" data-acts-view="${options.view}">
    <header class="index-intro">
      <p class="eyebrow">${escapeHtml(manifest.source.publisher)}</p>
      <h1>Public and Special Acts</h1>
      <p>${escapeHtml(actsCurrencyNote(entry, statuteTextYears(catalog, supplementEdition)))}</p>
      <p class="source-note">${escapeHtml(entry.name)} · ${escapeHtml(actsCountLabel(entry.counts))} · Updated ${escapeHtml(formatSnapshotDate(entry.updatedAt))} · ${officialList}</p>
    </header>
    <aside class="acts-guidance" aria-label="Reading these acts">
      <p><strong>Public Acts</strong> change the General Statutes. Until revised statute text is published, read an act together with the sections it amends, and check the effective date of each section.</p>
      <p><strong>Special Acts</strong> apply to particular people, places, or programs and are not added to the General Statutes.</p>
      <p><a href="${guideRouteHref("public-acts")}">How Public Acts become statute text</a></p>
      ${effectiveView
        ? `<p>Each row lists the sections of a Public Act that take effect on one date. Select the sections to read only that text. Sections effective from passage are listed under the date the act was approved. Select a column heading to sort by it.</p>`
        : entry.counts.textActs ? `<p>Select an act to read its text here. Search matches words in each act's title and text.</p>` : ""}
    </aside>
    <nav class="acts-views" aria-label="Acts view">${viewLinks}</nav>
    <form class="search-refine search-v2-refine acts-filter${sessionField ? " acts-filter-sessions" : ""}${effectiveView ? " acts-filter-effective" : ""}" data-acts-filter role="search" aria-label="Filter acts">
      <div class="search-primary-controls">
        <div class="search-field"><label for="acts-query">Search ${effectiveView ? "Public Acts" : "acts"}</label><input id="acts-query" name="query" type="search" value="${escapeHtml(options.query ?? "")}" placeholder="${entry.counts.textActs ? "Words, act, or bill number" : "Title, act, or bill number"}" autocomplete="off"></div>
        ${sessionField}
        ${filterFields}
        <button type="submit">Apply</button>
      </div>
    </form>
    ${results}
  </main><footer>${legalFooter()}</footer>`;
  if (!refining) {
    window.scrollTo({ top: 0 });
    return;
  }
  window.scrollTo({ top: scrollTop });
  if (refocus) app.querySelector(refocus)?.focus({ preventScroll: true });
}

// Acts cite many titles; rather than load every cited title to resolve its
// sections up front, link citations to a search and resolve them on click.
function actReferenceMaps(catalog) {
  return {
    sections: { get: (citation) => findTitle(catalog, citation.split("-")[0]) ? searchRouteHref(citation) : undefined },
    chapters: {
      get: (number) => {
        const match = findChapter(catalog, number);
        return match ? chapterRoute(match.title, match.chapter) : undefined;
      }
    }
  };
}

async function statuteCitationHref(catalog, citation) {
  const title = findTitle(catalog, citation.split("-")[0]);
  if (!title) return null;
  const route = (await repository.loadCitations(title.id))[citation];
  return route ? routeHref({ title: title.number, chapter: route[0], section: route[1] }) : null;
}

function highlightActText(root, pattern) {
  if (!pattern) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  for (const node of nodes) {
    const text = node.nodeValue;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      fragment.append(text.slice(cursor, match.index));
      const mark = document.createElement("mark");
      mark.textContent = match[0];
      fragment.append(mark);
      cursor = match.index + match[0].length;
    }
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
    count += matches.length;
  }
  return count;
}

function showActTarget(route) {
  const target = route.section ? document.getElementById(`sec-${route.section}`) : document.querySelector("[data-act-text] mark");
  if (!target) {
    window.scrollTo({ top: 0 });
    return;
  }
  // Jump straight there; a smooth scroll through a long act is slow.
  target.scrollIntoView({ block: route.section ? "start" : "center", behavior: "instant" });
  if (route.section) target.focus({ preventScroll: true });
}

async function renderAct(catalog, route, sequence) {
  const [{ manifest, entry, acts }, supplementEdition] = await Promise.all([
    actsRepository.loadSession(route.session),
    supplementRepository.latestEdition().catch(() => null)
  ]);
  if (sequence !== renderSequence) return;
  const act = entry ? acts.find((value) => value.id === route.act) : null;
  if (!act) return renderNotFound("That act is not in the acts list.");
  // Moving between sections of the act already on screen only scrolls.
  const sections = parseSectionsParameter(route.sections);
  const shown = app.querySelector("[data-act-page]");
  if (shown?.dataset.actPage === act.id && shown.dataset.actQuery === (route.query ?? "") && shown.dataset.actSections === (sections ? route.sections : "")) return showActTarget(route);

  setDocumentTitle(act.citation, "Public and Special Acts");
  const listHref = actsRouteHref({ session: entry.id === manifest.sessions[0]?.id ? null : entry.id });
  const officialLinks = `<a href="${escapeHtml(act.url)}" target="_blank" rel="noopener">Official PDF <span aria-hidden="true">↗</span></a> · <a href="${escapeHtml(act.billUrl)}" target="_blank" rel="noopener">${escapeHtml(act.bill)} bill status <span aria-hidden="true">↗</span></a>`;
  const currency = act.type === "special"
    ? "Special Acts apply to particular people, places, or programs and are not added to the General Statutes."
    : actsCurrencyNote(entry, statuteTextYears(catalog, supplementEdition));
  const page = (body) => `${siteHeader()}<main class="acts-page act-page browse-page" id="main-content" data-act-page="${escapeHtml(act.id)}" data-act-query="${escapeHtml(route.query ?? "")}" data-act-sections="${escapeHtml(sections ? route.sections : "")}">
    ${breadcrumbs([{ label: "Public and Special Acts", href: listHref }, { label: act.citation }])}
    <header class="index-intro act-header">
      <p class="eyebrow">${escapeHtml(entry.name)}</p>
      <h1>${escapeHtml(act.citation)}</h1>
      <p class="act-heading-title">${escapeHtml(act.title)}</p>
      <p class="source-note">${officialLinks}</p>
    </header>
    <p class="act-currency">${escapeHtml(currency)}</p>
    ${body}
  </main><footer>${legalFooter()}</footer>`;

  let text = null;
  if (act.text) {
    try {
      text = await actsRepository.loadActText(act);
    } catch (error) {
      console.warn("Could not load the act text", error);
    }
    if (sequence !== renderSequence) return;
  }
  if (!text) {
    app.innerHTML = page(`<p class="empty-state" role="status">${act.text ? "The text of this act could not be loaded." : "The text of this act is not available in the app."} Read the <a href="${escapeHtml(act.url)}" target="_blank" rel="noopener">official PDF <span aria-hidden="true">↗</span></a>.</p>`);
    window.scrollTo({ top: 0 });
    return;
  }

  const details = [text.front.notice, text.front.bill, text.approved, `${text.source.pages.toLocaleString()} page${text.source.pages === 1 ? "" : "s"}`].filter(Boolean);
  const pattern = actTextPattern(route.query);
  const selected = sections ? text.sections.filter((section) => sections.has(section.number)) : [];
  const shownSections = selected.length ? sections : null;
  const selectedDates = new Set(selected.map((section) => section.effective ?? "No effective date stated"));
  const selection = selected.length
    ? `<p class="note act-selection" role="status">Showing ${escapeHtml(sectionsSummary(selected.map((section) => section.number), text.sections.length))}${selectedDates.size === 1 ? ` · ${escapeHtml([...selectedDates][0])}` : ""}. <a href="${escapeHtml(actRouteHref(entry.id, act, { query: route.query }))}">Show the whole act</a></p>`
    : "";
  app.innerHTML = page(`
    <p class="act-details">${details.map(escapeHtml).join(" · ")}</p>
    <aside class="acts-guidance act-legend" aria-label="How this text marks changes">
      <p>Language the act adds is <ins class="revision-addition">highlighted in green</ins>. Language it deletes is <del class="revision-deletion">struck through in red</del>; the PDF shows these as underlined and [bracketed] text.</p>
      <p>This text was extracted from the PDF. Tables may be laid out differently than in the PDF.</p>
    </aside>
    ${selection}
    ${renderActSections(text, (section) => actRouteHref(entry.id, act, { section: section.number, sections: shownSections ? route.sections : null, query: route.query }), { sections: shownSections })}
    ${pattern ? `<p class="note" role="status" data-act-highlight-status></p>` : ""}
    ${renderActDocument(text, actReferenceMaps(catalog), { sections: shownSections })}`);
  const body = app.querySelector("[data-act-text]");
  if (pattern) {
    const count = highlightActText(body, pattern);
    app.querySelector("[data-act-highlight-status]").innerHTML = `${count ? `${count.toLocaleString()} match${count === 1 ? "" : "es"} for “${escapeHtml(route.query)}” highlighted.` : `No matches for “${escapeHtml(route.query)}” in this act.`} <a href="${escapeHtml(actRouteHref(entry.id, act))}">Clear highlighting</a>`;
  }
  body.addEventListener("click", async (event) => {
    const link = event.target.closest('a.legal-reference[href^="#/search?"]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const citation = link.textContent.trim().toLowerCase();
    const href = await statuteCitationHref(catalog, citation).catch(() => null);
    location.hash = href ?? link.getAttribute("href");
  });
  showActTarget(route);
}

function renderBookmarks() {
  setDocumentTitle("Bookmarks");
  app.innerHTML = renderBookmarkPage(deviceState, siteHeader());
}

async function renderStatutesIndex(route, sequence) {
  const manifests = await secondaryRepository.init();
  if (sequence !== renderSequence) return;
  const letterCounts = aggregateShardCounts(manifests.index.shards);
  const available = [...letterCounts.keys()].filter((key) => /^[a-z]$/.test(key));
  const letter = route.letter;
  if (letter && !available.includes(letter)) return renderNotFound("That index letter was not found.");
  const topics = letter ? await secondaryRepository.loadIndexLetter(letter) : [];
  if (sequence !== renderSequence) return;
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
      <p>Browse official subject headings and open linked statute sections. ${escapeHtml(source.revision)}.</p>
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
      <p>Browse this subject heading and open linked statute sections.</p>
      <p class="source-note"><a href="${escapeHtml(indexRouteHref(letter))}">Back to ${escapeHtml(letter.toUpperCase())} headings</a> &middot; <a href="${escapeHtml(source.url)}">Official index volumes</a> &middot; ${escapeHtml(source.revision)}</p>
    </header><section class="index-browser" aria-live="polite">${renderSelectedIndexTopic(selected, topicGroups, matchingEntry, route.query ?? "")}</section>`
    : !letter ? `${indexIntro}<section class="mobile-only mobile-index-browser"><h2>Choose a letter</h2>${railList(letterItems, { className: "mobile-index-list" })}</section>`
      : `${search ? `<section class="index-browser" aria-live="polite">${renderIndexSearchResults(search)}</section>` : `<section class="desktop-only rail-prompt"><p class="eyebrow">${escapeHtml(letter.toUpperCase())} index</p><h1>Choose a heading</h1><p>Select a subject heading from the adjacent column.</p></section><section class="mobile-only mobile-index-browser"><div class="section-heading"><div><p class="eyebrow">General Statutes index</p><h1>${escapeHtml(letter.toUpperCase())} headings</h1></div><p>${topics.length.toLocaleString()} heading${topics.length === 1 ? "" : "s"}</p></div>${railList(headingItems, { className: "mobile-index-list" })}</section>`}`;
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
  const indexAsTree = deviceState.preferences().navigationTree;
  mountApplicationShell({
    contextualNavigation: indexAsTree ? [indexTree.column({
      groups: available.map((key) => ({ key, label: key.toUpperCase(), description: `${(letterCounts.get(key) ?? 0).toLocaleString()} headings`, href: indexRouteHref(key) })),
      groupKey: letter ?? null,
      itemHref: selected ? indexRouteHref(letter, { topic: selected.id }) : null,
      items: letter ? [[letter, indexTreeItems(letter, topics)]] : []
    })] : contextualNavigation,
    mainContent,
    columnCount: indexAsTree ? 1 : contextualColumnCount("index", route),
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

async function titleWithLatestSupplementChapters(title) {
  try {
    const latest = await supplementRepository.loadLatestTitle(title.id);
    return mergeSupplementTitleChapters(title, latest.title, latest.edition?.editionYear);
  } catch (error) {
    console.warn("Could not load supplement chapter navigation", error);
    return title;
  }
}

function announceRoute() {
  let announcer = document.querySelector("[data-route-announcer]");
  if (!announcer) {
    announcer = document.createElement("div");
    announcer.className = "visually-hidden";
    announcer.dataset.routeAnnouncer = "";
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("aria-atomic", "true");
    document.body.append(announcer);
  }
  announcer.textContent = "";
  requestAnimationFrame(() => { announcer.textContent = document.title; });
}

// Re-rendering replaces the element that had focus. A link chosen in a
// navigation pane keeps focus in that pane so the next item is one key away;
// otherwise focus moves to the new page's heading, which screen readers announce.
function restoreRouteFocus(priorFocus) {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const pane = priorFocus?.closest?.(".context-column[data-context-key]");
  const href = priorFocus?.getAttribute?.("href");
  if (pane && href) {
    const match = [...document.querySelectorAll(".context-column[data-context-key] a[href]")]
      .find((link) => link.getAttribute("href") === href && link.closest(".context-column").dataset.contextKey === pane.dataset.contextKey);
    if (match) {
      match.focus({ preventScroll: true });
      announceRoute();
      return;
    }
  }
  const heading = app.querySelector("main h1");
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

async function renderCurrentRoute() {
  const priorFocus = document.activeElement;
  const initialRender = !hasRendered;
  hasRendered = true;
  navigationHistory.sync();
  closeOmni();
  unmountGuide?.();
  unmountGuide = null;
  activeSearchController?.abort();
  activeSearchController = null;
  const sequence = ++renderSequence;
  try {
    const route = parseRoute(location);
    // Statute pages need the supplement manifests as well as the catalog; fetch them together.
    if (["title", "chapter", "section"].includes(route.kind)) {
      supplementRepository.latestEdition()
        .then((edition) => edition && supplementRepository.loadEdition(edition.editionYear))
        .catch(() => {});
    }
    const catalog = await loadCatalog();
    if (sequence !== renderSequence) return;
    if (route.kind === "home") return await renderHome(catalog);
    if (route.kind === "titles") return renderTitles(catalog);
    if (route.kind === "not-found") return renderNotFound();
    if (route.kind === "search") return await renderSearchPage(catalog, route);
    if (route.kind === "infractions") return await renderInfractions(route, sequence);
    if (route.kind === "acts") return await renderActs(route, sequence);
    if (route.kind === "act") return await renderAct(catalog, route, sequence);
    if (route.kind === "bookmarks") return renderBookmarks();
    if (route.kind === "history") return renderHistory();
    if (route.kind === "about") return await renderAbout(catalog, route, sequence);
    if (route.kind === "guide") return await renderGuide(catalog, route, sequence);
    if (route.kind === "index") return await renderStatutesIndex(route, sequence);

    let title = route.title ? findTitle(catalog, route.title) : null;
    const baseMatch = route.chapter ? findChapter(catalog, route.chapter, title) : null;
    if (baseMatch && !baseMatch.chapter.supplementOnly) prefetchChapter(baseMatch.chapter.path);
    if (title) title = await titleWithLatestSupplementChapters(title);
    if (sequence !== renderSequence) return;
    let chapterMatch = route.chapter ? findChapter(catalog, route.chapter, title) : null;
    if (!title && chapterMatch) title = chapterMatch.title;
    if (!title) return renderNotFound("That title was not found.");
    if (route.kind === "title") return renderTitle(catalog, title);
    if (!chapterMatch) chapterMatch = findChapter(catalog, route.chapter, title);
    if (!chapterMatch) return renderNotFound("That chapter was not found.");
    return await renderChapter(catalog, title, chapterMatch.chapter, route, sequence);
  } catch (error) {
    if (sequence !== renderSequence) return;
    setDocumentTitle("Could not load");
    app.innerHTML = `${siteHeader()}${loadFailurePage(error)}`;
  } finally {
    if (sequence === renderSequence) {
      const href = location.hash || "#/";
      if (parseRoute(location).kind !== "history" && !app.querySelector("main.error") && href !== lastRecordedPage) {
        deviceState.recordPage({ href, title: document.title.replace(/ · Connecticut General Statutes$/, "") });
      }
      lastRecordedPage = href;
      if (!initialRender) restoreRouteFocus(priorFocus);
    }
  }
}

function resizeContextPane(handle, width, { save = false } = {}) {
  const shell = handle.closest(".application-shell");
  if (!shell || matchMedia("(max-width: 60rem)").matches) return;
  const index = Number(handle.dataset.resizePane);
  const resized = handle.previousElementSibling;
  const panes = [...shell.querySelectorAll(".context-column:not([hidden])")];
  const otherWidths = panes.reduce((total, pane) => total + (pane === resized ? 0 : pane.getBoundingClientRect().width), 0);
  const maxWidth = Math.max(CONTEXT_PANE_MIN, Math.min(420, shell.clientWidth - otherWidths - panes.length * CONTEXT_RESIZER - readingColumnMinimum()));
  const nextWidth = Math.round(Math.max(CONTEXT_PANE_MIN, Math.min(maxWidth, width)));
  shell.style.setProperty(`--context-width-${index + 1}`, `${nextWidth}px`);
  shell.style.setProperty("--context-total-width", `${otherWidths + nextWidth + panes.length * CONTEXT_RESIZER}px`);
  const intended = shell.dataset.contextWidths.split(",");
  intended[index] = String(nextWidth);
  shell.dataset.contextWidths = intended.join(",");
  handle.setAttribute("aria-valuenow", String(nextWidth));
  if (save) {
    if (resized.matches(".statute-tree-column")) {
      deviceState.updateNavigationLayout({ treeWidth: nextWidth });
    } else {
      const widths = deviceState.navigationLayout().widths;
      widths[index] = nextWidth;
      deviceState.updateNavigationLayout({ widths });
    }
  }
}

async function clearDeviceData(action, button) {
  if (action === "bookmarks") {
    deviceState.clearBookmarks();
    document.querySelectorAll(".nav-badge").forEach((badge) => {
      badge.textContent = "0";
      badge.setAttribute("aria-label", "0 saved bookmarks");
    });
    if (parseRoute(location).kind === "bookmarks") renderBookmarks();
    else {
      button.disabled = true;
      button.querySelector("small").textContent = "None saved";
    }
  } else if (action === "recents") {
    deviceState.clearRecents();
    if (parseRoute(location).kind === "home") renderHome(await loadCatalog());
    else {
      button.disabled = true;
      button.querySelector("small")?.replaceChildren("No recent history");
    }
  } else if (action === "search-history") {
    deviceState.clearSearchHistory();
    if (parseRoute(location).kind === "search") {
      const history = document.querySelector("[data-search-history]");
      if (history) history.innerHTML = searchHistoryMarkup();
    }
    button.disabled = true;
    button.querySelector("small")?.replaceChildren("No search history");
  }
}

// Headings take focus on route changes for screen readers. Only someone tabbing through the
// page needs to see that as a focus ring (styles.css).
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") document.documentElement.toggleAttribute("data-keyboard-navigation", true);
}, true);
document.addEventListener("pointerdown", () => {
  document.documentElement.toggleAttribute("data-keyboard-navigation", false);
}, true);

function selectRevisionView(tab) {
  for (const other of tab.parentElement.querySelectorAll("[data-revision-view]")) {
    const selected = other === tab;
    other.setAttribute("aria-selected", String(selected));
    other.tabIndex = selected ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
  }
}
document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-revision-view]");
  if (tab) selectRevisionView(tab);
});
document.addEventListener("keydown", (event) => {
  const tab = event.target.closest?.("[data-revision-view]");
  if (!tab || event.altKey || event.ctrlKey || event.metaKey) return;
  const tabs = [...tab.parentElement.querySelectorAll("[data-revision-view]")];
  const index = tabs.indexOf(tab);
  const next = { ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length], ArrowRight: tabs[(index + 1) % tabs.length], Home: tabs[0], End: tabs.at(-1) }[event.key];
  if (!next) return;
  event.preventDefault();
  selectRevisionView(next);
  next.focus();
});

// A setting that changes the page re-renders it with the Settings panel still open on that control.
async function rerenderKeepingSettings(control, selector) {
  const currentHash = location.hash;
  const fromSidePanel = Boolean(control.closest("[data-navigation-settings]"));
  const scrollTop = control.closest("[data-settings-panel], [data-navigation-settings]").scrollTop;
  await renderCurrentRoute();
  if (location.hash !== currentHash) return;
  const panel = document.querySelector(fromSidePanel ? "[data-navigation-settings]" : "[data-settings-panel]");
  if (!panel) return;
  if (fromSidePanel) openNavigationSettings({ focus: false });
  else {
    panel.hidden = false;
    document.querySelector("[data-open-settings]")?.setAttribute("aria-expanded", "true");
  }
  panel.querySelector(selector)?.focus({ preventScroll: true });
  panel.scrollTop = scrollTop;
}

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-filter-list]")) {
    const target = document.getElementById(event.target.dataset.filterList);
    if (!target) return;
    const words = event.target.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const items = [...target.querySelectorAll("li")];
    let visible = 0;
    for (const item of items) {
      const searchable = `${item.textContent} ${item.dataset.filterHeading ?? ""}`.toLocaleLowerCase();
      const matches = words.every((word) => searchable.includes(word));
      item.hidden = !matches;
      if (matches) visible += 1;
    }
    const status = document.querySelector(`[data-filter-status="${target.id}"]`);
    if (status) status.textContent = words.length
      ? visible ? `${visible} of ${items.length} shown` : "No matching headings. Try a number or fewer words."
      : "";
    return;
  }
  if (event.target.matches("[data-text-size]")) {
    const preferences = deviceState.updatePreferences({ textScale: event.target.value });
    applyPreferences(preferences);
    scheduleContextFit();
    document.querySelector("[data-text-size-value]").textContent = `${Math.round(preferences.textScale * 100)}%`;
    return;
  }
  if (event.target.matches("[data-line-spacing]")) {
    const preferences = deviceState.updatePreferences({ lineSpacing: event.target.value });
    applyPreferences(preferences);
    document.querySelector("[data-line-spacing-value]").textContent = `${preferences.lineSpacing.toFixed(2)}×`;
    return;
  }
  if (event.target.matches("[data-feedback-form] input, [data-feedback-form] textarea")) {
    event.target.setCustomValidity("");
    const status = event.target.form.querySelector("[data-feedback-status]");
    if (status) status.textContent = "";
  }
  if (event.target.matches("[data-omni-input]")) scheduleOmnisearch(event.target);
});

// Index entries load when their group is first opened; the shards are large.
document.addEventListener("toggle", async (event) => {
  const group = event.target;
  if (!group.matches?.("details[data-deferred-index]") || !group.open) return;
  const key = group.dataset.deferredIndex;
  const links = deferredIndexLinks.get(key) ?? [];
  group.removeAttribute("data-deferred-index");
  const list = group.querySelector("[data-linked-index]");
  list.setAttribute("aria-busy", "true");
  list.innerHTML = `<li class="related-loading" role="status">Loading index entries…</li>`;
  try {
    const entries = await secondaryRepository.loadLinkedIndexEntries(links);
    if (!list.isConnected) return;
    list.innerHTML = renderLinkedIndexEntries(entries);
  } catch (error) {
    console.warn("Could not load index entries", error);
    if (!list.isConnected) return;
    group.dataset.deferredIndex = key;
    list.innerHTML = `<li class="related-loading" role="status">Index entries could not be loaded. Close and reopen this group to try again.</li>`;
  } finally {
    list.removeAttribute("aria-busy");
  }
}, true);

document.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-omni-input]") && event.target.value.trim().length >= 2) {
    scheduleOmnisearch(event.target, 0);
  }
});

document.addEventListener("keydown", (event) => {
  // Search inputs consume Escape to clear their value in Chromium. In the
  // modal chapter sheet Escape consistently dismisses and restores focus.
  if (event.key === "Escape" && event.target.closest?.("[data-chapter-sheet][open]")) {
    event.preventDefault();
    chapterDialogController?.close();
    return;
  }
  const resizeHandle = event.target.closest?.("[data-resize-pane]");
  if (resizeHandle && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    const pane = resizeHandle.previousElementSibling;
    resizeContextPane(resizeHandle, pane.getBoundingClientRect().width + (event.key === "ArrowRight" ? 16 : -16), { save: true });
    return;
  }
  const input = event.target.closest?.("[data-omni-input]");
  if (input) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (moveOmniSelection(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      const selected = selectedOmniItem();
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
  if (event.key === "Escape" && settingsPanelOpen() && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    closeSettingsPanel();
    return;
  }
  if (event.key === "Escape" && navigationSettingsOpen() && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    closeNavigationSettings();
    return;
  }
  const inField = /^(input|select|textarea)$/i.test(document.activeElement?.tagName ?? "");
  if (event.key === "/" && !inField && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const globalInput = document.querySelector("[data-omni-input], #search-page-query");
    globalInput?.focus();
    globalInput?.select();
  }
});

function settingsPanelOpen() {
  const panel = document.querySelector("[data-settings-panel]");
  return Boolean(panel && !panel.hidden);
}

function closeSettingsPanel({ restoreFocus = true } = {}) {
  const panel = document.querySelector("[data-settings-panel]");
  const button = document.querySelector("[data-open-settings]");
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  button?.setAttribute("aria-expanded", "false");
  if (restoreFocus) button?.focus();
}

function navigationSettingsOpen() {
  const panel = document.querySelector("[data-navigation-settings]");
  return Boolean(panel && !panel.hidden);
}

// Only the first visible pane shows the button; CSS hides the others.
function visibleNavigationSettingsButton() {
  return [...document.querySelectorAll("[data-open-navigation-settings]")].find((button) => button.offsetParent);
}

// The panes are too narrow to hold the panel and clip what overflows them, so it sits
// outside them and is placed under the button.
function openNavigationSettings({ focus = true } = {}) {
  const panel = document.querySelector("[data-navigation-settings]");
  const button = visibleNavigationSettingsButton();
  if (!panel || !button) return;
  panel.hidden = false;
  const { bottom, left } = button.getBoundingClientRect();
  const gutter = 16;
  const top = bottom + 6;
  panel.style.top = `${top}px`;
  panel.style.left = `${Math.max(gutter, Math.min(left, innerWidth - panel.offsetWidth - gutter))}px`;
  panel.style.maxHeight = `${innerHeight - top - gutter}px`;
  button.setAttribute("aria-expanded", "true");
  if (focus) panel.querySelector("button")?.focus();
}

function closeNavigationSettings({ restoreFocus = true } = {}) {
  if (!navigationSettingsOpen()) return;
  document.querySelector("[data-navigation-settings]").hidden = true;
  for (const button of document.querySelectorAll("[data-open-navigation-settings]")) button.setAttribute("aria-expanded", "false");
  if (restoreFocus) visibleNavigationSettingsButton()?.focus();
}

window.addEventListener("resize", () => closeNavigationSettings({ restoreFocus: false }));

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("[data-global-search]")) closeOmni();
  if (navigationSettingsOpen() && !event.target.closest("[data-navigation-settings], [data-open-navigation-settings]")) {
    closeNavigationSettings({ restoreFocus: false });
  }
  // Dialogs opened from Settings sit outside the panel but belong to it.
  if (settingsPanelOpen() && !event.target.closest("[data-settings-panel], [data-open-settings], dialog")) {
    closeSettingsPanel({ restoreFocus: false });
  }
});

let resizingPane = null;
document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-resize-pane]");
  if (!handle || matchMedia("(max-width: 60rem)").matches) return;
  event.preventDefault();
  resizingPane = { handle, pointerId: event.pointerId, startX: event.clientX, startWidth: handle.previousElementSibling.getBoundingClientRect().width };
  handle.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-context");
});
document.addEventListener("pointermove", (event) => {
  if (!resizingPane || resizingPane.pointerId !== event.pointerId) return;
  resizeContextPane(resizingPane.handle, resizingPane.startWidth + event.clientX - resizingPane.startX);
});
function finishContextResize(event) {
  if (!resizingPane || resizingPane.pointerId !== event.pointerId) return;
  const { handle } = resizingPane;
  resizeContextPane(handle, handle.previousElementSibling.getBoundingClientRect().width, { save: true });
  resizingPane = null;
  document.body.classList.remove("resizing-context");
}
document.addEventListener("pointerup", finishContextResize);
document.addEventListener("pointercancel", finishContextResize);

document.addEventListener("click", async (event) => {
  const navigationToggle = event.target.closest("[data-toggle-navigation]");
  if (navigationToggle) {
    const shell = document.querySelector(".application-shell");
    const collapsed = shell.dataset.navigationCollapsed !== "true";
    shell.dataset.navigationCollapsed = String(collapsed);
    navigationToggle.setAttribute("aria-expanded", String(!collapsed));
    navigationToggle.setAttribute("aria-label", collapsed ? "Show navigation panes" : "Hide navigation panes");
    navigationToggle.title = collapsed ? "Show navigation panes" : "Hide navigation panes";
    navigationToggle.querySelector("span").textContent = collapsed ? "›" : "‹";
    deviceState.updateNavigationLayout({ collapsed });
    return;
  }
  if (event.target.closest("[data-go-back]")) {
    navigationHistory.back();
    return;
  }
  if (event.target.closest("[data-clear-page-history]")) {
    deviceState.clearPageHistory();
    deviceState.clearRecents();
    renderHistory();
    return;
  }
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
    const route = parseRoute(location);
    await runStatuteSearch(route.query, searchRouteOptions(route), {
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
    if (openSettings && panel.hidden) {
      panel.hidden = false;
      openSettings.setAttribute("aria-expanded", "true");
      panel.querySelector("button")?.focus();
    } else closeSettingsPanel();
    return;
  }
  const openPaneSettings = event.target.closest("[data-open-navigation-settings]");
  if (openPaneSettings || event.target.closest("[data-close-navigation-settings]")) {
    if (openPaneSettings && !navigationSettingsOpen()) openNavigationSettings();
    else closeNavigationSettings();
    return;
  }
  const openFeedback = event.target.closest("[data-open-feedback]");
  if (openFeedback) {
    const dialog = document.querySelector("[data-feedback-dialog]");
    dialog.addEventListener("close", () => openFeedback.isConnected && openFeedback.focus(), { once: true });
    dialog.querySelector("[data-feedback-status]").textContent = "";
    dialog.showModal();
    dialog.querySelector("[name=name]").focus();
    return;
  }
  if (event.target.closest("[data-retry-route]")) {
    renderCurrentRoute();
    return;
  }
  if (event.target.closest("[data-close-feedback]")) {
    document.querySelector("[data-feedback-dialog]").close();
    return;
  }
  const themeButton = event.target.closest("[data-theme-value]");
  if (themeButton) {
    const preferences = deviceState.updatePreferences({ theme: themeButton.dataset.themeValue });
    applyPreferences(preferences);
    document.querySelectorAll("[data-theme-value]").forEach((button) => button.setAttribute("aria-pressed", String(button === themeButton)));
    return;
  }
  const widthButton = event.target.closest("[data-reading-width-value]");
  if (widthButton) {
    applyPreferences(deviceState.updatePreferences({ readingWidth: widthButton.dataset.readingWidthValue }));
    document.querySelectorAll("[data-reading-width-value]").forEach((button) => button.setAttribute("aria-pressed", String(button === widthButton)));
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
  const repairOffline = event.target.closest("[data-repair-offline]");
  if (repairOffline) {
    try {
      await pwaManager.repairOfflineData();
    } catch {
      // PwaManager exposes the failure in the live settings status.
    }
    return;
  }
  const clearBookmarks = event.target.closest("[data-clear-bookmarks]");
  if (clearBookmarks) {
    pendingClearAction = { action: "bookmarks", button: clearBookmarks };
    const dialog = document.querySelector("[data-clear-data-dialog]");
    dialog.querySelector("[data-clear-data-message]").textContent = "Clear all saved bookmarks from this device? This cannot be undone.";
    dialog.showModal();
    return;
  }
  const clearRecents = event.target.closest("[data-clear-recents]");
  if (clearRecents) {
    if (clearRecents.closest(".clear-data-menu")) {
      pendingClearAction = { action: "recents", button: clearRecents };
      const dialog = document.querySelector("[data-clear-data-dialog]");
      dialog.querySelector("[data-clear-data-message]").textContent = "Clear all recently viewed items from this device? This cannot be undone.";
      dialog.showModal();
    } else {
      await clearDeviceData("recents", clearRecents);
    }
    return;
  }
  const clearSearchHistory = event.target.closest("[data-clear-search-history]");
  if (clearSearchHistory) {
    pendingClearAction = { action: "search-history", button: clearSearchHistory };
    const dialog = document.querySelector("[data-clear-data-dialog]");
    dialog.querySelector("[data-clear-data-message]").textContent = "Clear all saved search history from this device? This cannot be undone.";
    dialog.showModal();
    return;
  }
  if (event.target.closest("[data-cancel-clear]")) {
    document.querySelector("[data-clear-data-dialog]").close();
    pendingClearAction?.button.focus();
    pendingClearAction = null;
    return;
  }
  if (event.target.closest("[data-confirm-clear]")) {
    const pending = pendingClearAction;
    pendingClearAction = null;
    document.querySelector("[data-clear-data-dialog]").close();
    if (pending) await clearDeviceData(pending.action, pending.button);
    document.querySelector(".clear-data-menu > summary")?.focus();
    return;
  }
  const copyCitation = event.target.closest("[data-copy-citation]");
  if (copyCitation) {
    const status = copyCitation.closest(".provision")?.querySelector(".action-status");
    try {
      await navigator.clipboard.writeText(copyCitation.dataset.copyCitation);
      copyCitation.textContent = "Copied";
      if (status) status.textContent = `${copyCitation.dataset.copyCitation} copied.`;
      window.setTimeout(() => {
        if (copyCitation.isConnected) copyCitation.textContent = "Copy citation";
      }, 1200);
    } catch {
      if (status) status.textContent = "The citation could not be copied automatically.";
    }
    return;
  }
  const share = event.target.closest("[data-share-link]");
  if (share) {
    const status = share.closest(".provision")?.querySelector(".action-status");
    try {
      await navigator.share({ title: share.dataset.shareTitle, url: new URL(share.dataset.shareLink, location.href).href });
      if (status) status.textContent = "Share options opened.";
    } catch (error) {
      // Closing the share sheet without choosing anything is not a failure.
      if (error.name !== "AbortError" && status) status.textContent = "The share options could not be opened. Use Copy link instead.";
    }
    return;
  }
  const copy = event.target.closest("[data-copy-link]");
  if (!copy) return;
  const status = copy.closest(".provision")?.querySelector(".action-status");
  try {
    await navigator.clipboard.writeText(new URL(copy.dataset.copyLink, location.href).href);
    if (status) status.textContent = "Link copied.";
  } catch {
    if (status) status.textContent = "The link could not be copied automatically.";
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-font-profile]")) {
    applyPreferences(deviceState.updatePreferences({ fontProfile: event.target.value }));
    return;
  }
  if (event.target.matches("#search-title")) {
    const chapterSelect = document.querySelector("#search-chapter");
    const catalog = await loadCatalog();
    const title = catalog.titles.find((candidate) => candidate.id === event.target.value);
    const options = [new Option("All chapters", ""), ...(title?.chapters ?? []).map((chapter) => new Option(`${chapterLabel(chapter)} — ${chapter.name}`, chapter.number))];
    chapterSelect.replaceChildren(...options);
    chapterSelect.disabled = !title;
    return;
  }
  // These rows exist in both Settings and the side panel's popover, so each copy stays current.
  const navigationSetting = ["compact-lists", "subtle-notices", "navigation-tree"].find((name) => event.target.hasAttribute(`data-${name}`));
  const copies = navigationSetting ? `input[data-${navigationSetting}]`
    : event.target.matches("[data-hide-status]") ? `input[data-hide-status="${CSS.escape(event.target.dataset.hideStatus)}"]` : null;
  if (copies) {
    for (const input of document.querySelectorAll(copies)) input.checked = event.target.checked;
  }
  if (event.target.matches("[data-compact-lists]")) {
    applyPreferences(deviceState.updatePreferences({ compactLists: event.target.checked }));
    return;
  }
  if (event.target.matches("[data-subtle-notices]")) {
    applyPreferences(deviceState.updatePreferences({ subtleNotices: event.target.checked }));
    return;
  }
  if (event.target.matches("[data-hide-status]")) {
    const status = event.target.dataset.hideStatus;
    const hidden = deviceState.preferences().hiddenStatuses.filter((value) => value !== status);
    applyPreferences(deviceState.updatePreferences({ hiddenStatuses: event.target.checked ? [...hidden, status] : hidden }));
    // The tree hides sections on every statute page; the panes only list a chapter's sections.
    const pages = deviceState.preferences().navigationTree ? ["home", "title", "chapter", "section"] : ["chapter", "section"];
    if (pages.includes(parseRoute(location).kind)) await rerenderKeepingSettings(event.target, `[data-hide-status="${CSS.escape(status)}"]`);
    return;
  }
  if (event.target.matches("[data-navigation-tree]")) {
    applyPreferences(deviceState.updatePreferences({ navigationTree: event.target.checked }));
    if (["home", "title", "chapter", "section", "index", "infractions"].includes(parseRoute(location).kind)) await rerenderKeepingSettings(event.target, "[data-navigation-tree]");
    return;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.matches("[data-feedback-form]")) {
    const values = new FormData(form);
    for (const field of ["name", "email", "message"]) {
      const value = String(values.get(field) ?? "").trim();
      const input = form.elements.namedItem(field);
      input.setCustomValidity(value ? "" : "Please enter a value.");
      if (!value) {
        event.preventDefault();
        input.reportValidity();
        return;
      }
    }
    // Sending navigates to the form service, so offline the browser would show its own
    // error page and the message would be lost. Keep the dialog open with the text intact.
    if (!navigator.onLine) {
      event.preventDefault();
      form.querySelector("[data-feedback-status]").textContent = "You’re offline. Your message is still here; send it once you reconnect.";
    }
    return;
  }
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
    const query = String(values.get("query") ?? "").trim();
    const href = searchRouteHref(query, {
      title: values.get("title") || null,
      chapter: values.get("chapter") || null,
      status: values.get("status") || null,
      supplement: values.get("supplement") || null,
      field: values.get("field") || "statute",
      sort: values.get("sort") || "relevance"
    });
    if (location.hash === href) await renderCurrentRoute();
    else location.hash = href;
    return;
  }
  if (form.matches("[data-search-within]")) {
    event.preventDefault();
    const route = parseRoute(location);
    const within = String(new FormData(form).get("within") ?? "").trim();
    const href = searchRouteHref(route.query, { ...searchRouteOptions(route), within: within || null });
    if (location.hash === href) await renderCurrentRoute();
    else location.hash = href;
    return;
  }
  if (form.matches("[data-acts-filter]")) {
    event.preventDefault();
    const values = new FormData(form);
    const href = actsRouteHref({
      session: values.get("session") || parseRoute(location).session,
      type: values.get("type") || null,
      query: String(values.get("query") ?? "").trim() || null,
      sort: values.get("sort") || null,
      order: values.get("order") || null,
      view: values.get("view") || null,
      on: values.get("on") || null
    });
    if (location.hash === href) await renderCurrentRoute();
    else location.hash = href;
    return;
  }
  if (form.matches("[data-infraction-search]")) {
    event.preventDefault();
    const route = parseRoute(location);
    const query = new FormData(form).get("query").trim();
    location.hash = infractionsRouteHref(route.category, { query });
  }
});

// On phones the header is pinned, but with large text it can cover much of the
// screen; past a quarter of the viewport it scrolls away with the page instead.
const compactLayout = matchMedia("(max-width: 60rem)");
function updateHeaderPinning() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  // Sticky panes, the phone chapter bar, and subsection links sit just below the header,
  // whose height changes with the window and the text size.
  const height = `${header.offsetHeight}px`;
  if (document.documentElement.style.getPropertyValue("--header-height") !== height) {
    document.documentElement.style.setProperty("--header-height", height);
  }
  const tall = compactLayout.matches && header.offsetHeight > innerHeight * 0.25;
  if (tall !== document.documentElement.hasAttribute("data-static-header")) {
    document.documentElement.toggleAttribute("data-static-header", tall);
  }
}
new ResizeObserver(updateHeaderPinning).observe(document.body);
compactLayout.addEventListener("change", () => {
  document.querySelector(".app-nav > a:first-child")?.setAttribute("href", statutesNavHref());
});

window.addEventListener("hashchange", renderCurrentRoute);
// A page that failed only because the connection dropped loads itself again on reconnect.
window.addEventListener("online", () => {
  if (app.querySelector("[data-load-failure]")) renderCurrentRoute();
});
renderCurrentRoute();

bindBookmarkControls({ state: deviceState, render: renderBookmarks, buttonLabel: bookmarkButtonLabel });
