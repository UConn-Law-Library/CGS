import { escapeHtml } from "./reader.js";
import { parseRoute, guideRouteHref } from "./routes.js";

const FEEDBACK_ENDPOINT = "https://formsubmit.co/lawlibraryadministration@uconn.edu";

const svgIcon = (paths) => `<svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths}</svg>`;
export const icons = {
  document: svgIcon(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>`),
  scale: svgIcon(`<path d="M12 3v18M8 21h8M5 7h14"/><path d="M2 15l3-8 3 8M16 15l3-8 3 8"/><path d="M2 15a3 3 0 0 0 6 0M16 15a3 3 0 0 0 6 0"/>`),
  bookmark: svgIcon(`<path d="M6 3h12v18l-6-4-6 4z"/>`),
  help: svgIcon(`<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>`),
  bookmarkFilled: svgIcon(`<path d="M6 3h12v18l-6-4-6 4z" fill="currentColor"/>`)
};

export const bookmarkButtonLabel = (saved) => `<span aria-hidden="true">${saved ? icons.bookmarkFilled : icons.bookmark}</span>${saved ? "Saved" : "Bookmark"}`;

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

function settingsPanel() {
  const pwaState = getPwaState();
  const preferences = deviceState.preferences();
  const bookmarkCount = deviceState.bookmarks().length;
  const recentCount = deviceState.recents().length;
  const searchHistoryCount = deviceState.searchHistory().length;
  return `<section class="settings-panel" role="dialog" aria-label="Settings" data-settings-panel hidden>
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
    <label class="setting-row"><span><strong>Compact lists</strong><small>Show more items on screen</small></span><input type="checkbox" data-compact-lists${preferences.compactLists ? " checked" : ""}></label>
    <label class="setting-row"><span><strong>Hide repealed sections</strong><small>Remove them from chapter navigation</small></span><input type="checkbox" data-hide-repealed${preferences.hideRepealedSections ? " checked" : ""}></label>
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
        ${navLink({ href: "#/infractions", id: "infractions", icon: icons.scale, label: "Infractions" }, active)}
        ${navLink({ href: "#/acts", id: "acts", icon: icons.document, label: "Acts" }, active)}
        ${navLink({ href: "#/bookmarks", id: "bookmarks", icon: icons.bookmark, label: "Bookmarks", badge: bookmarkCount }, active)}
        <button type="button" data-open-settings aria-expanded="false"${active === "settings" ? ` aria-current="page"` : ""}><span aria-hidden="true">⚙</span><span>Settings</span></button>
      </nav>
    </div>
    <form class="global-search" data-global-search role="search">
      <button type="button" class="navigation-back" data-go-back aria-label="Go back" title="Go back to the previous page"${navigationHistory.canGoBack ? "" : " disabled"}><span aria-hidden="true">←</span><span class="back-label"> Back</span></button>
      <label class="visually-hidden" for="global-query">Search statutes, acts, index topics, and infractions</label>
      <div class="global-search-field">
        <input id="global-query" name="query" type="search" minlength="2" required value="${escapeHtml(searchValue)}" placeholder="Search statutes, acts, index, and infractions" autocomplete="off" spellcheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="omni-results" data-omni-input>
        <kbd class="omni-shortcut" aria-hidden="true">/</kbd>
        <div class="omni-panel" id="omni-results" role="listbox" hidden data-omni-panel></div>
      </div>
      <button type="submit" class="global-search-button">Search</button>
      <a class="navigation-history" href="#/history"${route.kind === "history" ? ' aria-current="page"' : ""}>History</a>
    </form>
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

  return { siteHeader, updatePwaControls };
}
