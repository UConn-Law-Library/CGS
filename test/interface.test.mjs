import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("home statute browsing uses the application route instead of an unknown hash route", () => {
  assert.match(appSource, /<a href="#\/" data-browse-statutes>/);
  assert.doesNotMatch(appSource, /href="#browse-titles"/);
});

test("index letters render collapsed topic groups and chapter settings expose repealed filtering", () => {
  assert.match(appSource, /<details class="index-topic"/);
  assert.match(appSource, /renderIndexTopic\(topic, topic === selected\)/);
  assert.match(appSource, /<summary><strong>\$\{escapeHtml\(topic\.label\)\}<\/strong><\/summary>/);
  assert.match(appSource, /selectedTopic\?\.querySelector\("summary"\)\?\.scrollIntoView/);
  assert.match(stylesSource, /\.index-topic \{[^}]*scroll-margin-top: 8rem;/);
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
