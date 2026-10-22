import { escapeHtml } from "./reader.js";
import { guideRouteHref } from "./routes.js";
import { actsCountLabel } from "./acts.js";
import { APP_VERSION, RECENT_UPDATES } from "./release.js";
import { renderSiteUpdates } from "./site-updates.js";

export function formatSnapshotDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function createAboutPage({ app, secondaryRepository, actsRepository, loadLatestSupplement, setDocumentTitle, siteHeader, breadcrumbs, legalFooter, isCurrent }) {
function aboutSourceCard({ publisher, name, description, details = [], caveat, url, refresh = false }) {
  const visibleDetails = details.filter(Boolean);
  return `<article class="about-source-card">
    <p class="eyebrow">${escapeHtml(publisher)}</p>
    <h3>${escapeHtml(name)}</h3>
    <p>${escapeHtml(description)}</p>
    ${visibleDetails.length ? `<p class="about-source-details">${visibleDetails.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</p>` : ""}
    ${refresh ? `<p class="about-caveat" data-${refresh}-refresh aria-live="polite">Latest update check: loading… <a href="https://github.com/UConn-Law-Library/CGS/actions/workflows/refresh-${refresh}.yml" target="_blank" rel="noopener">View refresh runs ↗</a></p>` : ""}
    <p class="about-caveat">${escapeHtml(caveat)}</p>
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Official source <span aria-hidden="true">↗</span></a>
  </article>`;
}

async function updateRefreshStatus(sequence, source) {
  const targets = document.querySelectorAll(`[data-${source}-refresh]`);
  if (!targets.length) return;
  try {
    const response = await fetch(`https://api.github.com/repos/UConn-Law-Library/CGS/actions/workflows/refresh-${source}.yml/runs?branch=main&status=completed&per_page=1`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error("Refresh history unavailable");
    const { workflow_runs: runs } = await response.json();
    const run = runs?.[0];
    if (!run || !Number.isFinite(new Date(run.updated_at).getTime()) || !Number.isSafeInteger(run.id)) throw new Error("No completed refresh run");
    if (!isCurrent(sequence)) return;
    const result = run.conclusion === "success" ? "completed successfully" : String(run.conclusion ?? "unknown result").replaceAll("_", " ");
    for (const target of targets) {
      target.replaceChildren(document.createTextNode(`Latest update check: ${formatSnapshotDate(run.updated_at)} (${result}). `));
      const link = document.createElement("a");
      link.href = `https://github.com/UConn-Law-Library/CGS/actions/runs/${run.id}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "View refresh run ↗";
      target.append(link);
    }
  } catch {
    if (!isCurrent(sequence)) return;
    for (const target of targets) target.firstChild.textContent = "Latest update check: unavailable. ";
  }
}

async function renderAbout(catalog, route, sequence) {
  const [secondaryResult, supplementResult, actsResult] = await Promise.allSettled([
    secondaryRepository.init(),
    loadLatestSupplement(),
    actsRepository.manifest()
  ]);
  if (!isCurrent(sequence)) return;
  const secondary = secondaryResult.status === "fulfilled" ? secondaryResult.value : null;
  const supplement = supplementResult.status === "fulfilled" ? supplementResult.value : null;
  const acts = actsResult.status === "fulfilled" ? actsResult.value : null;
  const statuteDate = formatSnapshotDate(catalog.source?.retrievedAt ?? catalog.generatedAt);
  const revisionYear = catalog.source?.revisionYear ?? null;
  const indexSource = secondary?.index?.source ?? {};
  const infractionSource = secondary?.infractions?.source ?? {};
  const cards = [
    aboutSourceCard({
      publisher: "Connecticut General Assembly",
      name: "General Statutes",
      refresh: "corpus",
      description: "Browse the Connecticut General Statutes by title, chapter, and section.",
      details: [revisionYear && `Revised to January 1, ${revisionYear}`, statuteDate && `Captured ${statuteDate}`, `${catalog.counts.sections.toLocaleString()} sections`],
      caveat: "Changes published after the capture date appear after the next reviewed corpus update.",
      url: catalog.source?.url ?? "https://www.cga.ct.gov/current/pub/titles.htm"
    }),
    ...(supplement ? [aboutSourceCard({
      publisher: "Connecticut General Assembly",
      name: `${supplement.edition.editionYear} Supplement`,
      description: "Sections amended, added, or repealed by the published supplement and consolidated into the reader when applicable.",
      details: [formatSnapshotDate(supplement.manifest.generatedAt) && `Captured ${formatSnapshotDate(supplement.manifest.generatedAt)}`, `${supplement.manifest.counts.sections.toLocaleString()} sections`],
      caveat: revisionYear
        ? `Read the supplement together with the General Statutes revised to January 1, ${revisionYear}.`
        : "Read the supplement together with the General Statutes revision it supplements.",
      url: supplement.manifest.source?.url ?? `https://www.cga.ct.gov/${supplement.edition.editionYear}/sup/titles.htm`
    })] : []),
    ...(acts?.sessions.length ? [aboutSourceCard({
      publisher: acts.source.publisher,
      name: acts.source.name,
      refresh: "acts",
      description: "Acts passed by the General Assembly, with the text of each act and links to its PDF and bill history, for laws not yet reflected in the statute text.",
      details: [`Updated ${formatSnapshotDate(acts.generatedAt)}`, ...acts.sessions.map((session) => `${session.name}: ${actsCountLabel(session.counts)}`)],
      caveat: "Public Acts may take effect before revised statute text is published. Check each act's effective dates.",
      url: acts.source.url
    })] : []),
    aboutSourceCard({
      publisher: indexSource.publisher ?? "Connecticut General Assembly, Legislative Commissioners' Office",
      name: "Subject index",
      refresh: "secondary",
      description: "Browse the official subject index alphabetically and open linked statute sections.",
      details: [indexSource.revision, secondary?.index?.counts?.headings && `${secondary.index.counts.headings.toLocaleString()} headings`],
      caveat: "The index is an access aid rather than legal text and can trail recently enacted legislation.",
      url: indexSource.url ?? "https://www.cga.ct.gov/lco/statutes-index.asp"
    }),
    aboutSourceCard({
      publisher: infractionSource.publisher ?? "State of Connecticut Judicial Branch",
      name: "Infractions schedule",
      refresh: "secondary",
      description: "Chart A of the Judicial Branch mail-in violations and infractions schedule, with links to relevant statutes.",
      details: [infractionSource.effective && `Effective ${infractionSource.effective}`, secondary?.infractions?.counts?.entries && `${secondary.infractions.counts.entries.toLocaleString()} entries`],
      caveat: "Fine amounts and eligibility can change. Confirm them in the current Judicial Branch schedule before relying on this copy.",
      url: infractionSource.url ?? "https://www.jud.ct.gov/webforms/forms/infractions.pdf"
    })
  ];
  const headingCount = secondary?.index?.counts?.headings;
  const infractionCount = secondary?.infractions?.counts?.entries;
  setDocumentTitle("About");
  app.innerHTML = `${siteHeader()}<main class="about-page" id="main-content">
    ${breadcrumbs([{ label: "Titles", href: "#/" }, { label: "About" }])}
    <section class="about-brand">
      <img src="./wordmark.svg" alt="UConn School of Law, Law Library and Technology">
    </section>
    <header class="about-intro">
      <p class="eyebrow">About this app</p>
      <h1>Connecticut General Statutes Explorer</h1>
      <p>The UConn Law Library provides this mobile-first tool for searching and browsing the Connecticut General Statutes, the official subject index, the Judicial Branch infraction schedule, and recent Public and Special Acts.</p>
      <p class="about-version">Release <a href="https://github.com/UConn-Law-Library/CGS/releases/tag/${encodeURIComponent(APP_VERSION)}" target="_blank" rel="noopener">${escapeHtml(APP_VERSION)} <span aria-hidden="true">↗</span></a></p>
      <p><a class="primary-link" href="https://library.law.uconn.edu/" target="_blank" rel="noopener">Visit the UConn Law Library Website <span aria-hidden="true">↗</span></a></p>
      <p>New to Connecticut’s statutes? <a href="${guideRouteHref()}">Understanding the Statutes</a> explains how laws are enacted, codified, and published, and what this app’s data covers.</p>
    </header>
    <ul class="about-counts" aria-label="Published data coverage">
      <li><strong>${catalog.titles.length.toLocaleString()}</strong><span>titles</span></li>
      <li><strong>${catalog.counts.chapters.toLocaleString()}</strong><span>chapters</span></li>
      <li><strong>${catalog.counts.sections.toLocaleString()}</strong><span>sections</span></li>
      ${headingCount ? `<li><strong>${headingCount.toLocaleString()}</strong><span>index headings</span></li>` : ""}
      ${infractionCount ? `<li><strong>${infractionCount.toLocaleString()}</strong><span>infractions</span></li>` : ""}
    </ul>
    ${renderSiteUpdates(RECENT_UPDATES)}
    <section class="about-section" aria-labelledby="about-sources-heading">
      <div class="about-section-heading"><p class="eyebrow">Provenance</p><h2 id="about-sources-heading">Data and official sources</h2></div>
      <div class="about-source-list">${cards.join("")}</div>
    </section>
    <section class="about-section about-project" aria-labelledby="about-project-heading">
      <div><p class="eyebrow">Privacy and architecture</p><h2 id="about-project-heading">Built for public access</h2></div>
      <div>
        <p>Searches run in your browser. Your bookmarks, display preferences, and downloaded offline data stay on this device. GitHub Pages hosts the app.</p>
        <p>Data refreshes are parsed, validated, and reviewed before publication. The application and ingestion tools are maintained in the <a href="https://github.com/UConn-Law-Library/CGS" target="_blank" rel="noopener">public source repository <span aria-hidden="true">↗</span></a>.</p>
      </div>
    </section>
    <aside class="legal-data-note"><strong>Unofficial access copy</strong><p>This application is not legal advice and is not the official legal publication. Verify statute text with the Connecticut General Assembly and infraction information with the Judicial Branch.</p></aside>
  </main><footer>${legalFooter()}</footer>`;
  void updateRefreshStatus(sequence, "corpus");
  void updateRefreshStatus(sequence, "secondary");
  void updateRefreshStatus(sequence, "acts");
  const heading = route.section ? document.getElementById(`about-${route.section}-heading`) : null;
  if (heading) {
    heading.closest("section").scrollIntoView({ block: "start", behavior: "instant" });
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  } else window.scrollTo({ top: 0 });
}

  return renderAbout;
}
