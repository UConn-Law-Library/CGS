import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("home statute browsing uses the application route instead of an unknown hash route", () => {
  assert.match(appSource, /<a href="#\/" data-browse-statutes>/);
  assert.doesNotMatch(appSource, /href="#browse-titles"/);
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
  assert.match(appSource, /if \(route\.kind === "about"\) return renderAbout\(catalog\)/);
  assert.match(stylesSource, /\.about-source-list \{ display: grid/);
});

test("statute metadata shares one populated Information and References region", () => {
  assert.match(appSource, /<h2 id="information-references-heading">Information &amp; References<\/h2>/);
  assert.match(appSource, /renderInformationReferences\(section, maps, secondaryContext, change\)/);
  assert.match(appSource, /renderNotes\([^\n]+"Source"[\s\S]*renderSecondaryContext\(secondaryContext\)/);
  assert.doesNotMatch(appSource, /Official cross-references|Related legal data/);
  assert.match(stylesSource, /\.information-reference-groups > details \{ border-top: 1px solid var\(--line\); \}/);
  assert.doesNotMatch(stylesSource, /\.secondary-sources \{ margin-top:/);
});
