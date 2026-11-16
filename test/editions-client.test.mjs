import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { currentEditionSummary, EditionsRepository, officialSourceUrl, renderArchivedEditionNotice, renderEditionsPage, statuteEditionLabel } from "../src/editions.js";
import { parseRoute, routeHref, titlesRouteHref } from "../src/routes.js";
import { buildEditionFixture } from "../scripts/lib/edition-fixture.mjs";
import { rolloverEdition } from "../scripts/lib/edition-archive.mjs";
import { buildEditions } from "../scripts/lib/editions-build.mjs";

test("archived section links are stable, shareable routes beside the current ones", () => {
  assert.equal(routeHref({ title: "1", chapter: "001", section: "1-1", edition: "2025" }), "#/editions/2025/t/1/c/001/s/1-1");
  assert.equal(routeHref({ title: "1", chapter: "001", section: "1-1" }), "#/t/1/c/001/s/1-1");
  assert.equal(titlesRouteHref("2025"), "#/editions/2025");
  assert.deepEqual(parseRoute({ hash: "#/editions" }), { kind: "editions" });
  assert.deepEqual(parseRoute({ hash: "#/editions/2025" }), { kind: "titles", edition: "2025" });
  assert.deepEqual(parseRoute({ hash: "#/editions/2025/t/1/c/001/s/1-1/p/a" }), { kind: "section", title: "1", chapter: "001", section: "1-1", subsection: "a", edition: "2025" });
  assert.deepEqual(parseRoute({ hash: "#/editions/2025/t/1/c/001" }), { kind: "chapter", title: "1", chapter: "001", edition: "2025" });
  assert.deepEqual(parseRoute({ hash: "#/editions/current" }), { kind: "not-found" });
  assert.deepEqual(parseRoute({ hash: "#/editions/2025/x" }), { kind: "not-found" });
  // Current routes are unchanged.
  assert.deepEqual(parseRoute({ hash: "#/t/1/c/001/s/1-1" }), { kind: "section", title: "1", chapter: "001", section: "1-1", subsection: null });
});

test("archived official links point at the edition's own year-scoped pages", () => {
  const sources = [{ from: "https://www.cga.ct.gov/current/pub/", to: "https://www.cga.ct.gov/2025/pub/" }];
  assert.equal(officialSourceUrl("https://www.cga.ct.gov/current/pub/chap_001.htm#sec_1-1", sources), "https://www.cga.ct.gov/2025/pub/chap_001.htm#sec_1-1");
  assert.equal(officialSourceUrl("https://www.cga.ct.gov/2026/sup/chap_001.htm#sec_1-1", sources), "https://www.cga.ct.gov/2026/sup/chap_001.htm#sec_1-1");
});

test("the editions page describes the current edition and an empty archive", () => {
  const current = currentEditionSummary({ source: { revisionYear: 2025 } }, { editionYear: 2026 });
  assert.deepEqual(current, { revisionYear: 2025, supplementYears: [2026], label: "General Statutes revised to January 1, 2025, with the 2026 Supplement", legislationThrough: 2025 });
  const html = renderEditionsPage({ current, index: { statutes: [] }, routes: { current: "#/titles", edition: (id) => `#/editions/${id}` }, formatDate: () => "date" });
  assert.match(html, /<h1>Editions<\/h1>/);
  assert.match(html, /Reflects legislation through the 2025 sessions/);
  assert.match(html, /No earlier editions are archived yet/);
  assert.equal(statuteEditionLabel(2027), "General Statutes revised to January 1, 2027");
  const notice = renderArchivedEditionNotice({ edition: { label: statuteEditionLabel(2025, [2026]), supersededBy: 2027 }, currentHref: "#/t/1", editionsHref: "#/editions" });
  assert.match(notice, /Archived edition\.<\/strong> General Statutes revised to January 1, 2025, with the 2026 Supplement\. The 2027 revision replaced this text; it is not the current law\./);
});

test("the built editions index opens an archived edition with its own supplement and citations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-editions-client-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { published, candidate } = await buildEditionFixture(root);
  await rolloverEdition({ publishedDir: published, candidateDir: candidate, schemaDir: path.resolve("schemas") });
  const index = await buildEditions({ dataDir: candidate, generatedAt: "2027-07-14T00:00:00Z" });
  assert.equal(index.statutes.length, 1);
  const [entry] = index.statutes;
  assert.equal(entry.id, "2025");
  assert.equal(entry.supersededBy, 2027);
  assert.deepEqual(entry.supplementYears, [2026]);
  // Archived search shards are not published; the reader needs only chapters and citations.
  await assert.rejects(() => readFile(path.join(candidate, "editions", "statutes", "2025", "search", "manifest.json")));

  const fetchImpl = async (url) => {
    const relative = decodeURIComponent(new URL(url).pathname).replace(/^\/data\//, "");
    try {
      return new Response(await readFile(path.join(candidate, relative)), { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  };
  const repository = new EditionsRepository({ baseUrl: "http://localhost/data/editions/", fetchImpl });
  assert.equal(await repository.statuteEdition("1999"), null);
  const edition = await repository.statuteEdition("2025");
  assert.equal(edition.catalog.source.revisionYear, 2025);
  const latest = await edition.supplements.loadLatestChapter("001", "title-01");
  assert.equal(latest.edition.editionYear, 2026);
  assert.match(JSON.stringify(latest.chapter), /As amended by the 2026 Supplement/);
  const citations = await edition.loadCitations("title-01");
  assert.deepEqual(citations["1-1"], ["001", "1-1"]);
  assert.deepEqual(citations["1-99"], ["001", "1-99"]);
});
