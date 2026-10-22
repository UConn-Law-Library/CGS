const BOOKMARKS_KEY = "cgs.bookmarks.v1";
const PREFERENCES_KEY = "cgs.preferences.v1";
const RECENTS_KEY = "cgs.recents.v1";
const SEARCH_HISTORY_KEY = "cgs.search-history.v1";
const PAGE_HISTORY_KEY = "cgs.page-history.v1";
const NAVIGATION_LAYOUT_KEY = "cgs.navigation-layout.v1";
const PAGE_HISTORY_LIMIT = 100;
const RECENT_LIMIT = 20;
const SEARCH_HISTORY_LIMIT = 20;

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "auto",
  textScale: 1,
  fontProfile: "default",
  lineSpacing: 1.55,
  compactLists: true,
  hideRepealedSections: false
});

const themes = new Set(["auto", "light", "dark", "oled"]);
const fontProfiles = new Set(["default", "atkinson", "lexend", "inclusive"]);

function normalizeLineSpacing(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_PREFERENCES.lineSpacing;
  const spacing = Number(value);
  return Number.isFinite(spacing) ? Math.round(Math.min(2.2, Math.max(1.2, spacing)) * 20) / 20 : DEFAULT_PREFERENCES.lineSpacing;
}

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function validBookmark(item) {
  return item && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 1000
    && ["statute", "infraction"].includes(item.type)
    && typeof item.title === "string" && item.title.length > 0 && item.title.length <= 5000
    && typeof item.href === "string" && /^#\/(?:t\/|infractions(?:[/?]|$))/.test(item.href)
    && item.href.length <= 5000;
}

export class DeviceState {
  #storage;
  #pageHistory = [];
  #temporaryBookmarks = null;
  bookmarksPersisted = true;

  constructor({ storage } = {}) {
    try {
      this.#storage = storage ?? globalThis.localStorage;
    } catch {
      this.#storage = null;
    }
  }

  #read(key, fallback) {
    try {
      return safeParse(this.#storage?.getItem(key), fallback);
    } catch {
      return fallback;
    }
  }

  #write(key, value) {
    try {
      if (!this.#storage) return false;
      this.#storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Browsing remains available when storage is unavailable or full.
      return false;
    }
  }

  bookmarks() {
    const value = this.#temporaryBookmarks ?? this.#read(BOOKMARKS_KEY, []);
    return Array.isArray(value) ? value.filter(validBookmark).map((item) => ({ ...item })) : [];
  }

