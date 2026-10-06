import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ActsRepository,
  actsCurrencyNote,
  actTextPattern,
  effectiveDateOptions,
  effectiveRows,
  filterActs,
  matchActText,
  normalizeActsOptions,
  parseEffective,
  parseSectionsParameter,
  renderActDocument,
  renderActSections,
  renderActsTable,
  renderEffectiveTable,
  sectionsLabel,
  sentenceCaseTitle,
  sectionsParameter,
  sectionsSummary,
  tokenizeActText
} from "../src/acts.js";
import { actRouteHref, actsRouteHref, parseRoute } from "../src/routes.js";
import { validateActs } from "../scripts/lib/acts-validator.mjs";

function act(number, type = "public", title = "AN ACT CONCERNING TESTS.", bill = `HB ${5000 + number}`) {
  const prefix = type === "public" ? "P.A." : "S.A.";
  return {
    id: `${type === "public" ? "pa" : "sa"}-2026-regular-${number}`,
    type,
    number,
    citation: `${prefix} 26-${number}`,
    title,
    bill,
    billUrl: `https://www.cga.ct.gov/bill/${number}`,
    url: `https://www.cga.ct.gov/act/${number}.pdf`
  };
}

const acts = [
  act(15, "public", "AN ACT CONCERNING ONLINE SAFETY.", "SB 5"),
  act(150, "public", "AN ACT ADOPTING THE INTEGRATED SETTING STANDARD."),
  act(151, "public", "AN ACT CONCERNING <SIGN> LANGUAGE.", "HB 5557"),
  act(15, "special", "AN ACT CONVEYING A PARCEL OF STATE LAND.")
];

test("round-trips acts routes and normalizes unknown options", () => {
  const href = actsRouteHref({ session: "2026-regular", type: "special", query: "state land", sort: "number" });
  assert.equal(href, "#/acts?session=2026-regular&type=special&q=state%20land&sort=number");
  assert.deepEqual(parseRoute({ hash: href }), { kind: "acts", session: "2026-regular", type: "special", query: "state land", sort: "number", order: null, view: null, on: null });
  assert.equal(actsRouteHref({ sort: "newest" }), "#/acts");
  assert.deepEqual(normalizeActsOptions({ type: "secret", sort: "random", query: "  " }), { session: null, type: null, query: null, sort: "newest", order: "asc", view: "acts", on: null });
});

test("lists public acts before special acts, newest first by default", () => {
  assert.deepEqual(filterActs(acts).map((value) => value.citation), ["P.A. 26-151", "P.A. 26-150", "P.A. 26-15", "S.A. 26-15"]);
  assert.deepEqual(filterActs(acts, { sort: "number" }).map((value) => value.citation), ["P.A. 26-15", "P.A. 26-150", "P.A. 26-151", "S.A. 26-15"]);
  assert.deepEqual(filterActs(acts, { type: "special" }).map((value) => value.citation), ["S.A. 26-15"]);
});

test("matches citations and bills exactly and other text by words", () => {
  for (const query of ["PA 26-15", "p.a. 26-15", "P.A.26-15"]) {
    assert.deepEqual(filterActs(acts, { query }).map((value) => value.citation), ["P.A. 26-15"], query);
  }
  assert.deepEqual(filterActs(acts, { query: "sa 26-15" }).map((value) => value.citation), ["S.A. 26-15"]);
  assert.deepEqual(filterActs(acts, { query: "hb05557" }).map((value) => value.citation), ["P.A. 26-151"]);
  assert.deepEqual(filterActs(acts, { query: "SB 5" }).map((value) => value.citation), ["P.A. 26-15"]);
  assert.deepEqual(filterActs(acts, { query: "state land" }).map((value) => value.citation), ["S.A. 26-15"]);
  assert.deepEqual(filterActs(acts, { query: "online parcel" }), []);
});

