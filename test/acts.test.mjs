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
  filterActs,
  matchActText,
  normalizeActsOptions,
  renderActDocument,
  renderActSections,
  renderActsTable,
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
  assert.deepEqual(parseRoute({ hash: href }), { kind: "acts", session: "2026-regular", type: "special", query: "state land", sort: "number" });
  assert.equal(actsRouteHref({ sort: "newest" }), "#/acts");
  assert.deepEqual(normalizeActsOptions({ type: "secret", sort: "random", query: "  " }), { session: null, type: null, query: null, sort: "newest" });
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
  assert.deepEqual(parseRoute({ hash: href }), { kind: "act", session: "2026-regular", act: "sa-2026-regular-15", section: "3", query: "state land" });
  assert.deepEqual(parseRoute({ hash: "#/acts/2026-regular/pa-007" }), { kind: "act", session: "2026-regular", act: "pa-2026-regular-7", section: null, query: null });
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

test("renders act text with added language, tables, sections, and statute links", () => {
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
  assert.match(html, /<p id="sec-1" class="act-section-start" tabindex="-1">Section 1\. Section <a class="legal-reference" href="#\/t\/22a\/c\/446d\/s\/22a-245">22a-245<\/a> is amended to read &lt;b&gt;: \[five\] <ins>four<\/ins> days\.<\/p>/);
  assert.match(html, /role="region" tabindex="0" aria-label="Table from page 2 of the act"><table class="act-table"><tbody><tr><td>Year one<\/td><td><ins>Ninety per cent<\/ins><\/td><\/tr>/);
  assert.match(html, /<p class="act-action">Governor&#39;s Action:<br>Approved June 2, 2026<\/p>/);
  const sections = renderActSections(document, (section) => `#/acts/2026-regular/pa-83?section=${section.number}`);
  assert.match(sections, /<details class="act-sections" open>/);
  assert.match(sections, /<a href="#\/acts\/2026-regular\/pa-83\?section=1">Sec\. 1<\/a> <small>Effective October 1, 2026<\/small>/);
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
  for (const record of [...manifest.artifacts, ...manifest.sessions, ...manifest.sessions.map((entry) => entry.search).filter(Boolean)]) {
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
