import { SearchRepository } from "./search.js";
import { ProgressiveSearchClient } from "./search-client.js";
import {
  findChapter,
  findSection,
  findTitle,
  parseRoute,
  routeHref,
  sectionRouteKey
} from "./routes.js";
import {
  escapeHtml,
  extractLegalReferences,
  leadingSubsection,
  renderLinkedText,
  routeForDocument
} from "./reader.js";

const app = document.querySelector("#app");
const repository = new SearchRepository();
const searchClient = new ProgressiveSearchClient({ repository });
const catalogPromise = getJson("./data/catalog.json");
let renderSequence = 0;
let activeSearchController = null;

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

function siteHeader() {
  return `<header class="site-header">
    <a class="brand" href="#/">Connecticut General Statutes</a>
    <nav aria-label="Primary"><a href="#/">Browse</a></nav>
  </header>`;
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items.map((item) =>
    `<li>${item.href ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` : `<span aria-current="page">${escapeHtml(item.label)}</span>`}</li>`
  ).join("")}</ol></nav>`;
}

function titleLabel(title) {
  return `Title ${String(title.number).replace(/^0+(?=\d)/, "")}`;
}

function chapterLabel(chapter) {
  return `Chapter ${String(chapter.number).replace(/^0+(?=\d)/, "")}`;
}

function sectionLabel(section) {
  return section.citation ? `Sec. ${section.citation}` : section.citations?.length ? `Secs. ${section.citations.join(" to ")}` : section.heading;
}

function setDocumentTitle(...parts) {
  document.title = [...parts.filter(Boolean), "Connecticut General Statutes"].join(" · ");
}

function titleRoute(title) {
  return routeHref({ title: title.number });
}

function chapterRoute(title, chapter) {
  return routeHref({ title: title.number, chapter: chapter.number });
}

function provisionRoute(title, chapter, section, subsection = null) {
  return routeHref({
    title: title.number,
    chapter: chapter.number,
    section: sectionRouteKey(section),
    subsection
  });
}

async function referenceMaps(section, catalog) {
  const values = [
    ...section.content.body,
    ...section.content.sourceNotes,
    ...section.content.history,
    ...section.content.annotations.map((annotation) => annotation.text)
  ];
  const references = extractLegalReferences(values);
  const sections = new Map();
  const chapters = new Map();
  const referencedTitles = new Map();

  for (const citation of references.sections) {
    const title = findTitle(catalog, citation.split("-")[0]);
    if (title) referencedTitles.set(title.id, title);
  }

  await Promise.all([...referencedTitles.values()].map(async (title) => {
    const shard = await repository.loadTitle(title.id);
    for (const document of shard.documents) {
      for (const citation of document.citations) {
        if (references.sections.includes(citation.toLowerCase())) {
          sections.set(citation.toLowerCase(), routeHref({
            title: title.number,
            chapter: document.chapter.number,
            section: document.citation ?? document.citations[0] ?? document.id
          }));
        }
      }
    }
  }));

  for (const number of references.chapters) {
    const match = findChapter(catalog, number);
    if (match) chapters.set(number, chapterRoute(match.title, match.chapter));
  }
  return { sections, chapters };
}

function renderParagraph(text, maps, title, chapter, section) {
  const subsection = leadingSubsection(text);
  if (!subsection) return `<p>${renderLinkedText(text, maps)}</p>`;
  const href = provisionRoute(title, chapter, section, subsection.key);
  return `<p id="subsection-${escapeHtml(subsection.key)}" class="statute-paragraph">
    <a class="subsection-link" href="${escapeHtml(href)}" aria-label="Link to subsection ${escapeHtml(subsection.label)}">${escapeHtml(subsection.label)}</a>
    ${renderLinkedText(subsection.text, maps)}
  </p>`;
}

function renderNotes(title, values, maps, { open = false } = {}) {
  if (!values.length) return "";
  return `<details class="notes"${open ? " open" : ""}>
    <summary>${escapeHtml(title)} <span>${values.length}</span></summary>
    <div>${values.map((value) => `<p>${renderLinkedText(value, maps)}</p>`).join("")}</div>
  </details>`;
}