test("matches special-session citations", () => {
  const special = { ...act(2), id: "pa-2026-june-special-2", citation: "P.A. 26-2 (June Sp. Sess.)" };
  assert.deepEqual(filterActs([special, act(2)], { query: "PA 26-2" }).map((value) => value.id), ["pa-2026-june-special-2", "pa-2026-regular-2"]);
});

test("states whether the statute text reflects a session", () => {
  const session = { year: 2026, name: "2026 Regular Session" };
  assert.match(actsCurrencyNote(session, 2026), /2026 Supplement, which reflects legislation through the 2025 session\. Acts from the 2026 Regular Session are not yet reflected/);
  assert.match(actsCurrencyNote({ year: 2025, name: "2025 Regular Session" }, 2026), /should already be reflected in the 2026 Supplement/);
  assert.match(actsCurrencyNote(session, null), /may not yet be reflected/);
});

test("renders an escaped, labeled table", () => {
  const html = renderActsTable(acts.slice(2, 3), "2026 Regular Session acts");
  assert.match(html, /<caption class="visually-hidden">2026 Regular Session acts<\/caption>/);
  assert.match(html, /<th scope="row"><a href="https:\/\/www\.cga\.ct\.gov\/act\/151\.pdf" target="_blank" rel="noopener">P\.A\. 26-151<span class="visually-hidden"> \(PDF\)<\/span><\/a>/);
  assert.match(html, /CONCERNING &lt;SIGN&gt; LANGUAGE/);
});

test("loads the newest session by default and a named session on request", async () => {
  const files = {
    "manifest.json": { sessions: [{ id: "2026-regular", path: "2026-regular.json" }, { id: "2025-regular", path: "2025-regular.json" }] },
    "2026-regular.json": { acts: [act(1)] },
    "2025-regular.json": { acts: [] }
  };
  const requested = [];
  const repository = new ActsRepository({
    baseUrl: "http://localhost/data/acts/",
    fetchImpl: async (url) => {
      const name = String(url).split("/").pop();
      requested.push(name);
      return { ok: true, json: async () => files[name] };
    }
  });
  assert.equal((await repository.loadSession()).entry.id, "2026-regular");
  assert.equal((await repository.loadSession("2025-regular")).entry.id, "2025-regular");
  assert.equal((await repository.loadSession("1999-regular")).entry, null);
  assert.deepEqual(requested, ["manifest.json", "2026-regular.json", "2025-regular.json"]);
});

test("validates the published acts and detects tampering", async (t) => {
  const published = await validateActs({ actsDir: path.resolve("public/data/acts"), schemaDir: path.resolve("schemas") });
  assert.deepEqual(published.errors, []);
  assert.ok(published.counts.acts > 0);

  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-acts-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(path.resolve("public/data/acts"), temporary, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(temporary, "manifest.json"), "utf8"));
  const file = path.join(temporary, manifest.sessions[0].path);
  const session = JSON.parse(await readFile(file, "utf8"));
  session.acts[0].title = "CHANGED";
  await writeFile(file, `${JSON.stringify(session, null, 2)}\n`);
  const tampered = await validateActs({ actsDir: temporary, schemaDir: path.resolve("schemas") });
  assert.ok(tampered.errors.some((error) => error.includes("SHA-256 do not match")));

  assert.deepEqual((await validateActs({ actsDir: path.join(temporary, "missing"), schemaDir: path.resolve("schemas") })).present, false);
});

test("round-trips act routes", () => {
  const href = actRouteHref("2026-regular", act(15, "special"), { section: "3", query: "state land" });
  assert.equal(href, "#/acts/2026-regular/sa-15?section=3&q=state%20land");
  assert.deepEqual(parseRoute({ hash: href }), { kind: "act", session: "2026-regular", act: "sa-2026-regular-15", section: "3", sections: null, query: "state land" });
  assert.deepEqual(parseRoute({ hash: "#/acts/2026-regular/pa-007" }), { kind: "act", session: "2026-regular", act: "pa-2026-regular-7", section: null, sections: null, query: null });
  assert.deepEqual(parseRoute({ hash: "#/acts/2026-regular/hb-5" }), { kind: "not-found" });
});

