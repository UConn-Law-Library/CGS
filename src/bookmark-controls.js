import { temporaryBookmarkMessage } from "./bookmark-page.js";

export function bindBookmarkControls({ state, render, buttonLabel, root = document }) {
  const announce = (message, button) => {
    let status = root.querySelector("[data-bookmark-status]") ?? button?.closest(".provision")?.querySelector(".action-status");
    if (!status) {
      status = document.createElement("p");
      status.setAttribute("role", "status");
      status.dataset.bookmarkStatus = "";
      (button?.parentElement ?? root.querySelector("main"))?.append(status);
    }
    if (status) status.textContent = message;
  };
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-export-bookmarks]")) {
      const url = URL.createObjectURL(new Blob([state.exportBookmarks()], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "cgs-bookmarks.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (button.matches("[data-import-bookmarks]")) {
      root.querySelector("[data-bookmark-file]").click();
    } else if (button.matches("[data-remove-bookmark]")) {
      state.removeBookmark(button.dataset.removeBookmark);
      render();
      root.querySelector("[data-import-bookmarks]")?.focus();
    } else if (button.matches("[data-bookmark-id]")) {
      const { saved, persisted } = state.toggleBookmark({
        id: button.dataset.bookmarkId, type: button.dataset.bookmarkType,
        title: button.dataset.bookmarkTitle, subtitle: button.dataset.bookmarkSubtitle,
        href: button.dataset.bookmarkHref
      });
      button.setAttribute("aria-pressed", String(saved));
      button.innerHTML = buttonLabel(saved);
      root.querySelectorAll(".nav-badge").forEach((badge) => {
        const count = state.bookmarks().length;
        badge.textContent = String(count);
        badge.setAttribute("aria-label", `${count} saved bookmark${count === 1 ? "" : "s"}`);
      });
      const clear = root.querySelector("[data-clear-bookmarks]");
      if (clear) {
        const count = state.bookmarks().length;
        clear.disabled = !count;
        clear.querySelector("small").textContent = count ? `${count} saved` : "None saved";
      }
      announce(persisted ? saved ? "Bookmark saved on this device." : "Bookmark removed." : temporaryBookmarkMessage, button);
    }
  });
  root.addEventListener("change", async (event) => {
    if (!event.target.matches("[data-bookmark-file]")) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Choose a bookmark file smaller than 2 MB.");
      const result = state.importBookmarks(await file.text());
      if (!event.target.isConnected) return;
      render();
      announce(`${result.added} bookmarks imported.${result.persisted ? "" : ` ${temporaryBookmarkMessage}`}`);
    } catch (error) {
      announce(`Bookmarks could not be imported. ${error.message}`);
    }
    root.querySelector("[data-import-bookmarks]")?.focus();
  });
}