function renderAnnotations(annotations, maps) {
  if (!annotations.length) return "";
  return `<details class="notes annotations">
    <summary>Annotations <span>${annotations.length}</span></summary>
    <div>${annotations.map((annotation) => `<p${annotation.first ? " class=\"annotation-first\"" : ""}>${renderLinkedText(annotation.text, maps)}</p>`).join("")}</div>
  </details>`;
}

function sectionNavigation(title, chapter, sections, selected) {
  const index = sections.indexOf(selected);
  const previous = index > 0 ? sections[index - 1] : null;
  const next = index < sections.length - 1 ? sections[index + 1] : null;
  return `<nav class="adjacent" aria-label="Adjacent sections">
    ${previous ? `<a rel="prev" href="${escapeHtml(provisionRoute(title, chapter, previous))}"><span>Previous</span>${escapeHtml(sectionLabel(previous))}</a>` : "<span></span>"}
    ${next ? `<a rel="next" href="${escapeHtml(provisionRoute(title, chapter, next))}"><span>Next</span>${escapeHtml(sectionLabel(next))}</a>` : ""}
  </nav>`;
}

function readerSidebar(title, chapter, sections, selected = null) {
  return `<aside class="reader-sidebar" aria-label="Chapter sections">
    <a class="sidebar-parent" href="${escapeHtml(titleRoute(title))}">← ${escapeHtml(titleLabel(title))}</a>
    <h2>${escapeHtml(chapterLabel(chapter))}</h2>
    <p>${escapeHtml(chapter.name)}</p>
    <nav><ol>${sections.map((section) => {
      const active = selected === section;
      return `<li><a${active ? " aria-current=\"page\"" : ""} href="${escapeHtml(provisionRoute(title, chapter, section))}">
        <strong>${escapeHtml(sectionLabel(section))}</strong><span>${escapeHtml(section.heading.replace(/^Secs?\.\s*[^.]+\.\s*/, ""))}</span>
      </a></li>`;
    }).join("")}</ol></nav>
  </aside>`;
}

function renderProvision(title, chapter, section, maps) {
  const route = provisionRoute(title, chapter, section);
  const absolute = new URL(route, location.href).href;
  const status = section.status === "active" ? section.kind : section.status;
  const email = `mailto:?subject=${encodeURIComponent(section.heading)}&body=${encodeURIComponent(absolute)}`;
  return `<article class="provision" id="${escapeHtml(section.id)}">
    <div class="provision-heading">
      <p class="eyebrow">${escapeHtml(status)}</p>
      <h1>${escapeHtml(section.heading)}</h1>
    </div>
    <div class="section-actions" aria-label="Section actions">
      <button type="button" data-copy-link="${escapeHtml(route)}">Copy link</button>
      <button type="button" data-share-link="${escapeHtml(route)}" data-share-title="${escapeHtml(section.heading)}">Share</button>
      <a href="${escapeHtml(email)}">Email</a>
      <a href="${escapeHtml(section.sourceUrl)}">Official source</a>
    </div>
    <p class="action-status" role="status" aria-live="polite"></p>
    <div class="statute-text">${section.content.body.map((paragraph) => renderParagraph(paragraph, maps, title, chapter, section)).join("")}</div>
    <div class="section-notes">
      ${renderNotes("Source", section.content.sourceNotes, maps, { open: true })}
      ${renderNotes("History", section.content.history, maps)}
      ${renderAnnotations(section.content.annotations, maps)}
    </div>
  </article>`;
}

function renderSearchResults(matches, results) {
  results.innerHTML = matches.map(({ document, score }) => {
    const documentStatus = document.status === "active" ? "" : `<span class="status">${escapeHtml(document.status)}</span>`;
    const excerpt = document.text.slice(0, 240);
    return `<li><a href="${escapeHtml(routeForDocument(document))}"><span class="result-citation">${escapeHtml(document.citation ?? document.citations.join("–"))}</span>${escapeHtml(document.heading)} ${documentStatus}</a>
      <p>${escapeHtml(titleLabel(document.title))} · ${escapeHtml(chapterLabel(document.chapter))} · ${escapeHtml(excerpt)}${document.text.length > 240 ? "…" : ""}</p><span class="visually-hidden">Relevance ${score}</span></li>`;
  }).join("");
}

