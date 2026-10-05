import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ActsRepository, actsCurrencyNote, filterActs, normalizeActsOptions, renderActsTable } from "../src/acts.js";
import { actsRouteHref, parseRoute } from "../src/routes.js";
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
