import { escapeHtml } from "./reader.js";

export const temporaryBookmarkMessage = "Browser storage is unavailable. These bookmark changes are temporary and will be lost when this page is reloaded or closed. Export bookmarks to keep a copy.";

export function renderBookmarkPage(state, header) {
  const bookmarks = state.bookmarks();
  return `${header}<main class="bookmarks-page" id="main-content">
    <header><p class="eyebrow">Your bookmarks</p><h1>Bookmarks</h1><p>Quick links stay in this browser and are never sent to a server. Export a copy to move them to another device.</p></header>
    <div class="section-actions"><button type="button" data-export-bookmarks>Export bookmarks</button>
      <button type="button" data-import-bookmarks>Import bookmarks</button>
      <input type="file" accept="application/json,.json" data-bookmark-file hidden aria-label="Bookmark file"></div>
    <p role="status" data-bookmark-status>${state.bookmarksPersisted ? "" : temporaryBookmarkMessage}</p>
    ${bookmarks.length ? `<ol class="bookmark-list">${bookmarks.map((bookmark) => `<li><a href="${escapeHtml(bookmark.href)}"><span>${bookmark.type === "infraction" ? "Infraction" : "Statute"}</span><strong>${escapeHtml(bookmark.title)}</strong><small>${escapeHtml(bookmark.subtitle ?? "")}</small></a><button type="button" data-remove-bookmark="${escapeHtml(bookmark.id)}" aria-label="Remove ${escapeHtml(bookmark.title)} from bookmarks">Remove</button></li>`).join("")}</ol>` : '<div class="empty-state"><p>You have not saved any bookmarks.</p><p>Select <strong>Bookmark</strong> on a statute section or infraction to save it here.</p></div>'}
  </main><footer>Bookmarks are stored only on this device.</footer>`;
}