const index = {
  acts: ["pa-2026-regular-15", "pa-2026-regular-150", "sa-2026-regular-15"],
  terms: { "22a-245": [0], redemption: [0, 1], redeemed: [1], centers: [0], of: [0, 1, 2], parcel: [2] }
};

test("searches act text by words, prefixes, and citations", () => {
  assert.deepEqual(tokenizeActText("Section 22a-245, the Commissioner’s"), ["section", "22a-245", "the", "commissioner"]);
  assert.deepEqual([...matchActText(index, "redemption centers")], ["pa-2026-regular-15"]);
  assert.deepEqual([...matchActText(index, "redemp")].sort(), ["pa-2026-regular-15", "pa-2026-regular-150"]);
  assert.deepEqual([...matchActText(index, "22a-245")], ["pa-2026-regular-15"]);
  assert.deepEqual([...matchActText(index, "redemption parcel")], []);
  assert.equal(matchActText(index, "PA 26-15"), null);
  assert.equal(matchActText(null, "redemption"), null);
  const shown = filterActs(acts, { query: "redeemed" }, matchActText(index, "redeemed"));
  assert.deepEqual(shown.map((value) => value.citation), ["P.A. 26-150"]);
});

test("links acts with text to the reader and flags matches found only in the text", () => {
  const withText = acts.map((value) => ({ ...value, text: { path: `2026-regular/text/${value.id}.json`, bytes: 1, sha256: "0".repeat(64), pages: 1 } }));
  const html = renderActsTable(withText.slice(0, 2), "acts", { session: "2026-regular", query: "online parcel", textMatches: new Set(["pa-2026-regular-150"]) });
  assert.match(html, /<th scope="row"><a href="#\/acts\/2026-regular\/pa-15">P\.A\. 26-15<\/a>/);
  assert.match(html, /href="#\/acts\/2026-regular\/pa-150\?q=online%20parcel"/);
  assert.equal(html.match(/act-text-match/g)?.length, 1);
  assert.match(html, /class="act-pdf" href="https:\/\/www\.cga\.ct\.gov\/act\/15\.pdf"/);
});