  #saveBookmarks(values) {
    this.bookmarksPersisted = this.#write(BOOKMARKS_KEY, values);
    this.#temporaryBookmarks = this.bookmarksPersisted ? null : values;
    return this.bookmarksPersisted;
  }

  exportBookmarks() {
    return JSON.stringify({ format: "cgs-bookmarks", version: 1, bookmarks: this.bookmarks() }, null, 2);
  }

  importBookmarks(text) {
    if (typeof text !== "string" || text.length > 2_000_000) throw new Error("Choose a bookmark file smaller than 2 MB.");
    const data = JSON.parse(text);
    if (data?.format !== "cgs-bookmarks" || data.version !== 1 || !Array.isArray(data.bookmarks)
      || data.bookmarks.length > 5000 || !data.bookmarks.every(validBookmark)) {
      throw new Error("This is not a supported CGS bookmark file.");
    }
    const merged = new Map(this.bookmarks().map((item) => [item.id, item]));
    let added = 0;
    for (const item of data.bookmarks) {
      if (merged.has(item.id)) continue;
      merged.set(item.id, { id: item.id, type: item.type, title: item.title, subtitle: String(item.subtitle ?? ""), href: item.href });
      added++;
    }
    const persisted = this.#saveBookmarks([...merged.values()]);
    return { added, persisted };
  }

  isBookmarked(id) {
    return this.bookmarks().some((item) => item.id === id);
  }

  toggleBookmark(bookmark) {
    if (!validBookmark(bookmark)) throw new Error("Invalid bookmark.");
    const values = this.bookmarks();
    const index = values.findIndex((item) => item.id === bookmark.id);
    if (index === -1) values.unshift(bookmark);
    else values.splice(index, 1);
    const persisted = this.#saveBookmarks(values);
    return { saved: index === -1, persisted };
  }

  removeBookmark(id) {
    return this.#saveBookmarks(this.bookmarks().filter((item) => item.id !== id));
  }

  clearBookmarks() {
    return this.#saveBookmarks([]);
  }

  recents() {
    const value = this.#read(RECENTS_KEY, []);
    return Array.isArray(value)
      ? value.filter((item) => item?.id && item?.type && item?.title && item?.href && item?.viewedAt)
        .sort((left, right) => String(right.viewedAt).localeCompare(String(left.viewedAt)))
        .slice(0, RECENT_LIMIT)
      : [];
  }

  recordRecent(item) {
    if (!item?.id || !item?.type || !item?.title || !item?.href) return this.recents();
    const recent = {
      id: String(item.id),
      type: String(item.type),
      title: String(item.title),
      subtitle: String(item.subtitle ?? ""),
      href: String(item.href),
      viewedAt: item.viewedAt ?? new Date().toISOString()
    };
    const values = [recent, ...this.recents().filter((value) => value.id !== recent.id)]
      .sort((left, right) => String(right.viewedAt).localeCompare(String(left.viewedAt)))
      .slice(0, RECENT_LIMIT);
    this.#write(RECENTS_KEY, values);
    return values;
  }

  clearRecents() {
    this.#write(RECENTS_KEY, []);
  }

  pageHistory() {
    const value = this.#read(PAGE_HISTORY_KEY, this.#pageHistory);
    return Array.isArray(value) ? value.filter((item) =>
      typeof item?.href === "string" && item.href.startsWith("#/")
      && typeof item.title === "string" && item.title
      && typeof item.viewedAt === "string" && Number.isFinite(Date.parse(item.viewedAt))
    ).slice(0, PAGE_HISTORY_LIMIT) : [];
  }

  recordPage({ href, title, viewedAt = new Date().toISOString() }) {
    if (typeof href !== "string" || !href.startsWith("#/") || !title || !Number.isFinite(Date.parse(viewedAt))) return;
    this.#pageHistory = [{ href, title: String(title), viewedAt },
      ...this.pageHistory().filter((item) => item.href !== href)].slice(0, PAGE_HISTORY_LIMIT);
    this.#write(PAGE_HISTORY_KEY, this.#pageHistory);
  }

  clearPageHistory() {
    this.#pageHistory = [];
    this.#write(PAGE_HISTORY_KEY, []);
  }

  searchHistory() {
    const value = this.#read(SEARCH_HISTORY_KEY, []);
    return Array.isArray(value)
      ? value.filter((item) => item?.query && item?.href && item?.searchedAt)
        .sort((left, right) => String(right.searchedAt).localeCompare(String(left.searchedAt)))
        .slice(0, SEARCH_HISTORY_LIMIT)
      : [];
  }

  recordSearch(item) {
    if (!item?.query || !item?.href) return this.searchHistory();
    const search = {
      query: String(item.query),
      description: String(item.description ?? ""),
      href: String(item.href),
      searchedAt: item.searchedAt ?? new Date().toISOString()
    };
    const values = [search, ...this.searchHistory().filter((value) => value.href !== search.href)]
      .sort((left, right) => String(right.searchedAt).localeCompare(String(left.searchedAt)))
      .slice(0, SEARCH_HISTORY_LIMIT);
    this.#write(SEARCH_HISTORY_KEY, values);
    return values;
  }

  clearSearchHistory() {
    this.#write(SEARCH_HISTORY_KEY, []);
  }

  navigationLayout() {
    const value = this.#read(NAVIGATION_LAYOUT_KEY, {});
    return {
      collapsed: value?.collapsed === true,
      widths: Array.from({ length: 3 }, (_, index) => {
        const width = Number(value?.widths?.[index]);
        return Number.isFinite(width) && width >= 144 && width <= 420 ? Math.round(width) : null;
      })
    };
  }

  updateNavigationLayout(changes) {
    const layout = { ...this.navigationLayout(), ...changes };
    layout.collapsed = Boolean(layout.collapsed);
    this.#write(NAVIGATION_LAYOUT_KEY, layout);
    return this.navigationLayout();
  }

  preferences() {
    const value = this.#read(PREFERENCES_KEY, {});
    const theme = themes.has(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme;
    const textScale = Math.min(1.25, Math.max(.85, Number(value.textScale) || 1));
    return {
      theme,
      textScale,
      fontProfile: fontProfiles.has(value.fontProfile) ? value.fontProfile : DEFAULT_PREFERENCES.fontProfile,
      lineSpacing: normalizeLineSpacing(value.lineSpacing),
      compactLists: Object.prototype.hasOwnProperty.call(value, "compactLists")
        ? Boolean(value.compactLists)
        : DEFAULT_PREFERENCES.compactLists,
      hideRepealedSections: Boolean(value.hideRepealedSections)
    };
  }

  updatePreferences(changes) {
    const value = { ...this.preferences(), ...changes };
    if (!themes.has(value.theme)) value.theme = DEFAULT_PREFERENCES.theme;
    value.textScale = Math.min(1.25, Math.max(.85, Number(value.textScale) || 1));
    if (!fontProfiles.has(value.fontProfile)) value.fontProfile = DEFAULT_PREFERENCES.fontProfile;
    value.lineSpacing = normalizeLineSpacing(value.lineSpacing);
    value.compactLists = Boolean(value.compactLists);
    value.hideRepealedSections = Boolean(value.hideRepealedSections);
    this.#write(PREFERENCES_KEY, value);
    return value;
  }
}

export function applyPreferences(preferences, root = document.documentElement) {
  root.dataset.theme = preferences.theme;
  root.dataset.fontProfile = preferences.fontProfile;
  root.dataset.compactLists = String(preferences.compactLists);
  root.dataset.hideRepealedSections = String(preferences.hideRepealedSections);
  root.style.setProperty("--text-scale", String(preferences.textScale));
  root.style.setProperty("--line-spacing", String(preferences.lineSpacing));
  root.style.setProperty("--line-spacing-factor", String(preferences.lineSpacing / DEFAULT_PREFERENCES.lineSpacing));
}