async function renderHome(catalog) {
  setDocumentTitle();
  app.innerHTML = `${siteHeader()}<header class="masthead" id="main-content">
      <p class="kicker">UConn Law Library</p>
      <h1>Connecticut General Statutes</h1>
      <p>Browse and search a static, chapter-level edition with links to the official source.</p>
    </header>
    <main>
      <section class="search-panel" aria-labelledby="search-heading">
        <h2 id="search-heading">Search the statutes</h2>
        <form id="search-form">
          <label for="query">Citation, phrase, or keyword</label>
          <input id="query" name="query" type="search" minlength="2" required placeholder="Try 1-1 or public records">
          <label for="title">Limit to a title</label>
          <select id="title" name="title">
            <option value="">All titles</option>
            ${catalog.titles.map((title) => `<option value="${escapeHtml(title.id)}">${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</option>`).join("")}
          </select>
          <button type="submit">Search</button>
        </form>
        <p id="search-note" class="note">All-title searches stream static title shards and rank matches in the background. Choose a title for the fastest search.</p>
        <progress id="search-progress" value="0" max="1" hidden>Search progress</progress>
        <div id="search-status" role="status" aria-live="polite"></div>
        <ol id="results" class="results"></ol>
      </section>
      <section class="catalog" aria-labelledby="browse-heading">
        <div class="section-heading"><div><p class="eyebrow">${catalog.counts.chapters.toLocaleString()} chapters</p><h2 id="browse-heading">Browse titles</h2></div><p>${catalog.counts.sections.toLocaleString()} provisions</p></div>
        <div class="title-grid">${catalog.titles.map((title) => `<a class="title-card" href="${escapeHtml(titleRoute(title))}"><p>${escapeHtml(titleLabel(title))}</p><h3>${escapeHtml(title.name)}</h3><span>${title.chapters.length} chapter${title.chapters.length === 1 ? "" : "s"}</span></a>`).join("")}</div>
      </section>
    </main>
    <footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;

  document.querySelector("#search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = form.get("query");
    const title = form.get("title");
    const status = document.querySelector("#search-status");
    const results = document.querySelector("#results");
    const progress = document.querySelector("#search-progress");
    activeSearchController?.abort();
    const controller = new AbortController();
    activeSearchController = controller;
    status.textContent = "Preparing search…";
    results.innerHTML = "";
    results.setAttribute("aria-busy", "true");
    progress.hidden = false;
    progress.value = 0;
    try {
      const matches = await searchClient.search(query, {
        titleIds: title ? [title] : undefined,
        signal: controller.signal,
        onProgress(update) {
          if (controller !== activeSearchController) return;
          progress.max = Math.max(1, update.total);
          progress.value = update.completed;
          renderSearchResults(update.results, results);
          status.textContent = `Searching ${update.completed} of ${update.total} title shard${update.total === 1 ? "" : "s"}… ${update.results.length} match${update.results.length === 1 ? "" : "es"} so far.`;
        }
      });
      if (controller !== activeSearchController) return;
      status.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;
      renderSearchResults(matches, results);
    } catch (error) {
      if (error.name !== "AbortError" && controller === activeSearchController) status.textContent = error.message;
    } finally {
      if (controller === activeSearchController) {
        results.removeAttribute("aria-busy");
        progress.hidden = true;
        activeSearchController = null;
      }
    }
  });
}

function renderTitle(title) {
  setDocumentTitle(titleLabel(title));
  app.innerHTML = `${siteHeader()}<main class="browse-page" id="main-content">
    ${breadcrumbs([{ label: "Titles", href: "#/" }, { label: titleLabel(title) }])}
    <div class="browse-heading"><div><p class="eyebrow">${title.chapters.length} chapters</p><h1>${escapeHtml(titleLabel(title))} — ${escapeHtml(title.name)}</h1></div><a href="${escapeHtml(title.sourceUrl)}">Official title source</a></div>
    <ol class="chapter-list">${title.chapters.map((chapter) => `<li><a href="${escapeHtml(chapterRoute(title, chapter))}"><strong>${escapeHtml(chapterLabel(chapter))}</strong><span>${escapeHtml(chapter.name)}</span><small>${chapter.sectionCount} provision${chapter.sectionCount === 1 ? "" : "s"}</small></a></li>`).join("")}</ol>
  </main><footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>`;
}

async function renderChapter(catalog, title, chapterMeta, route) {
  const chapter = await getJson(`./data/${chapterMeta.path}`);
  const selected = route.kind === "section" ? findSection(chapter, route.section) : null;
  if (route.kind === "section" && !selected) return renderNotFound("That provision was not found.");

  if (route.legacyQuery) {
    const canonicalRoute = selected ? provisionRoute(title, chapter, selected) : chapterRoute(title, chapter);
    history.replaceState(null, "", `${location.pathname}${canonicalRoute}`);
  }

  const maps = selected ? await referenceMaps(selected, catalog) : null;
  setDocumentTitle(selected ? sectionLabel(selected) : chapterLabel(chapter), titleLabel(title));
  app.innerHTML = `${siteHeader()}<div class="reader-shell" id="main-content">
    ${readerSidebar(title, chapter, chapter.sections, selected)}
    <main class="reader-content">
      ${breadcrumbs([
        { label: "Titles", href: "#/" },
        { label: titleLabel(title), href: titleRoute(title) },
        { label: chapterLabel(chapter), href: selected ? chapterRoute(title, chapter) : null },
        ...(selected ? [{ label: sectionLabel(selected) }] : [])
      ])}
      ${selected ? `${renderProvision(title, chapter, selected, maps)}${sectionNavigation(title, chapter, chapter.sections, selected)}` : `<div class="chapter-overview"><p class="eyebrow">${chapter.sections.length} provisions</p><h1>${escapeHtml(chapterLabel(chapter))} — ${escapeHtml(chapter.name)}</h1><p>Choose a provision from the chapter list.</p><a href="${escapeHtml(chapter.sourceUrl)}">Official chapter source</a></div>`}
    </main>
  </div>`;

  if (route.subsection) {
    const target = document.querySelector(`#subsection-${CSS.escape(route.subsection.toLowerCase())}`);
    if (target) {
      target.tabIndex = -1;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    }
  } else {
    window.scrollTo({ top: 0 });
  }
}

