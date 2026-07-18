import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const wordmarkSource = await readFile(new URL("../public/wordmark.svg", import.meta.url), "utf8");

test("home statute browsing uses the dedicated compact titles route", () => {
  assert.match(appSource, /<a href="\$\{titlesRouteHref\(\)\}">/);
  assert.doesNotMatch(appSource, /href="#browse-titles"/);
});

test("dense shell exposes bookmark count and device-local activity", () => {
  assert.match(appSource, /class="nav-badge"/);
  assert.match(appSource, /Recently viewed/);
  assert.match(appSource, /Recent bookmarks/);
  assert.match(appSource, /data-clear-recents/);
  assert.doesNotMatch(appSource, /<p class="eyebrow">UConn Law Library<\/p>/);
});

test("Search v2 uses structured filters, highlighted field-aware excerpts, and local history", () => {
  assert.match(appSource, /class="search-field search-query-field"/);
  assert.match(appSource, /renderSearchHighlight\(document\.heading, highlightTerms\)/);
  assert.match(appSource, /renderSearchExcerpt\(searchResultContext\(document, options\), highlightTerms\)/);
  assert.match(appSource, /NEAR\/n proximity/);
  assert.match(appSource, /data-search-within/);
  assert.match(appSource, /deviceState\.recordSearch/);
  assert.match(stylesSource, /\.search-primary-controls \{ display: grid;/);
  assert.match(stylesSource, /\.results mark \{[^}]*background: var\(--highlight-surface\)/);
});

test("shared application shell provides contextual rails and mobile presentation modes", () => {
  assert.match(appSource, /function applicationShell\(\{[\s\S]*contextualNavigation = \[\],[\s\S]*mainContent,[\s\S]*columnCount = contextualNavigation\.length,[\s\S]*mobilePresentationMode = "focused"/);
  assert.match(appSource, /class="application-shell mobile-\$\{escapeHtml\(mobilePresentationMode\)\}" data-context-columns="\$\{columnCount\}"/);
  assert.match(appSource, /statuteTitleColumn\(catalog, title\)/);
  assert.match(appSource, /contextualNavigation: \[statuteTitleColumn\(catalog, title\), statuteChapterColumn\(title\)\]/);
  assert.match(appSource, /statuteChapterColumn\(title, chapter\)/);
  assert.match(appSource, /statuteSectionColumn\(title, chapter, chapterNavigation, selected, changeBySection\)/);
  assert.match(stylesSource, /\.context-list a\[aria-current="page"\]/);
  assert.match(appSource, /data-context-key="\$\{escapeHtml\(column\.className \|\| column\.label\)\}"/);
  assert.match(appSource, /function mountApplicationShell\(options\)[\s\S]*contextScrollPositions\(\)[\s\S]*restoreContextScrollPositions\(positions\)/);
  assert.match(appSource, /column\.scrollTop = previous/);
});

test("supplement-only chapters resolve before reader routing and section labels avoid provision terminology", () => {
  assert.match(appSource, /titleWithLatestSupplementChapters\(title\)/);
  assert.match(appSource, /chapterMeta\.supplementOnly \? null/);
  assert.match(appSource, /That section was not found\./);
  assert.doesNotMatch(appSource, />[^<`]*provisions?</i);
});

test("detail pages record recents only after rendering and mobile readers expose a native chapter sheet", () => {
  assert.match(appSource, /deviceState\.recordRecent\(\{[\s\S]*type: "statute"/);
  assert.match(appSource, /deviceState\.recordRecent\(\{[\s\S]*type: "index"/);
  assert.match(appSource, /deviceState\.recordRecent\(\{[\s\S]*type: "infraction"/);
  assert.match(appSource, /<dialog class="chapter-sheet" data-chapter-sheet/);
  assert.match(appSource, /data-open-chapter-sheet aria-haspopup="dialog"/);
  assert.match(appSource, /chapterDialogController\?\.close\(\)/);
});

test("index letters render collapsed topics, dedicated large topics, and repealed filtering", () => {
  assert.match(appSource, /<details class="index-topic"/);
  assert.match(appSource, /LARGE_INDEX_TOPIC_THRESHOLD = 200/);
  assert.match(appSource, /class="index-topic index-topic-link"/);
  assert.match(appSource, /renderSelectedIndexTopic\(selected, topicGroups, matchingEntry/);
  assert.match(appSource, /data-index-group-entries/);
  assert.match(appSource, /Search within \$\{escapeHtml\(topic\.label\)\}/);
  assert.match(appSource, /<summary><strong>\$\{escapeHtml\(topic\.label\)\}<\/strong><\/summary>/);
  assert.match(appSource, /target\?\.scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(stylesSource, /\.index-topic \{[^}]*scroll-margin-top: 8rem;/);
  assert.match(stylesSource, /\.index-topic-jumps \{[^}]*overflow-x: auto/);
  assert.match(appSource, /data-hide-repealed/);
  assert.match(appSource, /class="section-status-pill">Repealed/);
});

test("infractions categories are one alphabetical column", () => {
  assert.match(appSource, /return \[\.\.\.groups\]\.sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/);
  assert.match(stylesSource, /\.infraction-categories \{[^}]*grid-template-columns: 1fr/);
});

test("settings links to a provenance-rich About page", () => {
  assert.match(appSource, /href="#\/about">About this app/);
  assert.match(appSource, /async function renderAbout\(catalog\)/);
  assert.match(appSource, /Data and official sources/);
  assert.match(appSource, /database-free, static Progressive Web App hosted on GitHub Pages/);
  assert.match(appSource, /<img src="\.\/wordmark\.svg" alt="UConn School of Law, Law Library and Technology">/);
  assert.match(appSource, /Visit the UConn Law Library Website/);
  assert.match(wordmarkSource, /<svg[\s\S]*fill: #ffffff/);
  assert.match(appSource, /if \(route\.kind === "about"\) return renderAbout\(catalog\)/);
  assert.match(stylesSource, /\.about-source-list \{ display: grid/);
});

test("statute metadata shares one populated Information and References region", () => {
  assert.match(appSource, /<h2 id="information-references-heading">Information &amp; References<\/h2>/);
  assert.match(appSource, /renderInformationReferences\(section, maps, secondaryContext, change\)/);
  assert.match(appSource, /renderNotes\([^\n]+"Source"[\s\S]*renderSecondaryContext\(secondaryContext\)/);
  assert.doesNotMatch(appSource, /renderNotes\([^\n]+"Source"[^\n]+\{ open: true \}/);
  assert.doesNotMatch(appSource, /Official cross-references|Related legal data/);
  assert.match(stylesSource, /\.information-reference-groups > details \{ border-top: 1px solid var\(--line\); \}/);
  assert.doesNotMatch(stylesSource, /\.secondary-sources \{ margin-top:/);
});

test("amended supplement sections offer a collapsed native language comparison at the bottom", () => {
  assert.match(appSource, /<details class="revision-comparison" id=/);
  assert.match(appSource, /<summary>Compare with \$\{priorYear\} text<\/summary>/);
  assert.match(appSource, /<ins class="revision-addition">/);
  assert.match(appSource, /<del class="revision-deletion">/);
  assert.match(appSource, /renderInformationReferences\(section, maps, secondaryContext, change\)\}\s*\$\{comparison\}/);
  assert.doesNotMatch(appSource, /data-revision-comparison-toggle/);
  assert.match(stylesSource, /\.revision-addition \{ color: var\(--addition-ink\); background: var\(--addition-surface\)/);
  assert.match(stylesSource, /\.revision-deletion \{ color: var\(--deletion-ink\); background: var\(--deletion-surface\); text-decoration-color: currentColor/);
});

test("supplement notices use blue while repealed notices retain warning colors", () => {
  assert.match(stylesSource, /\.supplement-pill,[\s\S]*color: var\(--blue-dark\);[\s\S]*background: var\(--blue-light\);[\s\S]*border-color: var\(--blue\);/);
  assert.match(stylesSource, /\.context-list \.section-status-pill \{ color: var\(--warning-ink\); \}/);
  assert.match(stylesSource, /\.supplement-summary \{[^}]*color: var\(--blue-dark\);[^}]*background: var\(--blue-light\);[^}]*border-left: 4px solid var\(--blue\);/);
});

test("print layout removes application chrome and preserves a readable statute body", () => {
  assert.match(stylesSource, /@media print \{[\s\S]*\.context-column[\s\S]*display: none/);
  assert.match(stylesSource, /\.application-main, \.reader-content\.application-main \{ width: 100%;/);
  assert.match(stylesSource, /\.statute-text \{ font-size: 11pt; line-height: 1\.5; \}/);
});