test("renders act text with added and deleted language, tables, sections, and statute links", () => {
  const document = {
    sections: [{ number: "1", anchor: "sec-1", effective: "Effective October 1, 2026" }],
    blocks: [
      { type: "p", page: 1, anchor: "sec-1", section: "1", runs: ["Section 1. Section 22a-245 is amended to read <b>: [five] ", { ins: "four" }, " days."] },
      { type: "table", page: 2, rows: [[["Year one"], [{ ins: "Ninety per cent" }]]] },
      { type: "action", page: 2, runs: ["Governor's Action:"] },
      { type: "action", page: 2, runs: ["Approved June 2, 2026"] }
    ]
  };
  const maps = { sections: new Map([["22a-245", "#/t/22a/c/446d/s/22a-245"]]), chapters: new Map() };
  const html = renderActDocument(document, maps);
  assert.match(html, /<p id="sec-1" class="act-section-start" tabindex="-1">Section 1\. Section <a class="legal-reference" href="#\/t\/22a\/c\/446d\/s\/22a-245">22a-245<\/a> is amended to read &lt;b&gt;: <del class="revision-deletion"><span class="act-bracket" aria-hidden="true">\[<\/span>five<span class="act-bracket" aria-hidden="true">\]<\/span><\/del> <ins class="revision-addition">four<\/ins> days\.<\/p>/);
  assert.match(html, /role="region" tabindex="0" aria-label="Table from page 2 of the act"><table class="act-table"><tbody><tr><td>Year one<\/td><td><ins class="revision-addition">Ninety per cent<\/ins><\/td><\/tr>/);
  assert.match(html, /<p class="act-action">Governor&#39;s Action:<br>Approved June 2, 2026<\/p>/);
  const sections = renderActSections(document, (section) => `#/acts/2026-regular/pa-83?section=${section.number}`);
  assert.match(sections, /<details class="act-sections" open>/);
  assert.match(sections, /<a href="#\/acts\/2026-regular\/pa-83\?section=1">Sec\. 1<\/a> <small>Effective October 1, 2026<\/small>/);
});

test("continues a deletion across paragraphs and table cells", () => {
  const html = renderActDocument({
    sections: [],
    blocks: [
      { type: "p", page: 1, runs: ["Kept [(a) Removed"] },
      { type: "p", page: 1, runs: ["(b) Also removed."] },
      { type: "table", page: 1, rows: [[["Gone]"], ["Kept too"]]] },
      { type: "p", page: 1, runs: ["Trailing [", { ins: "new" }] },
      { type: "p", page: 1, runs: ["] after"] }
    ]
  });
  const bracket = (value) => `<span class="act-bracket" aria-hidden="true">${value}</span>`;
  assert.ok(html.includes(`<p>Kept <del class="revision-deletion">${bracket("[")}(a) Removed</del></p>`), html);
  assert.ok(html.includes(`<p><del class="revision-deletion">(b) Also removed.</del></p>`), html);
  assert.ok(html.includes(`<td><del class="revision-deletion">Gone${bracket("]")}</del></td><td>Kept too</td>`), html);
  assert.ok(html.includes(`<p>Trailing <del class="revision-deletion">${bracket("[")}</del><ins class="revision-addition">new</ins></p>`), html);
  assert.ok(html.includes(`<p><del class="revision-deletion">${bracket("]")}</del> after</p>`), html);
});

test("highlights query words, including longer words they begin", () => {
  const pattern = actTextPattern("redeem of");
  assert.deepEqual("Redeemed often, of course".match(pattern), ["Redeemed", "of"]);
  assert.equal(actTextPattern("SB 5"), null);
  assert.equal(actTextPattern("  "), null);
});

async function rehash(root, relative, change) {
  // Rewrite a published file and update every digest that refers to it.
  const file = path.join(root, ...relative.split("/"));
  const bytes = Buffer.from(change(await readFile(file, "utf8")));
  await writeFile(file, bytes);
  const identity = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const manifestFile = path.join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  for (const record of [...manifest.artifacts, ...manifest.sessions, ...manifest.sessions.flatMap((entry) => [entry.search, entry.effective]).filter(Boolean)]) {
    if (record.path === relative) Object.assign(record, identity);
  }
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, identity };
}

test("validates act texts and the search index", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-acts-text-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(path.resolve("public/data/acts"), temporary, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(temporary, "manifest.json"), "utf8"));
  const entry = manifest.sessions[0];
  const session = JSON.parse(await readFile(path.join(temporary, entry.path), "utf8"));
  const withText = session.acts.find((value) => value.text);
  assert.ok(withText, "the published acts include text");
  assert.equal(entry.counts.textActs, session.acts.filter((value) => value.text).length);

  const { identity } = await rehash(temporary, withText.text.path, (value) => value.replace(`"id":"${withText.id}"`, `"id":"${withText.id}0"`));
  await rehash(temporary, entry.path, (value) => {
    const changed = JSON.parse(value);
    Object.assign(changed.acts.find((candidate) => candidate.id === withText.id).text, identity);
    return `${JSON.stringify(changed, null, 2)}\n`;
  });
  await rehash(temporary, entry.search.path, (value) => {
    const changed = JSON.parse(value);
    changed.terms.zzzz = [changed.acts.length];
    return `${JSON.stringify(changed)}\n`;
  });
  const { errors } = await validateActs({ actsDir: temporary, schemaDir: path.resolve("schemas") });
  assert.ok(errors.some((error) => error.includes(`text is for ${withText.id}0, not ${withText.id}`)), errors.join("\n"));
  assert.ok(errors.some((error) => error.includes('term "zzzz" must list ascending act positions')), errors.join("\n"));
  assert.equal(errors.filter((error) => error.includes("SHA-256")).length, 0, errors.join("\n"));
});

