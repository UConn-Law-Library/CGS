import { escapeHtml } from "./reader.js";

const repositoryUrl = "https://github.com/UConn-Law-Library/CGS";

function renderUpdate(update) {
  const date = new Date(`${update.date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC"
  });
  return `<li class="about-update">
    <div class="about-update-meta"><span class="about-update-category">${escapeHtml(update.category)}</span><time datetime="${escapeHtml(update.date)}">${escapeHtml(date)}</time></div>
    <h3>${escapeHtml(update.title)}</h3>
    ${update.summary ? `<p>${escapeHtml(update.summary)}</p>` : ""}
    <a class="about-update-commit" href="${repositoryUrl}/commit/${encodeURIComponent(update.commit)}" target="_blank" rel="noopener">View commit ${escapeHtml(update.commit.slice(0, 7))} <span aria-hidden="true">↗</span></a>
  </li>`;
}

export function renderSiteUpdates(updates = []) {
  const recent = updates.slice(0, 3);
  const earlier = updates.slice(3);
  return `<section class="about-section about-updates" aria-labelledby="about-updates-heading">
    <div class="about-section-heading"><p class="eyebrow">Changelog</p><h2 id="about-updates-heading">Recent updates</h2></div>
    <p class="about-updates-intro">Bug fixes, enhancements, and maintenance included in this version of the site.</p>
    ${recent.length ? `<ol class="about-update-list" aria-label="Latest updates">${recent.map(renderUpdate).join("")}</ol>`
      : `<p>Update details are unavailable in this build. Browse the full history on GitHub.</p>`}
    ${earlier.length ? `<details class="about-updates-more"><summary>Show ${earlier.length} earlier ${earlier.length === 1 ? "update" : "updates"}</summary><ol class="about-update-list" start="4" aria-label="Earlier updates">${earlier.map(renderUpdate).join("")}</ol></details>` : ""}
    <p class="about-updates-history"><a href="${repositoryUrl}/commits/main/" target="_blank" rel="noopener">View full commit history on GitHub <span aria-hidden="true">↗</span></a></p>
  </section>`;
}
