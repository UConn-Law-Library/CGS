import { escapeHtml } from "./reader.js";
import { syncCollapseAll } from "./statute-tree.js";

// A two-level page tree (groups > items) for the subject index and the infraction schedule,
// shown in place of their panes when page tree navigation is on. It uses the statute tree's
// markup and styles. Items load per group on demand; `searchGroups` limits which groups a
// filter searches, so a filter never downloads more than the page could already load.
const RESULT_LIMIT = 200;
const MINIMUM_ITEM_QUERY = 2;
const chevron = `<svg class="tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

function queryWords(query) {
  return query.replace(/§/g, " ").toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function matchesWords(text, words) {
  return words.every((word) => text.includes(word));
}

function plural(count, [one, many]) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function createGroupTree({
  id,
  label,
  heading,
  filterLabel,
  placeholder,
  nouns,
  loadItems,
  searchGroups = (query, groups) => groups,
  scopeNote = () => ""
}) {
  const railId = `rail-${id}-tree`;
  let groups = [];
  let current = {};
  let query = "";
  let filterTimer = null;
  const expanded = new Map();
  const filterExpanded = new Map();
  const items = new Map();
  const loads = new Map();
  const failed = new Set();

  const filtering = () => Boolean(query.trim());
  const isOpen = (key, byDefault = false) => (filtering() ? filterExpanded : expanded).get(key) ?? byDefault;

  function ensureItems(group) {
    if (items.has(group.key) || loads.has(group.key)) return loads.get(group.key) ?? Promise.resolve();
    failed.delete(group.key);
    const load = loadItems(group).then((loaded) => {
      items.set(group.key, loaded);
    }).catch((error) => {
      failed.add(group.key);
      console.warn(`Could not load ${nouns.item[1]}`, error);
    }).finally(() => {
      loads.delete(group.key);
      refresh();
    });
    loads.set(group.key, load);
    return load;
  }

  function itemRow(item) {
    return `<li><a class="section-navigation-link" href="${escapeHtml(item.href)}"${item.href === current.itemHref ? ' aria-current="page"' : ""}><strong>${escapeHtml(item.label)}</strong>${item.description ? `<span class="section-navigation-description">${escapeHtml(item.description)}</span>` : ""}</a></li>`;
  }

  function itemList(group, shown = null) {
    const list = (markup) => `<ul class="tree-children tree-sections context-list">${markup}</ul>`;
    if (shown) return list(shown.map(itemRow).join(""));
    const loaded = items.get(group.key);
    if (loaded) return list(loaded.map(itemRow).join("") || `<li class="tree-message">No ${nouns.item[1]} listed.</li>`);
    if (failed.has(group.key)) return list(`<li class="tree-message">${escapeHtml(nouns.item[1][0].toUpperCase() + nouns.item[1].slice(1))} could not be loaded. <a href="${escapeHtml(group.href)}">Open ${escapeHtml(group.label)}</a></li>`);
    ensureItems(group);
    return list(`<li class="tree-message">Loading ${nouns.item[1]}…</li>`);
  }

  function groupNode(group, { shown = null, openByDefault = false } = {}) {
    const open = isOpen(group.key, openByDefault);
    const onPath = group.key === current.groupKey;
    return `<li class="tree-node tree-group">
      <div class="tree-row${onPath ? " is-path" : ""}">
        <a href="${escapeHtml(group.href)}"${onPath && !current.itemHref ? ' aria-current="page"' : ""}><strong>${escapeHtml(group.label)}</strong>${group.description ? `<span>${escapeHtml(group.description)}</span>` : ""}</a>
        <button type="button" class="tree-toggle" data-group-tree-toggle="${escapeHtml(id)}" data-group-key="${escapeHtml(group.key)}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${escapeHtml(group.label)}">${chevron}</button>
      </div>
      ${open ? itemList(group, shown) : ""}
    </li>`;
  }

  function filteredTree() {
    const words = queryWords(query);
    const searched = query.trim().length >= MINIMUM_ITEM_QUERY ? new Set(searchGroups(query, groups).map((group) => group.key)) : new Set();
    const counts = { groups: 0, items: 0, shown: 0, loading: false };
    const nodes = [];
    for (const group of groups) {
      const groupHit = matchesWords(`${group.label} ${group.description ?? ""}`.toLocaleLowerCase(), words);
      if (groupHit) counts.groups += 1;
      let shown = [];
      if (searched.has(group.key)) {
        if (!items.has(group.key) && !failed.has(group.key)) {
          counts.loading = true;
          ensureItems(group);
        }
        const hits = (items.get(group.key) ?? []).filter((item) => matchesWords(item.text, words));
        counts.items += hits.length;
        shown = hits.slice(0, Math.max(0, RESULT_LIMIT - counts.shown));
        counts.shown += shown.length;
      }
      if (!groupHit && !shown.length) continue;
      nodes.push(groupNode(group, shown.length ? { shown, openByDefault: true } : {}));
    }
    return { html: nodes.length ? `<ul class="tree-root">${nodes.join("")}</ul>` : "", counts };
  }

  function statusText(counts) {
    if (counts.loading) return `Loading ${nouns.item[1]}…`;
    const note = scopeNote(query);
    const total = counts.groups + counts.items;
    if (!total) return `No matching ${nouns.group[1]} or ${nouns.item[1]}.${note ? ` ${note}` : ""}`;
    const summary = `${[[counts.groups, nouns.group], [counts.items, nouns.item]].filter(([count]) => count).map(([count, noun]) => plural(count, noun)).join(", ")}.`;
    const capped = counts.items > counts.shown ? ` Showing the first ${RESULT_LIMIT} ${nouns.item[1]}; add a word to narrow them.` : "";
    return `${summary}${capped}${note ? ` ${note}` : ""}`;
  }

  function markup() {
    if (!filtering()) {
      return { html: `<ul class="tree-root">${groups.map((group) => groupNode(group)).join("")}</ul>`, status: "" };
    }
    const { html, counts } = filteredTree();
    return { html, status: statusText(counts) };
  }

  function refresh({ focusKey = null } = {}) {
    const rail = document.getElementById(railId);
    if (!rail) return;
    const { scrollTop } = rail;
    const { html, status } = markup();
    rail.innerHTML = html;
    rail.scrollTop = scrollTop;
    syncCollapseAll(id, rail);
    const statusElement = document.querySelector(`[data-group-tree-status="${CSS.escape(id)}"]`);
    if (statusElement && statusElement.textContent !== status) statusElement.textContent = status;
    if (focusKey !== null) rail.querySelector(`[data-group-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(`[data-group-tree-toggle="${CSS.escape(id)}"]`);
    if (!toggle) return;
    const key = toggle.dataset.groupKey;
    (filtering() ? filterExpanded : expanded).set(key, toggle.getAttribute("aria-expanded") !== "true");
    refresh({ focusKey: key });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(`[data-tree-collapse-all="${CSS.escape(id)}"]`)) return;
    const rail = document.getElementById(railId);
    if (!rail) return;
    if (filtering()) for (const toggle of rail.querySelectorAll("[data-group-key]")) filterExpanded.set(toggle.dataset.groupKey, false);
    else expanded.clear();
    refresh();
    rail.scrollTop = 0;
    rail.querySelector("[data-group-key]")?.focus({ preventScroll: true });
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches(`[data-group-tree-filter="${CSS.escape(id)}"]`)) return;
    query = event.target.value;
    filterExpanded.clear();
    clearTimeout(filterTimer);
    filterTimer = setTimeout(refresh, 120);
  });

  // `next.items` maps group keys to items the page already loaded, so the open group needs no
  // second download.
  function column(next) {
    groups = next.groups;
    current = { groupKey: next.groupKey ?? null, itemHref: next.itemHref ?? null };
    for (const [key, loaded] of next.items ?? []) items.set(key, loaded);
    if (current.groupKey !== null) expanded.set(current.groupKey, true);
    const { html, status } = markup();
    return {
      label,
      className: `statute-tree-column ${id}-tree-column`,
      defaultWidth: 320,
      heading: `<button type="button" class="tree-collapse-all" data-tree-collapse-all="${escapeHtml(id)}"${html.includes('aria-expanded="true"') ? "" : " hidden"}>Collapse all</button><strong>${escapeHtml(heading)}</strong><div class="browse-filter"><label for="${id}-tree-filter">${escapeHtml(filterLabel)}</label>
        <input id="${id}-tree-filter" type="search" value="${escapeHtml(query)}" placeholder="${escapeHtml(placeholder)}" data-group-tree-filter="${escapeHtml(id)}" aria-controls="${railId}" autocomplete="off">
        <p class="browse-filter-status" role="status" aria-live="polite" data-group-tree-status="${escapeHtml(id)}">${escapeHtml(status)}</p></div>`,
      content: `<div id="${railId}" class="statute-tree">${html}</div>`
    };
  }

  return { column };
}
