const BOOKMARKS_KEY = "cgs.bookmarks.v1";
const PREFERENCES_KEY = "cgs.preferences.v1";
const RECENTS_KEY = "cgs.recents.v1";
const RECENT_LIMIT = 20;

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "auto",
  textScale: 1,
  compactLists: true,
  hideRepealedSections: false
});

const themes = new Set(["auto", "light", "dark", "oled"]);

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export class DeviceState {
  #storage;

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
      this.#storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Browsing remains available when storage is unavailable or full.
    }
  }

  bookmarks() {
    const value = this.#read(BOOKMARKS_KEY, []);
    return Array.isArray(value) ? value.filter((item) => item?.id && item?.href) : [];
  }

  isBookmarked(id) {
    return this.bookmarks().some((item) => item.id === id);
  }

  toggleBookmark(bookmark) {
    const values = this.bookmarks();
    const index = values.findIndex((item) => item.id === bookmark.id);
    if (index === -1) values.unshift(bookmark);
    else values.splice(index, 1);
    this.#write(BOOKMARKS_KEY, values);
    return index === -1;
  }

  removeBookmark(id) {
    this.#write(BOOKMARKS_KEY, this.bookmarks().filter((item) => item.id !== id));
  }

  clearBookmarks() {
    this.#write(BOOKMARKS_KEY, []);
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

  preferences() {
    const value = this.#read(PREFERENCES_KEY, {});
    const theme = themes.has(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme;
    const textScale = Math.min(1.25, Math.max(.85, Number(value.textScale) || 1));
    return {
      theme,
      textScale,
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
    value.compactLists = Boolean(value.compactLists);
    value.hideRepealedSections = Boolean(value.hideRepealedSections);
    this.#write(PREFERENCES_KEY, value);
    return value;
  }
}

export function applyPreferences(preferences, root = document.documentElement) {
  root.dataset.theme = preferences.theme;
  root.dataset.compactLists = String(preferences.compactLists);
  root.dataset.hideRepealedSections = String(preferences.hideRepealedSections);
  root.style.setProperty("--text-scale", String(preferences.textScale));
}
