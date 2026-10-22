import { escapeHtml } from "./reader.js";
import { buildOmniRows, findActMatches, findIndexMatches, findInfractionMatches, findNavigationMatches, indexLetterForQuery } from "./omnisearch.js";

export function createOmnisearchController({ loadCatalog, quickSearch, secondaryRepository, actsRepository }) {
  let activeOmniController = null;
  let omniTimer = null;
  let omniSelection = -1;
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
    </a>`).join("") : `<p class="omni-empty">${pending ? "Searching published legal data…" : "No quick matches. Press Enter for complete search results."}</p>`;
  const progress = pending && total ? `Searching ${completed} of ${total} statute titles…` : pending ? "Searching published legal data…" : `${rows.length} quick match${rows.length === 1 ? "" : "es"}`;
  panel.innerHTML = `${body}<div class="omni-foot"><span>${escapeHtml(progress)}</span><span>Enter: full search results · ↑↓: choose · Esc: close</span></div>`;
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
  const catalog = await loadCatalog();
  if (controller.signal.aborted) return;
  const groups = { statutes: [], ...findNavigationMatches(catalog, query), acts: [], index: [], infractions: [] };
  const letter = indexLetterForQuery(query);
  let completed = 0;
  let total = 0;
  let pendingTasks = letter ? 4 : 3;
  const render = () => renderOmniPanel(query, groups, { completed, total, pending: pendingTasks > 0 });
  const finish = () => {
    pendingTasks -= 1;
    if (!controller.signal.aborted) render();
  };
  render();

  const statutes = quickSearch.search(query, catalog, {
    limit: 5,
    signal: controller.signal,
    onProgress(update) {
      if (controller.signal.aborted) return;
      completed = update.completed;
      total = update.total;
      groups.statutes = update.results;
      render();
    }
  }).then((outcome) => {
    groups.statutes = outcome;
  }).catch((error) => {
    if (error.name !== "AbortError") console.warn("Quick statute search failed", error);
  }).finally(finish);

  const infractions = secondaryRepository.loadAllInfractions().then((entries) => {
    if (!controller.signal.aborted) groups.infractions = findInfractionMatches(entries, query);
  }).catch((error) => console.warn("Quick infraction search failed", error)).finally(finish);

  const acts = actsRepository.loadSearchableSessions().then((sessions) => {
    if (!controller.signal.aborted) groups.acts = findActMatches(sessions, query);
  }).catch((error) => console.warn("Quick acts search failed", error)).finally(finish);

  const index = letter ? secondaryRepository.loadIndexLetter(letter).then((topics) => {
    if (!controller.signal.aborted) groups.index = findIndexMatches(topics, query);
  }).catch((error) => console.warn("Quick index search failed", error)).finally(finish) : Promise.resolve();

  await Promise.all([statutes, infractions, acts, index]);
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
    runOmnisearch(query).catch((error) => { console.warn("Quick search unavailable", error); closeOmni(); });
  }, delay);
}

  return { closeOmni, scheduleOmnisearch, moveOmniSelection,
    selectedOmniItem: () => omniSelection >= 0 ? omniItems()[omniSelection] : null };
}
