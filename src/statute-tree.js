import { escapeHtml, isHiddenByStatus, navigationSectionDescription, navigationSectionLabel, shortSectionDescription } from "./reader.js";
import { routeHref } from "./routes.js";

// A single navigation pane: Titles > Chapters > Sections, as a collapsible page tree. Offered in
// Settings beside the three-pane layout. Sections come from the small per-title heading indexes,
// so browsing or filtering the whole code does not download any chapter text.
const RAIL_ID = "rail-statute-tree";
// A row's children stagger in when it opens. Sections that finish loading soon after still
// count as opening; later redraws don't replay it.
const STAGGER_WINDOW = 1000;
const SECTION_RESULT_LIMIT = 200;
const MINIMUM_SECTION_QUERY = 2;
const LOAD_CONCURRENCY = 6;
const chevron = `<svg class="tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

// Each option keeps the sections that carry that tag in the section lists.
const STATUS_FILTERS = {
  all: "Any status",
  "supplement-amended": "Supplement amendments",
  "supplement-new": "Supplement additions",
  act: "Recent Public Acts",
  repealed: "Repealed",
  transferred: "Transferred",
  obsolete: "Obsolete",
  reserved: "Reserved"
};

function queryWords(query) {
  return query.replace(/§/g, " ").toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function matchesWords(text, words) {
  return words.every((word) => text.includes(word));
}

// Shown in the heading only while a row is open; it closes every open row.
function collapseAllButton(treeId, html) {
  return `<button type="button" class="tree-collapse-all" data-tree-collapse-all="${treeId}"${html.includes('aria-expanded="true"') ? "" : " hidden"}>Collapse all</button>`;
}

export function staggerChildren(toggle) {
  toggle?.closest(".tree-node")?.querySelector(":scope > .tree-children")?.classList.add("stagger-rows");
}

export function syncCollapseAll(treeId, rail) {
  const button = document.querySelector(`[data-tree-collapse-all="${treeId}"]`);
  if (button) button.hidden = !rail.querySelector('[aria-expanded="true"]');
}

function plural(count, noun) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

export function createStatuteTree({ titleLabel, chapterLabel, titleRoute, chapterRoute, loadHeadings, loadPendingActs, noticePills, hiddenStatuses = () => [] }) {
  let catalog = null;
  let current = {};
  let query = "";
  let statusFilter = "all";
  let pendingActs = null;
  let pendingActsLoad = null;
  let pendingActsFailed = false;
  const rowActs = new Map();
  let searching = false;
  let filterTimer = null;
  let progressTimer = null;
  let lastOpened = null;
  // Each mode keeps its own open and closed rows: filtering opens rows that have matches, and
  // clearing the filter returns to what the person had open.
  const expanded = new Map();
  const filterExpanded = new Map();
  const headings = new Map();
  const headingLoads = new Map();
  const failedTitles = new Set();

  const titleKey = (title) => `t:${title.id}`;
  const chapterKey = (title, chapter) => `c:${title.id}:${chapter.id}`;

  const filtering = () => Boolean(query.trim()) || statusFilter !== "all";
  // Sections are only searched once the query has two characters, or a status is chosen.
  const searchesSections = () => query.trim().length >= MINIMUM_SECTION_QUERY || statusFilter !== "all";

  function isOpen(key, byDefault = false) {
    return (filtering() ? filterExpanded : expanded).get(key) ?? byDefault;
  }

  // The acts index is one file for the whole code. It loads once, then redraws the tree so
  // every section row gets its Recent Act tag.
  function ensurePendingActs() {
    if (pendingActsLoad || !catalog) return;
    pendingActsLoad = loadPendingActs(catalog).then((lookup) => {
      pendingActs = lookup;
    }).catch((error) => {
      pendingActsFailed = true;
      console.warn("Could not load recent Public Acts", error);
    }).finally(() => refresh());
  }

  function actsFor(row) {
    if (!pendingActs) return [];
    if (!rowActs.has(row)) rowActs.set(row, pendingActs(row));
    return rowActs.get(row);
  }

  // Sections hidden in Settings, as in the chapter lists. The open section always stays, and
  // choosing a status in the Status filter shows those sections anyway.
  function isHidden(row, href) {
    if (statusFilter !== "all" || href === current.sectionHref) return false;
    const statuses = row.tags.filter((tag) => !tag.startsWith("supplement-"));
    return isHiddenByStatus(statuses, hiddenStatuses());
  }

  function hasStatus(row) {
    if (statusFilter === "all") return true;
    if (statusFilter === "act") return actsFor(row).length > 0;
    return row.tags.includes(statusFilter);
  }

  function ensureHeadings(title) {
    if (headings.has(title.id)) return Promise.resolve();
    if (!headingLoads.has(title.id)) {
      failedTitles.delete(title.id);
      headingLoads.set(title.id, loadHeadings(title.id).then((rows) => {
        headings.set(title.id, rows.map(([section, chapter, heading, citations, tags = []]) => ({
          section,
          chapter,
          heading,
          citations,
          tags,
          text: `${citations.join(" ")} ${heading}`.toLocaleLowerCase()
        })));
      }).catch((error) => {
        failedTitles.add(title.id);
        console.warn("Could not load section headings", error);
      }).finally(() => headingLoads.delete(title.id)));
    }
    return headingLoads.get(title.id);
  }

  const sectionHref = (title, chapter, row) => routeHref({ title: title.number, chapter: chapter.number, section: row.section });

  function sectionRow(title, chapter, row) {
    const href = sectionHref(title, chapter, row);
    const description = navigationSectionDescription(row);
    const label = navigationSectionLabel(row);
    const shortDescription = shortSectionDescription(description);
    return `<li><a class="section-navigation-link" href="${escapeHtml(href)}"${href === current.sectionHref ? ' aria-current="page"' : ""}><strong>${escapeHtml(label)}</strong><span class="section-navigation-notices">${noticePills(row.tags, actsFor(row))}</span>${shortDescription ? `<span class="section-navigation-description">${escapeHtml(shortDescription)}</span>` : ""}</a></li>`;
  }

  function sectionList(items) {
    return `<ul class="tree-children tree-sections context-list">${items}</ul>`;
  }

  function allSections(title, chapter) {
    if (!filtering() && current.chapterId === chapter.id && current.sectionItems) return sectionList(current.sectionItems().join(""));
    const rows = headings.get(title.id);
    if (rows) {
      const items = rows.filter((row) => row.chapter === chapter.number && !isHidden(row, sectionHref(title, chapter, row))).map((row) => sectionRow(title, chapter, row));
      return sectionList(items.join("") || '<li class="tree-message">No sections listed.</li>');
    }
    if (failedTitles.has(title.id)) {
      return sectionList(`<li class="tree-message">Sections could not be loaded. <a href="${escapeHtml(chapterRoute(title, chapter))}">Open the chapter</a></li>`);
    }
    ensureHeadings(title).then(() => refresh());
    return sectionList('<li class="tree-message">Loading sections…</li>');
  }

  function node({ href, label, description, key, open, level, onPath, isCurrent, children }) {
    return `<li class="tree-node tree-${level}">
      <div class="tree-row${onPath ? " is-path" : ""}">
        <a href="${escapeHtml(href)}"${isCurrent ? ' aria-current="page"' : ""}><strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}</span></a>
        <button type="button" class="tree-toggle" data-tree-toggle="${escapeHtml(key)}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${escapeHtml(label)}">${chevron}</button>
      </div>
      ${open ? children() : ""}
    </li>`;
  }

  function chapterNode(title, chapter, { sectionItems = null, openByDefault = false } = {}) {
    const key = chapterKey(title, chapter);
    return node({
      href: chapterRoute(title, chapter),
      label: chapterLabel(chapter),
      description: chapter.name,
      key,
      open: isOpen(key, openByDefault),
      level: "chapter",
      onPath: current.chapterId === chapter.id,
      isCurrent: current.chapterId === chapter.id && !current.sectionHref,
      children: () => sectionItems === null ? allSections(title, chapter) : sectionList(sectionItems)
    });
  }

  function titleNode(title, { chapters = null, openByDefault = false } = {}) {
    const key = titleKey(title);
    return node({
      href: titleRoute(title),
      label: titleLabel(title),
      description: title.name,
      key,
      open: isOpen(key, openByDefault),
      level: "title",
      onPath: current.titleId === title.id,
      isCurrent: current.titleId === title.id && !current.chapterId,
      children: () => `<ul class="tree-children">${chapters ?? title.chapters.map((chapter) => chapterNode(title, chapter)).join("")}</ul>`
    });
  }

  function fullTree() {
    return `<ul class="tree-root">${catalog.titles.map((title) => titleNode(title)).join("")}</ul>`;
  }

  // Matches at any level. A row that matches keeps its ancestors, and a row with matching
  // descendants starts open. A row that only matches itself starts closed and opens in full.
  function filteredTree() {
    const words = queryWords(query);
    const searchSections = searchesSections();
    // Titles and chapters carry no status, so a status filter lists sections only.
    const byStatus = statusFilter !== "all";
    const counts = { titles: 0, chapters: 0, sections: 0, shown: 0 };
    const nodes = [];
    for (const title of catalog.titles) {
      const titleHit = !byStatus && matchesWords(`${titleLabel(title)} ${title.name}`.toLocaleLowerCase(), words);
      if (titleHit) counts.titles += 1;
      const rows = searchSections ? headings.get(title.id) ?? [] : [];
      const chapterNodes = [];
      for (const chapter of title.chapters) {
        const chapterHit = !byStatus && matchesWords(`${chapterLabel(chapter)} ${chapter.name}`.toLocaleLowerCase(), words);
        if (chapterHit) counts.chapters += 1;
        const hits = rows.filter((row) => row.chapter === chapter.number && matchesWords(row.text, words) && hasStatus(row) && !isHidden(row, sectionHref(title, chapter, row)));
        counts.sections += hits.length;
        const room = Math.max(0, SECTION_RESULT_LIMIT - counts.shown);
        const shown = hits.slice(0, room);
        counts.shown += shown.length;
        if (!chapterHit && !shown.length) continue;
        chapterNodes.push(chapterNode(title, chapter, shown.length
          ? { sectionItems: shown.map((row) => sectionRow(title, chapter, row)).join(""), openByDefault: true }
          : {}));
      }
      if (!titleHit && !chapterNodes.length) continue;
      nodes.push(titleNode(title, chapterNodes.length ? { chapters: chapterNodes.join(""), openByDefault: true } : {}));
    }
    return { markup: nodes.length ? `<ul class="tree-root">${nodes.join("")}</ul>` : "", counts };
  }

  function statusText(counts) {
    const total = counts.titles + counts.chapters + counts.sections;
    if (statusFilter === "act" && pendingActsFailed) return "Recent Public Acts could not be loaded.";
    if (statusFilter === "act" && !pendingActs) return "Checking recent Public Acts…";
    if (searching) return `Searching sections…${total ? ` ${total.toLocaleString()} match${total === 1 ? "" : "es"} so far.` : ""}`;
    const incomplete = failedTitles.size ? " Some section headings could not be loaded." : "";
    if (!total) return `No matching titles, chapters, or sections.${incomplete}`;
    const summary = `${[["title", counts.titles], ["chapter", counts.chapters], ["section", counts.sections]].filter(([, count]) => count).map(([noun, count]) => plural(count, noun)).join(", ")}.`;
    const capped = counts.sections > counts.shown ? ` Showing the first ${SECTION_RESULT_LIMIT} sections; add a word to narrow them.` : "";
    return `${summary}${capped}${incomplete}`;
  }

  function markup() {
    if (!filtering()) return { html: fullTree(), status: "" };
    const { markup: html, counts } = filteredTree();
    return { html, status: statusText(counts) };
  }

  function refresh({ focusToggle = null } = {}) {
    const rail = document.getElementById(RAIL_ID);
    if (!rail || !catalog) return;
    const { scrollTop } = rail;
    const { html, status } = markup();
    rail.innerHTML = html;
    rail.scrollTop = scrollTop;
    syncCollapseAll("statutes", rail);
    if (lastOpened && performance.now() - lastOpened.at < STAGGER_WINDOW) staggerChildren(rail.querySelector(`[data-tree-toggle="${CSS.escape(lastOpened.key)}"]`));
    const statusElement = document.querySelector("[data-tree-filter-status]");
    if (statusElement && statusElement.textContent !== status) statusElement.textContent = status;
    if (focusToggle) rail.querySelector(`[data-tree-toggle="${CSS.escape(focusToggle)}"]`)?.focus({ preventScroll: true });
  }

  function revealCurrent() {
    const rail = document.getElementById(RAIL_ID);
    const row = rail?.querySelector('[aria-current="page"]');
    if (!row) return;
    const rowBox = row.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    if (rowBox.top < railBox.top || rowBox.bottom > railBox.bottom) rail.scrollTop += rowBox.top - railBox.top - (railBox.height - rowBox.height) / 2;
  }

  async function loadEveryTitle() {
    const missing = catalog.titles.filter((title) => !headings.has(title.id) && !failedTitles.has(title.id));
    if (!missing.length || searching) return;
    searching = true;
    let cursor = 0;
    const scheduleProgress = () => {
      if (progressTimer || !filtering()) return;
      progressTimer = setTimeout(() => {
        progressTimer = null;
        if (filtering()) refresh();
      }, 250);
    };
    const worker = async () => {
      while (cursor < missing.length) {
        await ensureHeadings(missing[cursor++]);
        scheduleProgress();
      }
    };
    await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
    searching = false;
    if (filtering()) refresh();
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-tree-toggle]");
    if (!toggle) return;
    const key = toggle.dataset.treeToggle;
    const opening = toggle.getAttribute("aria-expanded") !== "true";
    (filtering() ? filterExpanded : expanded).set(key, opening);
    lastOpened = opening ? { key, at: performance.now() } : null;
    refresh({ focusToggle: key });
  });

  // Filter results start open, so each shown row is closed explicitly; otherwise every row
  // returns to its closed default.
  document.addEventListener("click", (event) => {
    if (!event.target.closest('[data-tree-collapse-all="statutes"]')) return;
    const rail = document.getElementById(RAIL_ID);
    if (!rail) return;
    if (filtering()) for (const toggle of rail.querySelectorAll("[data-tree-toggle]")) filterExpanded.set(toggle.dataset.treeToggle, false);
    else expanded.clear();
    refresh();
    rail.scrollTop = 0;
    rail.querySelector("[data-tree-toggle]")?.focus({ preventScroll: true });
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-tree-filter]")) return;
    query = event.target.value;
    filterExpanded.clear();
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      if (searchesSections()) loadEveryTitle();
      refresh();
      if (!filtering()) revealCurrent();
    }, 120);
  });

  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-tree-status]")) return;
    statusFilter = Object.hasOwn(STATUS_FILTERS, event.target.value) ? event.target.value : "all";
    filterExpanded.clear();
    if (searchesSections()) loadEveryTitle();
    refresh();
    if (!filtering()) revealCurrent();
  });

  // `next` describes the page being opened: its title, chapter and section, and the section rows
  // the reader already loaded, which carry notices the heading indexes do not have.
  function column(nextCatalog, next = {}) {
    catalog = nextCatalog;
    current = {
      titleId: next.title?.id ?? null,
      chapterId: next.chapter?.id ?? null,
      sectionHref: next.sectionHref ?? null,
      sectionItems: next.sectionItems ?? null
    };
    if (next.title) expanded.set(titleKey(next.title), true);
    if (next.title && next.chapter) expanded.set(chapterKey(next.title, next.chapter), true);
    ensurePendingActs();
    if (searchesSections()) loadEveryTitle();
    const { html, status } = markup();
    return {
      label: "Statute titles, chapters, and sections",
      className: "statute-tree-column",
      defaultWidth: 320,
      heading: `${collapseAllButton("statutes", html)}<strong>Statutes</strong><div class="browse-filter"><label for="statute-tree-filter">Filter titles, chapters, and sections</label>
        <input id="statute-tree-filter" type="search" value="${escapeHtml(query)}" placeholder="Number or heading" data-tree-filter aria-controls="${RAIL_ID}" autocomplete="off">
        <p class="browse-filter-status" role="status" aria-live="polite" data-tree-filter-status>${escapeHtml(status)}</p></div>
        <div class="tree-status-filter"><label for="statute-tree-status">Status</label>
        <select id="statute-tree-status" data-tree-status aria-controls="${RAIL_ID}">${Object.entries(STATUS_FILTERS).map(([value, label]) => `<option value="${value}"${value === statusFilter ? " selected" : ""}>${label}</option>`).join("")}</select></div>`,
      content: `<div id="${RAIL_ID}" class="statute-tree">${html}</div>`
    };
  }

  return { column, refresh, revealCurrent };
}
