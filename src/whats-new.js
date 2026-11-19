// A short guided tour that opens example pages and spotlights the relevant controls.
const STEPS = [
  {
    route: "#/t/16a/c/295",
    targets: ["[data-open-navigation-settings]", "[data-open-settings]"],
    panelTargets: ["[data-navigation-settings]", ".navigation-setting-rows"],
    title: "Navigation settings",
    text: "This menu holds Compact lists, Hide sections, and Subtle notices. Page tree navigation puts titles, chapters, and sections in one panel."
  },
  {
    route: "#/t/16a/c/295",
    targets: ["#statute-tree-status"],
    title: "Filter sections by status",
    text: "In the page tree, select one or more statuses to find sections that match any of them. Use the text filter above to narrow the results, or choose Any status to clear your selections.",
    fallback: "Turn on Page tree navigation in Settings to filter the statute tree by status, including Supplement amendments or additions, Recent Public Acts, Repealed, Transferred, Obsolete, or Reserved."
  },
  {
    route: "#/t/16a/c/295",
    targets: ["[data-open-settings]"],
    panelTargets: [".reading-width-setting"],
    desktopOnly: true,
    title: "Reading width",
    text: "Settings has a Reading width option. On larger screens, choose Wide or Widest to fit more of a section on each line."
  },
  {
    route: "#/t/16a/c/295",
    targets: [".chapter-notice"],
    title: "Chapter change summaries",
    text: "A chapter opens with what changed: sections whose text comes from the latest Supplement, in blue, and sections recent Public Acts change, in amber. Open a list to go to a section."
  },
  {
    route: "#/t/16a/c/295/s/16a-3g",
    targets: [".revision-view-switch"],
    title: "Compare a section's versions",
    text: "When the Supplement changed a section, switch between the Supplement text, the earlier text, and Compare, which marks added language in green and deleted language in red."
  },
  {
    route: "#/editions",
    targets: ["[aria-labelledby='editions-archived-heading'] .edition-card", "#editions-archived-heading"],
    scrollOnMobile: "start",
    title: "Archived statute editions",
    text: "Read the statutes and supplement as published in an earlier edition. Use Earlier editions from a chapter to return here."
  }
];

const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");

function findTarget(selectors) {
  for (const selector of selectors) {
    const match = [...document.querySelectorAll(selector)].find(visible);
    if (match) return match;
  }
  return null;
}