test("round-trips the effective-date view and act section selections", () => {
  const href = actsRouteHref({ view: "effective", query: "tax", on: "2026-10-01" });
  assert.equal(href, "#/acts?view=effective&q=tax&on=2026-10-01");
  assert.deepEqual(parseRoute({ hash: href }), { kind: "acts", session: null, type: null, query: "tax", sort: null, order: null, view: "effective", on: "2026-10-01" });
  assert.equal(actsRouteHref({ view: "effective", sort: "effective", order: "asc" }), "#/acts?view=effective");
  assert.equal(actsRouteHref({ view: "effective", sort: "act", order: "desc" }), "#/acts?view=effective&sort=act&order=desc");
  assert.deepEqual(normalizeActsOptions({ view: "effective", on: "2026-10-01" }), { session: null, type: null, query: null, sort: "effective", order: "asc", view: "effective", on: "2026-10-01" });
  assert.equal(normalizeActsOptions({ view: "effective", sort: "newest", order: "desc" }).sort, "effective");
  assert.equal(normalizeActsOptions({ view: "effective", sort: "act", order: "desc" }).order, "desc");
  assert.equal(normalizeActsOptions({ sort: "act", order: "desc" }).sort, "newest");
  assert.equal(normalizeActsOptions({ view: "other", on: "October" }).view, "acts");
  assert.equal(normalizeActsOptions({ on: "October" }).on, null);
  assert.equal(normalizeActsOptions({ on: "passage" }).on, null);
  const act150 = actRouteHref("2026-regular", act(150), { sections: "1-3,7" });
  assert.equal(act150, "#/acts/2026-regular/pa-150?sections=1-3,7");
  assert.equal(parseRoute({ hash: act150 }).sections, "1-3,7");
});

test("reads effective dates, placing from passage on the approval date", () => {
  assert.deepEqual(parseEffective("Effective July 1, 2026"), { date: "2026-07-01", fromPassage: false, label: "July 1, 2026", qualifier: "" });
  assert.deepEqual(parseEffective("Effective from passage", "Approved June 4, 2026"), { date: "2026-06-04", fromPassage: true, label: "June 4, 2026", qualifier: "" });
  assert.equal(parseEffective("Effective October 1, 2026, and applicable to sales occurring on or after October 1, 2026").qualifier, "Applicable to sales occurring on or after October 1, 2026");
  assert.equal(parseEffective("Effective from passage and applicable to any civil action pending", "Approved June 4, 2026").qualifier, "Applicable to any civil action pending");
  assert.deepEqual(parseEffective("Effective from passage"), { date: null, fromPassage: true, label: "Effective from passage", qualifier: "" });
  assert.deepEqual(parseEffective(null), { date: null, fromPassage: false, label: "No effective date stated", qualifier: "" });
  assert.equal(parseEffective("Effective upon a future event").label, "Effective upon a future event");
});

const effectiveIndex = {
  acts: [
    { id: "pa-2026-regular-150", approved: "Approved June 4, 2026", dates: [{ effective: "Effective October 1, 2026", sections: ["1", "2"] }, { effective: "Effective from passage", sections: ["3"] }, { effective: "Effective upon a future event", sections: ["4"] }] },
    { id: "pa-2026-regular-15", approved: "Approved May 1, 2026", dates: [{ effective: "Effective October 1, 2026", sections: ["1"] }, { effective: "Effective July 1, 2026, and applicable to sales", sections: ["2", "3", "5"] }] }
  ]
};
const publicActs = acts.filter((value) => value.type === "public");
const rowSummary = (rows) => rows.map((row) => `${row.act.citation} ${row.label} ${row.sections.join()}`);

