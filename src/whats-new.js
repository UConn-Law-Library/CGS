// A short guided tour of what changed in the reading room. Each step opens a page, outlines one
// control, and explains it. When a step's control is not on screen (a phone, or panes instead of
// the page tree), its card still shows, with `fallback` text where the wording differs.
const STEPS = [
  {
    route: "#/t/16a/c/295",
    targets: ["[data-open-navigation-settings]", "[data-open-settings]"],
    title: "Navigation settings",
    text: "Each side panel has a settings icon. It holds Compact lists, Hide sections by status, Subtle notices, and Page tree navigation, which puts titles, chapters, and sections in one panel. On phones, these are in Settings."
  },
  {
    route: "#/t/16a/c/295",
    targets: ["#statute-tree-status"],
    title: "Filter sections by status",
    text: "In the page tree, Status lists only the sections with one tag: Supplement amendments or additions, Recent Public Acts, Repealed, Transferred, Obsolete, or Reserved. It works with the text filter above it.",
    fallback: "Turn on Page tree navigation in Settings to filter the statute tree by status, including Supplement amendments or additions, Recent Public Acts, Repealed, Transferred, Obsolete, or Reserved."
  },
  {
    route: "#/t/16a/c/295",
    targets: ["[data-open-settings]"],
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
async function waitForTarget(selectors, isCurrent, previousPage = null, timeout = 6000) {
  const started = performance.now();
  while (isCurrent()) {
    const main = document.querySelector("#main-content");
    const rendered = main !== previousPage && !document.querySelector("main.loading");
    const target = rendered ? findTarget(selectors) : null;
    if (target || performance.now() - started > timeout) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export function createWhatsNewTour() {
  let card = null;
  let target = null;
  let step = 0;
  let run = 0;
  let opener = null;

  function clearTarget() {
    target?.classList.remove("tour-target");
    target = null;
  }

  function place() {
    if (!card) return;
    card.style.top = card.style.left = "";
    if (matchMedia("(max-width: 60rem)").matches) return;
    const gutter = 16;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    if (!target) {
      card.style.top = `${Math.max(gutter, (innerHeight - height) / 2)}px`;
      card.style.left = `${(innerWidth - width) / 2}px`;
      return;
    }
    const box = target.getBoundingClientRect();
    const below = box.bottom + 12;
    const top = below + height + gutter <= innerHeight ? below : Math.max(gutter, box.top - 12 - height);
    card.style.top = `${top}px`;
    card.style.left = `${Math.min(Math.max(gutter, box.left), innerWidth - width - gutter)}px`;
  }

  async function show(index) {
    const current = ++run;
    step = index;
    const { route, targets, title, text, fallback } = STEPS[index];
    clearTarget();
    const changing = location.hash !== route;
    const previousPage = changing ? document.querySelector("#main-content") : null;
    if (changing) location.hash = route;
    const found = await waitForTarget(targets, () => current === run && card, previousPage);
    if (current !== run || !card) return;
    target = found;
    target?.classList.add("tour-target");
    target?.scrollIntoView({ block: "center", inline: "nearest" });
    card.querySelector("[data-tour-progress]").textContent = `What's new · ${index + 1} of ${STEPS.length}`;
    card.querySelector("#tour-title").textContent = title;
    card.querySelector("#tour-text").textContent = target || !fallback ? text : fallback;
    card.querySelector("[data-tour-back]").disabled = index === 0;
    card.querySelector("[data-tour-next]").textContent = index === STEPS.length - 1 ? "Done" : "Next";
    card.hidden = false;
    place();
    card.focus({ preventScroll: true });
  }

  function close() {
    if (!card) return;
    run += 1;
    clearTarget();
    card.remove();
    card = null;
    if (opener?.isConnected) opener.focus();
    else document.querySelector("[data-open-whats-new]")?.focus();
  }

  function start(button) {
    opener = button;
    if (!card) {
      document.body.insertAdjacentHTML("beforeend", `<section class="tour-card" role="dialog" aria-labelledby="tour-title" aria-describedby="tour-text" tabindex="-1" data-tour hidden>
        <div class="tour-card-header"><p class="tour-progress" data-tour-progress></p><button type="button" class="icon-button" data-tour-close aria-label="Close What's new">×</button></div>
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
  window.addEventListener("resize", place);

  return { start, close };
}