function renderNotFound(message = "That page was not found.") {
  setDocumentTitle("Not found");
  app.innerHTML = `${siteHeader()}<main class="error" id="main-content"><p class="eyebrow">Not found</p><h1>${escapeHtml(message)}</h1><p><a href="#/">Browse the statutes</a></p></main>`;
}

async function renderCurrentRoute() {
  activeSearchController?.abort();
  activeSearchController = null;
  const sequence = ++renderSequence;
  try {
    const catalog = await catalogPromise;
    const route = parseRoute(location);
    if (sequence !== renderSequence) return;
    if (route.kind === "home") return renderHome(catalog);
    if (route.kind === "not-found") return renderNotFound();

    let title = route.title ? findTitle(catalog, route.title) : null;
    let chapterMatch = route.chapter ? findChapter(catalog, route.chapter, title) : null;
    if (!title && chapterMatch) title = chapterMatch.title;
    if (!title) return renderNotFound("That title was not found.");
    if (route.kind === "title") return renderTitle(title);
    if (!chapterMatch) chapterMatch = findChapter(catalog, route.chapter, title);
    if (!chapterMatch) return renderNotFound("That chapter was not found.");
    return renderChapter(catalog, title, chapterMatch.chapter, route);
  } catch (error) {
    app.innerHTML = `<main class="error" id="main-content"><h1>Unable to load the statutes</h1><p>${escapeHtml(error.message)}</p></main>`;
  }
}

document.addEventListener("click", async (event) => {
  const skip = event.target.closest("[data-skip-link]");
  if (skip) {
    event.preventDefault();
    const target = document.querySelector("#main-content");
    if (target) {
      target.tabIndex = -1;
      target.focus();
    }
    return;
  }
  const copy = event.target.closest("[data-copy-link]");
  const share = event.target.closest("[data-share-link]");
  if (!copy && !share) return;
  const button = copy ?? share;
  const url = new URL(button.dataset.copyLink ?? button.dataset.shareLink, location.href).href;
  const status = button.closest(".provision")?.querySelector(".action-status");
  try {
    if (share && navigator.share) await navigator.share({ title: share.dataset.shareTitle, url });
    else await navigator.clipboard.writeText(url);
    if (status) status.textContent = share && navigator.share ? "Share options opened." : "Link copied.";
  } catch (error) {
    if (error.name !== "AbortError" && status) status.textContent = "The link could not be copied automatically.";
  }
});

window.addEventListener("hashchange", renderCurrentRoute);
renderCurrentRoute();
