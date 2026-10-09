import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeCoverage, GUIDE_PARTS, LEGISLATIVE_STAGES, OFFICIAL_LINKS, renderGuide } from "../src/guide.js";
import {
  editionStatus,
  editionType,
  exampleCycle,
  PUBLISHED_EDITIONS,
  publicationCycle,
  publicationForYear,
  regularSessionMonth
} from "../src/publications.js";
import { guideRouteHref, parseRoute } from "../src/routes.js";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const catalog = await json("../public/data/catalog.json");
const supplementManifest = await json("../public/data/supplements/2026/manifest.json");
const actsManifest = await json("../public/data/acts/manifest.json");
const coverage = describeCoverage({
  catalog,
  supplement: { edition: { editionYear: supplementManifest.editionYear }, manifest: supplementManifest },
  acts: actsManifest
});

test("odd years are full revisions and even years are supplements, each revised to January 1", () => {
  assert.equal(editionType(2025), "revision");
  assert.equal(editionType(2026), "supplement");
  assert.deepEqual(publicationForYear(2026), {
    year: 2026,
    type: "supplement",
    label: "2026 Supplement",
    kindLabel: "Supplement",
    revisedTo: "2026-01-01",
    revisedToLabel: "January 1, 2026",
    legislationThrough: 2025,
    newSessionYears: [2025],
    usedWith: 2025,
    replaces: [],
    status: "published",
    url: "https://www.cga.ct.gov/2026/sup/titles.htm"
  });
  const revision = publicationForYear(2027);
  assert.equal(revision.label, "2027 General Statutes");
  assert.deepEqual(revision.newSessionYears, [2025, 2026]);
  assert.deepEqual(revision.replaces, [2025, 2026]);
  assert.equal(regularSessionMonth(2025), "January");
  assert.equal(regularSessionMonth(2026), "February");
});

test("only confirmed editions are published; later years are anticipated and gaps make no claim", () => {
  assert.equal(publicationForYear(2027).status, "anticipated");
  assert.equal(publicationForYear(2027).url, null);
  const sparse = [{ year: 2023, url: "a" }, { year: 2026, url: "b" }];
  assert.equal(editionStatus(2024, sparse), null);
  assert.equal(editionStatus(2026, sparse), "published");
  assert.equal(editionStatus(2028, sparse), "anticipated");
});

test("the timeline and examples follow the latest published edition rather than a fixed year", () => {
  assert.deepEqual(publicationCycle().map((edition) => edition.year), [2023, 2024, 2025, 2026, 2027, 2028]);
  assert.deepEqual(exampleCycle(), { revisionYear: 2025, supplementYear: 2026, nextRevisionYear: 2027 });
  const later = [...PUBLISHED_EDITIONS, { year: 2027, url: "x" }, { year: 2028, url: "y" }];
  assert.deepEqual(publicationCycle(later).map((edition) => edition.year), [2025, 2026, 2027, 2028, 2029, 2030]);
  assert.deepEqual(exampleCycle(later), { revisionYear: 2027, supplementYear: 2028, nextRevisionYear: 2029 });
  // A cycle always starts with a revision, so each one pairs with the supplement after it.
  assert.equal(publicationCycle(later)[0].type, "revision");
});

test("the guide route is shareable and accepts a part", () => {
  assert.equal(guideRouteHref(), "#/guide");
  assert.equal(guideRouteHref("cycle"), "#/guide?part=cycle");
  assert.deepEqual(parseRoute({ hash: "#/guide" }), { kind: "guide", part: null });
  assert.deepEqual(parseRoute({ hash: "#/guide?part=cycle" }), { kind: "guide", part: "cycle" });
  assert.equal(parseRoute({ hash: "#/guide/extra" }).kind, "not-found");
});

