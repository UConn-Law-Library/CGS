import { escapeHtml } from "./reader.js";
import { parseRoute, guideRouteHref, titlesRouteHref } from "./routes.js";
import { HIDEABLE_STATUSES, READING_WIDTHS } from "./device-state.js";

const HIDEABLE_STATUS_LABELS = { repealed: "Repealed", transferred: "Transferred", obsolete: "Obsolete", reserved: "Reserved" };

const FEEDBACK_ENDPOINT = "https://formsubmit.co/lawlibraryadministration@uconn.edu";

// Phones have no titles pane beside Home, so the Statutes tab opens the title list directly.
// The brand still links to Home. app.js updates the link when the layout changes.
export function statutesNavHref() {
  return matchMedia("(max-width: 60rem)").matches ? titlesRouteHref() : "#/";
}

const svgIcon = (paths) => `<svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths}</svg>`;
export const icons = {
  search: svgIcon('<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>'),
  settings: svgIcon(`<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface-raised)"/><circle cx="15" cy="17" r="3" fill="var(--surface-raised)"/>`),
  document: svgIcon(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>`),
  scale: svgIcon(`<path d="M12 3v18M8 21h8M5 7h14"/><path d="M2 15l3-8 3 8M16 15l3-8 3 8"/><path d="M2 15a3 3 0 0 0 6 0M16 15a3 3 0 0 0 6 0"/>`),
  bookmark: svgIcon(`<path d="M6 3h12v18l-6-4-6 4z"/>`),
  help: svgIcon(`<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>`),
  // Untitled UI Icons: copy-03, link-01, share-06, mail-01, bookmark-add, bookmark-check, check.
  share: svgIcon(`<path d="M20.791 12.607c.244-.209.366-.313.411-.438a.5.5 0 0 0 0-.338c-.045-.124-.167-.23-.41-.438L12.32 4.132c-.42-.36-.63-.54-.809-.545a.5.5 0 0 0-.4.184C11 3.91 11 4.186 11 4.74v4.296a9.666 9.666 0 0 0-8 9.516v.612a11.401 11.401 0 0 1 8-4.093v4.19c0 .554 0 .83.112.969a.5.5 0 0 0 .4.184c.178-.005.388-.185.809-.545l8.47-7.26Z"/>`),
  copy: svgIcon(`<path d="M8 8V5.2c0-1.12 0-1.68.218-2.108a2 2 0 0 1 .874-.874C9.52 2 10.08 2 11.2 2h7.6c1.12 0 1.68 0 2.108.218a2 2 0 0 1 .874.874C22 3.52 22 4.08 22 5.2v7.6c0 1.12 0 1.68-.218 2.108a2 2 0 0 1-.874.874C20.48 16 19.92 16 18.8 16H16M5.2 22h7.6c1.12 0 1.68 0 2.108-.218a2 2 0 0 0 .874-.874C16 20.48 16 19.92 16 18.8v-7.6c0-1.12 0-1.68-.218-2.108a2 2 0 0 0-.874-.874C14.48 8 13.92 8 12.8 8H5.2c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C2 9.52 2 10.08 2 11.2v7.6c0 1.12 0 1.68.218 2.108a2 2 0 0 0 .874.874C3.52 22 4.08 22 5.2 22Z"/>`),
  link: svgIcon(`<path d="m12.708 18.364-1.415 1.414a5 5 0 1 1-7.07-7.07l1.413-1.415m12.728 1.414 1.415-1.414a5 5 0 0 0-7.071-7.071l-1.415 1.414M8.5 15.5l7-7"/>`),
  mail: svgIcon(`<path d="m2 7 8.165 5.715c.661.463.992.695 1.351.784a2 2 0 0 0 .968 0c.36-.09.69-.32 1.351-.784L22 7M6.8 20h10.4c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311C22 17.72 22 16.88 22 15.2V8.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C19.72 4 18.88 4 17.2 4H6.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C2 6.28 2 7.12 2 8.8v6.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C4.28 20 5.12 20 6.8 20Z"/>`),
  bookmarkAdd: svgIcon(`<path d="M12 13V7m-3 3h6m4 11V7.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C16.72 3 15.88 3 14.2 3H9.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C5 5.28 5 6.12 5 7.8V21l7-4 7 4Z"/>`),
  copied: svgIcon(`<path d="M20 6 9 17l-5-5"/>`),
  bookmarkCheck: svgIcon(`<path class="bookmark-shape" d="M19 21V7.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C16.72 3 15.88 3 14.2 3H9.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C5 5.28 5 6.12 5 7.8V21l7-4 7 4Z"/><path class="bookmark-check" d="m9 10.5 2 2L15.5 8"/>`)
};

export const bookmarkButtonLabel = (saved) => `<span aria-hidden="true">${saved ? icons.bookmarkCheck : icons.bookmarkAdd}</span><span class="action-label">${saved ? "Saved" : "Bookmark"}</span>`;
// An icon-only action. The label names it for screen readers and appears as its tooltip.
export const iconActionLabel = (icon, label) => `<span aria-hidden="true">${icon}</span><span class="action-label">${label}</span>`;

export function createShell({ deviceState, navigationHistory, getPwaState }) {
function activeDestination(route = parseRoute(location)) {
  if (route.kind === "index") return "index";
  if (route.kind === "infractions") return "infractions";
  if (route.kind === "acts" || route.kind === "act") return "acts";
  if (route.kind === "bookmarks") return "bookmarks";
  if (route.kind === "about") return "settings";
  // Reached from Home, Settings, About, and Acts; no tab claims it.
  if (route.kind === "guide") return "guide";
  if (route.kind === "history") return "history";
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
  if (state.complete && state.compatibility?.compatible === false) return `${state.cachedFiles.toLocaleString()} files available offline; repair required`;
  if (state.complete) return `${state.cachedFiles.toLocaleString()} files available offline`;
  if (state.ready) return "Download the complete published dataset";
  return state.supported ? "Preparing offline storage…" : "Offline storage is unavailable";
}

function persistenceStatus(state) {
  if (!state.persistentStorageSupported) return "Persistent storage is not supported by this browser.";
  if (state.persistentStorageGranted === true) return "Persistent browser storage is granted.";
  if (state.persistentStorageGranted === false) return "Your browser may delete downloaded data when it needs more space.";
  return "Persistent storage will be requested when offline data is downloaded.";
}

function revisionValue(value) {
  return value ? escapeHtml(String(value)) : "Not reported";
}

function offlineRevisionMarkup(state) {
  const current = state.currentRelease;
  const currentRows = current ? `<dt>Application shell</dt><dd>${revisionValue(current.shellBuildId)}</dd>
    <dt>Expected corpus</dt><dd>${revisionValue(current.corpus?.generatedAt)} · schema ${revisionValue(current.corpus?.schemaVersion)}</dd>` : "";
  if (!state.complete) {
    return `<dl class="offline-release-list">${currentRows || "<dt>Application release</dt><dd>Available after the offline worker is ready.</dd>"}</dl>`;
  }
  const supplementRows = (state.supplements ?? []).map((edition) =>
    `<dt>${escapeHtml(String(edition.editionYear))} supplement</dt><dd>${revisionValue(edition.generatedAt)} · schema ${revisionValue(edition.schemaVersion)}</dd>`
  ).join("");
  const verification = state.verifiedFiles
    ? `${state.verifiedFiles.toLocaleString()} artifacts (${escapeHtml(formatStorage(state.verifiedBytes) ?? `${state.verifiedBytes} bytes`)})`
    : "Not recorded by this offline data format";
  return `<dl class="offline-release-list">
    ${currentRows}
    <dt>Downloaded</dt><dd>${revisionValue(state.downloadedAt)}</dd>
    <dt>Downloaded by shell</dt><dd>${revisionValue(state.shellBuildId)}</dd>
    <dt>Corpus</dt><dd>${revisionValue(state.corpus?.generatedAt)} · schema ${revisionValue(state.corpus?.schemaVersion)}</dd>
    <dt>Secondary sources</dt><dd>${revisionValue(state.secondary?.generatedAt)} · schema ${revisionValue(state.secondary?.schemaVersion)}</dd>
    <dt>Search index</dt><dd>${revisionValue(state.search?.generatedAt)} · schema ${revisionValue(state.search?.schemaVersion)}</dd>
    ${supplementRows}
    <dt>SHA-256 verified</dt><dd>${verification}</dd>
  </dl>`;
}

function offlineCompatibilityWarning(state) {
  if (state.compatibility?.compatible !== false) return "";
  return `${state.compatibility.reason ?? "The downloaded corpus is incompatible with this application release."} Repair offline data before relying on offline access.`;
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
  const pwaState = getPwaState();
  const install = document.querySelector("[data-install-app]");
  const download = document.querySelector("[data-download-offline]");
  const repair = document.querySelector("[data-repair-offline]");
  const clear = document.querySelector("[data-clear-offline]");
  const status = document.querySelector("[data-pwa-status]");
  const persistence = document.querySelector("[data-persistence-status]");
  const storage = document.querySelector("[data-storage-status]");
  const release = document.querySelector("[data-offline-release]");
  const warning = document.querySelector("[data-offline-compatibility]");
  const update = document.querySelector("[data-apply-update]");
  const progress = document.querySelector("[data-pwa-progress]");
  if (!install) return;
  install.disabled = pwaState.installed || !pwaState.installable;
  install.querySelector("small").textContent = installStatus(pwaState);
  download.disabled = !pwaState.ready || pwaState.busy;
  download.querySelector("[data-offline-action-label]").textContent = pwaState.complete ? "Refresh offline data" : "Download for offline use";
  repair.disabled = !pwaState.ready || pwaState.busy || !pwaState.complete;
  clear.disabled = !pwaState.cachedFiles || pwaState.busy;
  status.textContent = offlineStatus(pwaState);
  persistence.textContent = persistenceStatus(pwaState);
  storage.textContent = storageStatus(pwaState);
  release.innerHTML = offlineRevisionMarkup(pwaState);
  const warningText = offlineCompatibilityWarning(pwaState);
  warning.hidden = !warningText;
  warning.textContent = warningText;
  update.hidden = !pwaState.updateAvailable;
  progress.hidden = !pwaState.busy || !pwaState.totalFiles;
  progress.max = Math.max(1, pwaState.totalFiles);
  progress.value = pwaState.cachedFiles;
}

function navigationSettingRows(idPrefix) {
  const preferences = deviceState.preferences();
  const switchRow = (setting, label, hint, checked) => {
    const id = `${idPrefix}-${setting}`;
    return `<label class="setting-row"><span><strong id="${id}-label">${label}</strong><small id="${id}-hint">${hint}</small></span><input class="setting-switch" type="checkbox" role="switch" data-${setting} aria-labelledby="${id}-label" aria-describedby="${id}-hint"${checked ? " checked" : ""}></label>`;
  };
  return `${switchRow("compact-lists", "Compact lists", "Show only title, chapter, and section numbers in statute lists", preferences.compactLists)}
    <fieldset class="setting-row hidden-status-setting"><legend><strong>Hide sections</strong><small>Remove these from chapter navigation</small></legend><div class="hidden-status-options">${HIDEABLE_STATUSES.map((status) => `<label>${HIDEABLE_STATUS_LABELS[status]}<input class="setting-switch" type="checkbox" role="switch" data-hide-status="${status}"${preferences.hiddenStatuses.includes(status) ? " checked" : ""}></label>`).join("")}</div></fieldset>
    ${switchRow("subtle-notices", "Subtle notices", "Show status tags as colored dots in section lists", preferences.subtleNotices)}
    ${switchRow("navigation-tree", "Page tree navigation", "Browse statute titles, chapters, and sections in an expandable tree", preferences.navigationTree)}`;
}

// Where a side panel is showing, these settings open from its heading instead of Settings.
function navigationSettingsButton() {
  return `<button type="button" class="navigation-settings-button" data-open-navigation-settings aria-haspopup="dialog" aria-expanded="false" aria-controls="navigation-settings" aria-label="Navigation settings" title="Navigation settings"><span aria-hidden="true">${icons.settings}</span></button>`;
}

function navigationSettingsPanel() {
  return `<section class="settings-panel navigation-settings-panel" id="navigation-settings" role="dialog" aria-label="Navigation settings" data-navigation-settings hidden>
    <div class="settings-heading"><strong>Navigation settings</strong><button type="button" class="icon-button" data-close-navigation-settings aria-label="Close navigation settings">×</button></div>
    ${navigationSettingRows("pane-settings")}
  </section>`;
}

function settingsPanel() {
  const pwaState = getPwaState();
  const preferences = deviceState.preferences();
  const bookmarkCount = deviceState.bookmarks().length;
  const recentCount = deviceState.recents().length;
  const searchHistoryCount = deviceState.searchHistory().length;
  return `<section class="settings-panel" id="app-settings" role="dialog" aria-label="Settings" data-settings-panel hidden>
    <div class="settings-heading"><strong>Settings</strong><button type="button" class="icon-button" data-close-settings aria-label="Close settings">×</button></div>
    <div class="setting-group"><span>Theme</span><div class="segmented" role="group" aria-label="Theme">
      ${Object.entries({ auto: "Auto", light: "Light", dark: "Dark", oled: "OLED" }).map(([theme, label]) => `<button type="button" data-theme-value="${theme}" aria-pressed="${preferences.theme === theme}">${label}</button>`).join("")}
    </div></div>
    <div class="setting-group typography-setting"><label for="font-profile">Font</label><select id="font-profile" data-font-profile>
      <option value="default"${preferences.fontProfile === "default" ? " selected" : ""}>Default</option>
      <option value="atkinson"${preferences.fontProfile === "atkinson" ? " selected" : ""}>Atkinson Hyperlegible Font</option>
      <option value="lexend"${preferences.fontProfile === "lexend" ? " selected" : ""}>Lexend</option>
      <option value="inclusive"${preferences.fontProfile === "inclusive" ? " selected" : ""}>Inclusive Sans</option>
    </select></div>
    <div class="setting-group typography-setting"><div class="setting-row-label"><label for="text-size">Text size</label><output for="text-size" data-text-size-value>${Math.round(preferences.textScale * 100)}%</output></div>
      <input id="text-size" type="range" min="0.85" max="1.25" step="0.05" value="${preferences.textScale}" data-text-size>
    </div>
    <div class="setting-group typography-setting"><div class="setting-row-label"><label for="line-spacing">Line spacing</label><output for="line-spacing" data-line-spacing-value>${preferences.lineSpacing.toFixed(2)}×</output></div>
      <input id="line-spacing" type="range" min="1.2" max="2.2" step="0.05" value="${preferences.lineSpacing}" data-line-spacing>
    </div>
    <div class="setting-group reading-width-setting"><span>Reading width</span><div class="segmented" role="group" aria-label="Reading width">
      ${Object.entries(READING_WIDTHS).map(([width, label]) => `<button type="button" data-reading-width-value="${width}" aria-pressed="${preferences.readingWidth === width}">${label}</button>`).join("")}
    </div></div>
    <div class="navigation-setting-rows">${navigationSettingRows("app-settings")}</div>
    <button type="button" class="settings-action update-action" data-apply-update${pwaState.updateAvailable ? "" : " hidden"}>Update available <small>Reload to use the latest published app</small></button>
    <a class="settings-action" href="#/about"><strong class="settings-about-title">About this app</strong> <small>Sources, coverage, and project information</small></a>
    <a class="settings-action" href="${guideRouteHref()}"><strong class="settings-about-title">Understanding the Statutes</strong> <small>How laws are enacted, codified, and published</small></a>
    <details class="install-app-menu"><summary>Install App</summary>
    <button type="button" class="settings-action" data-install-app${pwaState.installed || !pwaState.installable ? " disabled" : ""}>Install app <small>${escapeHtml(installStatus(pwaState))}</small></button>
    <button type="button" class="settings-action" data-download-offline${!pwaState.ready || pwaState.busy ? " disabled" : ""}><span data-offline-action-label>${pwaState.complete ? "Refresh offline data" : "Download for offline use"}</span><small>Statutes, supplements, search, index, infractions, and acts</small></button>
    <progress class="offline-progress" data-pwa-progress value="${pwaState.cachedFiles}" max="${Math.max(1, pwaState.totalFiles)}"${!pwaState.busy || !pwaState.totalFiles ? " hidden" : ""}>Offline download progress</progress>
    <button type="button" class="settings-action" data-repair-offline${!pwaState.ready || pwaState.busy || !pwaState.complete ? " disabled" : ""}>Repair offline data <small>Download every file again and check for errors</small></button>
    <button type="button" class="settings-action" data-clear-offline${!pwaState.cachedFiles || pwaState.busy ? " disabled" : ""}>Remove offline data <small>Keep the installed app</small></button>
    <p class="offline-compatibility-warning" data-offline-compatibility role="alert"${offlineCompatibilityWarning(pwaState) ? "" : " hidden"}>${escapeHtml(offlineCompatibilityWarning(pwaState))}</p>
    <p class="settings-note" data-pwa-status role="status" aria-live="polite">${escapeHtml(offlineStatus(pwaState))}</p>
    <p class="settings-note" data-persistence-status>${escapeHtml(persistenceStatus(pwaState))}</p>
    <p class="settings-note" data-storage-status>${escapeHtml(storageStatus(pwaState))}</p>
    <details class="offline-release-details"><summary>Offline release details</summary><div data-offline-release>${offlineRevisionMarkup(pwaState)}</div></details>
    </details>
    <details class="clear-data-menu"><summary>Clear Data</summary>
      <button type="button" class="settings-action" data-clear-bookmarks${bookmarkCount ? "" : " disabled"}>Clear bookmarks <small>${bookmarkCount ? `${bookmarkCount} saved` : "None saved"}</small></button>
      <button type="button" class="settings-action" data-clear-recents${recentCount ? "" : " disabled"}>Clear recent history <small>${recentCount ? `${recentCount} item${recentCount === 1 ? "" : "s"}` : "No recent history"}</small></button>
      <button type="button" class="settings-action" data-clear-search-history${searchHistoryCount ? "" : " disabled"}>Clear search history <small>${searchHistoryCount ? `${searchHistoryCount} search${searchHistoryCount === 1 ? "" : "es"}` : "No search history"}</small></button>
    </details>
    <button type="button" class="settings-action feedback-action" data-open-feedback>Submit feedback <small>Share a comment with the Law Library</small></button>
  </section>`;
}

function backButton() {
  return `<button type="button" class="navigation-back" data-go-back aria-label="Go back" title="Go back to the previous page"${navigationHistory.canGoBack ? "" : " disabled"}><span aria-hidden="true">←</span><span class="back-label"> Back</span></button>`;
}

function historyLink(route) {
  return `<a class="navigation-history" href="#/history"${route.kind === "history" ? ' aria-current="page"' : ""}><span class="utility-label">History</span><span class="mobile-utility-icon" aria-hidden="true">${svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}</span></a>`;
}

// Opens the guided tour of recent changes (whats-new.js).
function whatsNewButton() {
  return `<button type="button" class="navigation-history whats-new-button" data-open-whats-new><span class="utility-label">What's new</span><span class="mobile-utility-icon" aria-hidden="true">${svgIcon('<path d="M12 3l1.8 4.9L19 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5 9.7l4.9-1.8z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>')}</span></button>`;
}

function globalSearch(route) {
  return `<form class="global-search" data-global-search role="search">
      ${backButton()}
      <label class="visually-hidden" for="global-query">Search statutes, acts, index topics, and infractions</label>
      <div class="global-search-field">
        <input id="global-query" name="query" type="search" minlength="2" required placeholder="Citation or keywords" autocomplete="off" spellcheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="omni-results" data-omni-input>
        <kbd class="omni-shortcut" aria-hidden="true">/</kbd>
        <div class="omni-panel" id="omni-results" role="listbox" hidden data-omni-panel></div>
      </div>
      <button type="submit" class="global-search-button"><span class="utility-label">Search</span><span class="mobile-utility-icon" aria-hidden="true">${icons.search}</span></button>
      ${historyLink(route)}
      ${whatsNewButton()}
    </form>`;
}

// The search page has its own query box. This row keeps the header the same height there,
// so moving between pages does not shift the content.
function headerUtilities(route) {
  return `<div class="global-search header-utilities">${backButton()}${historyLink(route)}${whatsNewButton()}</div>`;
}

function siteHeader() {
  const route = parseRoute(location);
  const active = activeDestination(route);
  const bookmarkCount = deviceState.bookmarks().length;
  return `<header class="site-header">
    <div class="header-bar">
      <div class="header-identity">
        <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">§</span><span><small class="brand-library">UConn Law Library</small>Connecticut General Statutes</span></a>
      </div>
      <div class="header-actions">
        <nav class="app-nav" aria-label="Main sections">
          ${navLink({ href: statutesNavHref(), id: "statutes", icon: "§", label: "Statutes" }, active)}
          ${navLink({ href: "#/index", id: "index", icon: "A–Z", label: "Index" }, active)}
          ${navLink({ href: "#/infractions", id: "infractions", icon: icons.scale, label: "Infractions" }, active)}
          ${navLink({ href: "#/acts", id: "acts", icon: icons.document, label: "Acts" }, active)}
          ${navLink({ href: "#/bookmarks", id: "bookmarks", icon: icons.bookmark, label: "Bookmarks", badge: bookmarkCount }, active)}
        </nav>
        <button type="button" class="header-settings-button" data-open-settings aria-label="Settings" aria-controls="app-settings" aria-expanded="false"${active === "settings" ? ` aria-current="page"` : ""}><span aria-hidden="true">${icons.settings}</span><span class="settings-label">Settings</span></button>
      </div>
    </div>
    ${route.kind === "search" ? headerUtilities(route) : globalSearch(route)}
    ${settingsPanel()}
  </header><dialog class="clear-data-dialog" data-clear-data-dialog aria-labelledby="clear-data-title">
    <h2 id="clear-data-title">Clear data?</h2><p data-clear-data-message></p>
    <div class="clear-data-dialog-actions"><button type="button" data-cancel-clear>Cancel</button><button type="button" data-confirm-clear>Clear data</button></div>
  </dialog><dialog class="feedback-dialog" data-feedback-dialog aria-labelledby="feedback-title">
    <h2 id="feedback-title">Submit feedback</h2>
    <form action="${FEEDBACK_ENDPOINT}" method="POST" data-feedback-form>
      <input type="hidden" name="_subject" value="Connecticut General Statutes feedback">
      <label for="feedback-name">Name</label><input id="feedback-name" name="name" type="text" autocomplete="name" maxlength="120" required>
      <label for="feedback-email">Email</label><input id="feedback-email" name="email" type="email" autocomplete="email" maxlength="254" required>
      <label for="feedback-message">Feedback</label><textarea id="feedback-message" name="message" rows="6" maxlength="5000" required></textarea>
      <p class="feedback-status" data-feedback-status role="status"></p>
      <div class="feedback-dialog-actions"><button type="button" data-close-feedback>Cancel</button><button type="submit">Send feedback</button></div>
    </form>
  </dialog>`;
}

  return { siteHeader, navigationSettingsButton, navigationSettingsPanel, updatePwaControls };
}