// Pages render after the route changes and some parts load later, so look for a while.
// `previousPage` is the main element shown before the route changed; until it is replaced, a
// match could still be on the old page.
async function waitForTarget(selectors, isCurrent, previousPage, allowMissing) {
  const started = performance.now();
  while (isCurrent()) {
    const main = document.querySelector("#main-content");
    const rendered = main !== previousPage && !document.querySelector("main.loading");
    const target = rendered ? findTarget(selectors) : null;
    if (target || (rendered && allowMissing) || performance.now() - started > 6000) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export function createWhatsNewTour() {
  const compactLayout = matchMedia("(max-width: 60rem)");
  let card = null;
  let target = null;
  let detail = null;
  let panel = null;
  let openedPanel = false;
  let step = 0;
  let run = 0;
  let opener = null;

  function clearTargets() {
    target?.classList.remove("tour-target");
    detail?.classList.remove("tour-target");
    panel?.classList.remove("tour-panel");
    panel?.style.removeProperty("--tour-card-height");
    if (openedPanel && !panel.hidden) {
      panel.querySelector("[data-close-navigation-settings], [data-close-settings]")?.click();
    }
    target = null;
    detail = null;
    panel = null;
    openedPanel = false;
  }

  function place() {
    if (!card || card.hidden) return;
    card.style.top = card.style.left = "";
    if (compactLayout.matches) {
      panel?.style.setProperty("--tour-card-height", `${card.offsetHeight}px`);
      return;
    }
    const gutter = 16;
    const gap = 12;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    if (!target) {
      card.style.top = `${Math.max(gutter, (innerHeight - height) / 2)}px`;
      card.style.left = `${(innerWidth - width) / 2}px`;
      return;
    }
    const box = (detail ?? target).getBoundingClientRect();
    if (panel) {
      // Keep the card to the side of the open panel so all its controls remain usable.
      const bounds = panel.getBoundingClientRect();
      const right = bounds.right + gap;
      const left = bounds.left - width - gap;
      const preferRight = bounds.left + bounds.width / 2 < innerWidth / 2;
      const sides = preferRight ? [right, left] : [left, right];
      const side = sides.find((x) => x >= gutter && x + width <= innerWidth - gutter);
      if (side !== undefined) {
        card.style.left = `${side}px`;
        card.style.top = `${Math.max(gutter, Math.min(box.top, innerHeight - height - gutter))}px`;
        return;
      }
    }
    const below = box.bottom + gap;
    const top = below + height + gutter <= innerHeight ? below : Math.max(gutter, box.top - gap - height);
    card.style.top = `${top}px`;
    card.style.left = `${Math.min(Math.max(gutter, box.left), innerWidth - width - gutter)}px`;
  }

  async function show(index) {
    const current = ++run;
    step = index;
    const { route, targets, title, text, fallback, panelTargets, desktopOnly, scrollOnMobile = "center" } = STEPS[index];
    clearTargets();
    const changing = location.hash !== route;
    const previousPage = changing ? document.querySelector("#main-content") : null;
    if (changing) location.hash = route;
    const found = await waitForTarget(targets, () => current === run && card, previousPage, Boolean(fallback));
    if (current !== run || !card) return;
    target = found;
    target?.classList.add("tour-target");
    target?.scrollIntoView({ block: compactLayout.matches ? scrollOnMobile : "center", inline: "nearest", behavior: "instant" });
    if (target && panelTargets && !(desktopOnly && compactLayout.matches)) {
      panel = document.getElementById(target.getAttribute("aria-controls"));
      if (panel?.hidden) {
        target.click();
        openedPanel = !panel.hidden;
      }
      panel?.classList.add("tour-panel");
      detail = findTarget(panelTargets);
      detail?.classList.add("tour-target");
    }
    card.querySelector("[data-tour-progress]").textContent = `What's new · ${index + 1} of ${STEPS.length}`;
    card.querySelector("#tour-title").textContent = title;
    card.querySelector("#tour-text").textContent = target || !fallback ? text : fallback;
    card.querySelector("[data-tour-back]").disabled = index === 0;
    card.querySelector("[data-tour-next]").textContent = index === STEPS.length - 1 ? "Done" : "Next";
    card.hidden = false;
    place();
    if (detail && detail !== panel) {
      detail.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      place();
    } else if (compactLayout.matches && target && !panel) {
      const cardTop = innerHeight - card.offsetHeight - parseFloat(getComputedStyle(card).bottom);
      const overlap = target.getBoundingClientRect().bottom + 12 - cardTop;
      if (overlap > 0) window.scrollBy({ top: overlap, behavior: "instant" });
    }
    card.focus({ preventScroll: true });
  }

  function close({ restoreFocus = true } = {}) {
    if (!card) return;
    run += 1;
    clearTargets();
    card.remove();
    card = null;
    if (!restoreFocus) return;
    const button = opener?.isConnected ? opener : document.querySelector("[data-open-whats-new]");
    button?.focus({ preventScroll: true });
  }

  function start(button) {
    opener = button;
    if (!card) {
      document.body.insertAdjacentHTML("beforeend", `<section class="tour-card" role="dialog" aria-labelledby="tour-progress tour-title" aria-describedby="tour-text" tabindex="-1" data-tour hidden>
        <div class="tour-card-header"><p class="tour-progress" id="tour-progress" data-tour-progress></p><button type="button" class="icon-button" data-tour-close aria-label="Close What's new">×</button></div>
        <h2 id="tour-title"></h2><p id="tour-text"></p>
        <div class="tour-actions"><button type="button" data-tour-back>Back</button><button type="button" data-tour-next>Next</button></div>
      </section>`);
      card = document.body.lastElementChild;
    }
    show(0);
  }

  document.addEventListener("click", (event) => {
    if (!card) return;
    if (event.target.closest("[data-tour-close]")) close();
    else if (event.target.closest("[data-tour-back]") && step > 0) show(step - 1);
    else if (event.target.closest("[data-tour-next]")) step < STEPS.length - 1 ? show(step + 1) : close();
  });
  document.addEventListener("keydown", (event) => {
    if (card && event.key === "Escape" && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  }, true);
  window.addEventListener("resize", () => requestAnimationFrame(place));
  window.addEventListener("scroll", place, { passive: true });
  window.addEventListener("hashchange", () => {
    if (card && location.hash !== STEPS[step].route) close({ restoreFocus: false });
  });
  compactLayout.addEventListener("change", () => {
    if (card) show(step);
  });

  return { start, close };
}