test("coverage comes from the published manifests", () => {
  assert.equal(coverage.base.year, 2025);
  assert.equal(coverage.base.sections, catalog.counts.sections);
  assert.equal(coverage.supplement.year, 2026);
  assert.equal(coverage.supplement.replacements, supplementManifest.counts.replacements);
  assert.equal(coverage.supplement.additions, supplementManifest.counts.additions);
  assert.deepEqual(coverage.acts.sessions.map((session) => session.id), actsManifest.sessions.map((session) => session.id));
  // The 2025 sessions reach the app only through the supplement.
  assert.equal(coverage.acts.unlistedCoveredYear, actsManifest.sessions.some((session) => session.year === 2025) ? null : 2025);
});

test("coverage that fails to load is unknown rather than absent", () => {
  const html = renderGuide({ coverage: describeCoverage({ catalog, supplement: undefined, acts: undefined }) });
  assert.match(html, /Coverage details could not be loaded/);
  assert.doesNotMatch(html, /No supplement is merged|No Public Acts are listed/);
  const none = renderGuide({ coverage: describeCoverage({ catalog, supplement: null, acts: { sessions: [] } }) });
  assert.match(none, /No supplement is merged into the statute text\./);
  assert.match(none, /No Public Acts are listed\./);
});

test("the page covers each part and states the app's actual coverage", () => {
  const html = renderGuide({ coverage });
  for (const part of GUIDE_PARTS) assert.match(html, new RegExp(`id="guide-${part.id}-heading"`));
  assert.equal(LEGISLATIVE_STAGES.length, 7);
  for (const stage of LEGISLATIVE_STAGES) assert.ok(html.includes(stage.title));
  assert.match(html, /Merged into the statute text section by section: 1,602 sections replaced and 350 added/);
  assert.match(html, /are <strong>not merged<\/strong> into the statute text/);
  assert.match(html, /not the official publication of Connecticut law/);
  assert.match(html, /A law can already be in effect even if the updated language has not yet appeared in the published General Statutes\./);
  assert.match(html, /The most recent published statutory text is not always the complete picture\./);
  assert.match(html, /A section-number search is not exhaustive\./);
  assert.match(html, /Fictional example\. Not real law\./);
  // The anticipated edition is labeled, and never linked as if it existed.
  assert.match(html, /2027 General Statutes <span class="guide-status guide-status-anticipated">Anticipated<\/span>/);
  assert.doesNotMatch(html, /cga\.ct\.gov\/2027\//);
  // Codification is never presented as what makes a law effective.
  assert.match(html, /Codification does not make a law effective\./);
});

test("interactive controls name what they control and start with one selection", () => {
  const html = renderGuide({ coverage });
  assert.equal((html.match(/data-guide-stage="\d+"/g) ?? []).length, 7);
  assert.equal((html.match(/aria-controls="guide-stage-panel"/g) ?? []).length, 7);
  assert.match(html, /aria-pressed="true" aria-controls="guide-stage-panel" data-guide-stage="0"/);
  assert.equal((html.match(/data-guide-year="\d{4}"/g) ?? []).length, 6);
  assert.match(html, /aria-pressed="true" aria-controls="guide-year-panel" data-guide-year="2026"/);
  assert.equal((html.match(/data-guide-stage-detail="\d+">/g) ?? []).length, 1);
  assert.equal((html.match(/<input type="radio" name="guide-moment"[^>]* checked/g) ?? []).length, 1);
});

test("official links point to the verified General Assembly pages", () => {
  for (const href of Object.values(OFFICIAL_LINKS)) assert.match(href, /^https:\/\/(www\.cga\.ct\.gov|search\.cga\.state\.ct\.us)\//);
  const html = renderGuide({ coverage });
  assert.ok(html.includes("https://www.cga.ct.gov/2025/pub/titles.htm"));
  assert.ok(html.includes("https://www.cga.ct.gov/2026/sup/titles.htm"));
  assert.ok(html.includes(OFFICIAL_LINKS.conversionTables));
  assert.ok(html.includes(OFFICIAL_LINKS.referenceTables));
  assert.ok(html.includes(OFFICIAL_LINKS.billFlowchart));
  assert.doesNotMatch(html, /target="_blank"(?![^>]*rel="noopener")/);
});