test("lists effective dates one row per act and date, sorted by either column", () => {
  assert.deepEqual(rowSummary(effectiveRows(publicActs, effectiveIndex)), [
    "P.A. 26-150 June 4, 2026 3",
    "P.A. 26-15 July 1, 2026 2,3,5",
    "P.A. 26-15 October 1, 2026 1",
    "P.A. 26-150 October 1, 2026 1,2",
    "P.A. 26-150 Effective upon a future event 4"
  ]);
  assert.deepEqual(rowSummary(effectiveRows(publicActs, effectiveIndex, { order: "desc" })), [
    "P.A. 26-15 October 1, 2026 1",
    "P.A. 26-150 October 1, 2026 1,2",
    "P.A. 26-15 July 1, 2026 2,3,5",
    "P.A. 26-150 June 4, 2026 3",
    "P.A. 26-150 Effective upon a future event 4"
  ]);
  assert.deepEqual(rowSummary(effectiveRows(publicActs, effectiveIndex, { sort: "act", order: "desc" })), [
    "P.A. 26-150 June 4, 2026 3",
    "P.A. 26-150 October 1, 2026 1,2",
    "P.A. 26-150 Effective upon a future event 4",
    "P.A. 26-15 July 1, 2026 2,3,5",
    "P.A. 26-15 October 1, 2026 1"
  ]);
  assert.deepEqual(effectiveDateOptions(effectiveRows(publicActs, effectiveIndex)), [["2026-06-04", "June 4, 2026"], ["2026-07-01", "July 1, 2026"], ["2026-10-01", "October 1, 2026"]]);
  assert.deepEqual(effectiveRows(acts, null), []);
});

test("renders the effective-date table with dates, sentence-case titles, and sortable headings", () => {
  const rows = effectiveRows(publicActs, effectiveIndex, { sort: "act", order: "desc" });
  const sortHref = (sort, order) => `#sort=${sort}-${order}`;
  const html = renderEffectiveTable(rows, "Public Acts by effective date", { session: "2026-regular", sort: "act", order: "desc", sortHref });
  assert.match(html, /<th scope="col" aria-sort="descending"><a class="sort-link" href="#sort=act-asc" data-sort-column="act">Public Act<span class="sort-arrow" aria-hidden="true">▼<\/span><span class="visually-hidden">, sort ascending<\/span><\/a><\/th>/);
  assert.match(html, /<th scope="col"><a class="sort-link" href="#sort=effective-asc" data-sort-column="effective">Effective<span class="visually-hidden">, sort ascending<\/span><\/a><\/th><th scope="col">Title<\/th><th scope="col">Sections<\/th>/);
  assert.match(html, /<td class="act-effective"><time datetime="2026-06-04">June 4, 2026<\/time><\/td>\s*<td class="act-effective-title">An act adopting the integrated setting standard\.<\/td>/);
  assert.match(html, /<a href="#\/acts\/2026-regular\/pa-15\?sections=2-3,5">Secs\. 2–3, 5<\/a><small>Applicable to sales<\/small>/);
  assert.match(html, /<td class="act-effective">Effective upon a future event<\/td>/);
});

test("shows act titles in sentence case, keeping proper names", () => {
  assert.equal(sentenceCaseTitle("AN ACT CONCERNING THE OFFICE OF EARLY CHILDHOOD."), "An act concerning the Office of Early Childhood.");
  assert.equal(sentenceCaseTitle("AN ACT ESTABLISHING THE CONNECTICUT-GERMANY AND CONNECTICUT-INDIA TRADE COMMISSIONS."), "An act establishing the Connecticut-Germany and Connecticut-India trade commissions.");
  assert.equal(sentenceCaseTitle("AN ACT ADOPTING THE INTEGRATED SETTING STANDARD OF THE AMERICANS WITH DISABILITIES ACT FOR PUBLIC ENTITIES."), "An act adopting the integrated setting standard of the Americans with Disabilities Act for public entities.");
  assert.equal(sentenceCaseTitle("AN ACT MAKING ADJUSTMENTS FOR THE BIENNIUM ENDING JUNE 30, 2027, AND CERTAIN CLASS I RENEWABLE ENERGY SOURCES."), "An act making adjustments for the biennium ending June 30, 2027, and certain Class I renewable energy sources.");
  assert.equal(sentenceCaseTitle("AN ACT CONCERNING MEDICAID IN THE TOWN OF PUTNAM, AS THE GOVERNOR MAY DIRECT."), "An act concerning Medicaid in the town of Putnam, as the Governor may direct.");
  assert.equal(sentenceCaseTitle("AN ACT CONCERNING REDEMPTION CENTERS."), "An act concerning redemption centers.");
});

