import { SearchRepository } from "./search.js";

const app = document.querySelector("#app");
const repository = new SearchRepository();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

function renderProvision(section) {
  const paragraphs = section.content.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const sourceNotes = section.content.sourceNotes.length
    ? `<h3>Source</h3>${section.content.sourceNotes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}`
    : "";
  const history = section.content.history.length
    ? `<h3>History</h3>${section.content.history.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}`
    : "";
  return `<article class="provision" id="${escapeHtml(section.id)}">
    <div class="eyebrow">${escapeHtml(section.status === "active" ? section.kind : section.status)}</div>
    <h2>${escapeHtml(section.heading)}</h2>
    ${paragraphs}${sourceNotes}${history}
    <p class="source-link"><a href="${escapeHtml(section.sourceUrl)}">View the official source</a></p>
  </article>`;
}

async function renderChapter(number, sectionId) {
  const chapter = await getJson(`./data/chapters/${encodeURIComponent(number)}.json`);
  const sections = sectionId ? chapter.sections.filter((section) => section.id === sectionId) : chapter.sections;
  app.innerHTML = `<header class="masthead compact">
      <a class="brand" href="./">Connecticut General Statutes</a>
    </header>
    <main class="reader">
      <a class="back" href="./">← Search the statutes</a>
      <p class="eyebrow">Title ${escapeHtml(chapter.title.number)} · Chapter ${escapeHtml(chapter.number)}</p>
      <h1>${escapeHtml(chapter.name)}</h1>
      ${sections.length ? sections.map(renderProvision).join("") : `<p>That provision was not found in this chapter.</p>`}
    </main>`;
  if (sectionId) document.querySelector(`#${CSS.escape(sectionId)}`)?.scrollIntoView();
}

function resultMarkup({ document, score }) {
  const status = document.status === "active" ? "" : `<span class="status">${escapeHtml(document.status)}</span>`;
  const excerpt = document.text.slice(0, 240);
  return `<li>
    <a href="${escapeHtml(document.href)}">
      <span class="result-citation">${escapeHtml(document.citation ?? document.citations.join("–"))}</span>
      ${escapeHtml(document.heading)} ${status}
    </a>
    <p>Chapter ${escapeHtml(document.chapter.number)} · ${escapeHtml(excerpt)}${document.text.length > 240 ? "…" : ""}</p>
    <span class="visually-hidden">Relevance ${score}</span>
  </li>`;
}

async function renderHome() {
  const catalog = await getJson("./data/catalog.json");
  app.innerHTML = `<header class="masthead">
      <p class="kicker">UConn Law Library</p>
      <h1>Connecticut General Statutes</h1>
      <p>Browse a static, chapter-level edition with links to the official source.</p>
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
            ${catalog.titles.map((title) => `<option value="${escapeHtml(title.id)}">Title ${escapeHtml(title.number)} — ${escapeHtml(title.name)}</option>`).join("")}
          </select>
          <button type="submit">Search</button>
        </form>
        <p id="search-note" class="note">All-title searches load each static title shard. Choose a title for the fastest search.</p>
        <div id="search-status" role="status" aria-live="polite"></div>
        <ol id="results" class="results"></ol>
      </section>
      <section class="catalog" aria-labelledby="browse-heading">
        <h2 id="browse-heading">Browse titles</h2>
        <div class="title-grid">${catalog.titles.map((title) => `<article><p>Title ${escapeHtml(title.number)}</p><h3>${escapeHtml(title.name)}</h3><span>${title.chapters.length} chapter${title.chapters.length === 1 ? "" : "s"}</span></article>`).join("")}</div>
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
    status.textContent = "Searching static data…";
    results.innerHTML = "";
    try {
      const matches = await repository.search(query, { titleIds: title ? [title] : undefined });
      status.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;
      results.innerHTML = matches.map(resultMarkup).join("");
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

try {
  const params = new URLSearchParams(location.search);
  if (params.has("chapter")) await renderChapter(params.get("chapter"), params.get("section"));
  else await renderHome();
} catch (error) {
  app.innerHTML = `<main class="error"><h1>Unable to load the statutes</h1><p>${escapeHtml(error.message)}</p></main>`;
}