test("names, links, and parses runs of section numbers", () => {
  assert.equal(sectionsLabel(["4"]), "Sec. 4");
  assert.equal(sectionsLabel(["1", "2", "3", "7", "9", "10"]), "Secs. 1–3, 7, 9–10");
  assert.equal(sectionsParameter(["1", "2", "3", "7"]), "1-3,7");
  assert.deepEqual([...parseSectionsParameter("1-3,7")], ["1", "2", "3", "7"]);
  for (const invalid of [null, "", "3-1", "a", "1,,2", "1-99999"]) assert.equal(parseSectionsParameter(invalid), null, invalid);
  assert.equal(sectionsSummary(["1", "2"], 6), "Secs. 1–2 of 6 sections");
  assert.equal(sectionsSummary(["1", "3", "5", "7", "9", "11", "13"], 20), "7 of 20 sections");
});

test("shows only the selected sections of an act", () => {
  const document = {
    sections: [{ number: "1", anchor: "sec-1", effective: "Effective July 1, 2026" }, { number: "2", anchor: "sec-2", effective: "Effective October 1, 2026" }],
    blocks: [
      { type: "p", page: 1, runs: ["Be it enacted"] },
      { type: "p", page: 1, anchor: "sec-1", section: "1", runs: ["Section 1. First [deleted"] },
      { type: "p", page: 1, section: "1", runs: ["still deleted]."] },
      { type: "p", page: 1, anchor: "sec-2", section: "2", runs: ["Sec. 2. Second."] },
      { type: "table", page: 2, section: "2", rows: [[["Cell"]]] },
      { type: "action", page: 2, runs: ["Approved June 2, 2026"] }
    ]
  };
  const html = renderActDocument(document, {}, { sections: new Set(["2"]) });
  assert.doesNotMatch(html, /Be it enacted|First|still deleted|act-action/);
  assert.match(html, /<p id="sec-2" class="act-section-start" tabindex="-1">Sec\. 2\. Second\.<\/p>/);
  assert.match(html, /<td>Cell<\/td>/);
  const first = renderActDocument(document, {}, { sections: new Set(["1"]) });
  assert.match(first, /<p><del class="revision-deletion">still deleted<span class="act-bracket" aria-hidden="true">\]<\/span><\/del>\.<\/p>/);
  const jump = renderActSections(document, (section) => `#s${section.number}`, { sections: new Set(["2"]) });
  assert.match(jump, /1 section and effective dates/);
  assert.doesNotMatch(jump, /#s1/);
});

test("validates the effective-date index against the act texts", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cgs-acts-effective-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(path.resolve("public/data/acts"), temporary, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(temporary, "manifest.json"), "utf8"));
  const entry = manifest.sessions[0];
  assert.equal(entry.effective.path, `${entry.id}/effective.json`);
  let changedId;
  await rehash(temporary, entry.effective.path, (value) => {
    const changed = JSON.parse(value);
    const target = changed.acts.find((candidate) => candidate.dates.length);
    changedId = target.id;
    target.dates[0].effective = "Effective someday";
    return `${JSON.stringify(changed)}\n`;
  });
  const { errors } = await validateActs({ actsDir: temporary, schemaDir: path.resolve("schemas") });
  assert.deepEqual(errors, [`acts/${entry.effective.path}: ${changedId} does not match its text's sections and effective dates`]);
});
