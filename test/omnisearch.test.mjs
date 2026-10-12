import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOmniRows,
  findActMatches,
  findIndexMatches,
  findInfractionMatches,
  findNavigationMatches,
  indexLetterForQuery,
  statuteMatches
} from "../src/omnisearch.js";

const catalog = {
  titles: [{
    id: "title-14",
    number: "14",
    name: "Motor Vehicles",
    chapters: [{ id: "chapter-246", number: "246", name: "Motor Vehicles", sectionCount: 10 }]
  }]
};

test("finds immediate title and chapter navigation matches", () => {
  const matches = findNavigationMatches(catalog, "motor vehicles");
  assert.equal(matches.titles[0].href, "#/t/14");
  assert.equal(matches.chapters[0].href, "#/t/14/c/246");
  assert.equal(matches.chapters[0].kind, "Chapter");
});

test("maps progressive statute results to canonical reader routes", () => {
  const [match] = statuteMatches([{
    score: 10,
    document: {
      id: "section-14-36",
      citation: "14-36",
      citations: ["14-36"],
      heading: "Sec. 14-36. Motor vehicle operator's license.",
      title: { number: "14" },
      chapter: { number: "246" }
    }
  }]);
  assert.equal(match.href, "#/t/14/c/246/s/14-36");
  assert.match(match.subtitle, /Title 14, Chapter 246/);
});

test("finds linked index and infraction quick results", () => {
  const topics = [{
    id: "topic-motor-vehicles",
    label: "MOTOR VEHICLES",
    position: 1,
    items: [{ id: "entry-license", text: "Operator licenses", references: [{ display: "14-36" }], see: [] }]
  }];
  const [index] = findIndexMatches(topics, "operator license");
  assert.equal(index.href, "#/index/m/topic/topic-motor-vehicles");

  const [infraction] = findInfractionMatches([{
    id: "infraction-14-36",
    citation: "14-36",
    description: "Operating without a license",
    category: "Motor vehicle violations"
  }], "without license");
  assert.equal(infraction.href, "#/infractions/Motor%20vehicle%20violations/entry/infraction-14-36");
});

test("uses the first alphabetic query character for the bounded index shard", () => {
  assert.equal(indexLetterForQuery("14-36 motor vehicle"), "m");
  assert.equal(indexLetterForQuery("14-36"), null);
});

test("keeps quick-result groups in the legacy priority order", () => {
  const row = (kind) => ({ kind, label: kind, subtitle: "", href: `#/${kind}` });
  assert.deepEqual(
    buildOmniRows({
      statutes: [row("Section")],
      titles: [row("Title")],
      chapters: [row("Chapter")],
      index: [row("Index")],
      infractions: [row("Infraction")]
    }).map(({ kind }) => kind),
    ["Section", "Title", "Chapter", "Index", "Infraction"]
  );
});

const actSessions = [{
  entry: { id: "2026-regular" },
  acts: [
    { id: "pa-2026-regular-2", type: "public", number: 2, citation: "P.A. 26-2", bill: "SB 299", title: "AN ACT CONCERNING REDEMPTION OF OUT-OF-STATE BEVERAGE CONTAINERS.", text: { path: "2026-regular/text/pa-2.json" } },
    { id: "pa-2026-regular-20", type: "public", number: 20, citation: "P.A. 26-20", bill: "HB 5001", title: "AN ACT CONCERNING THE DEPARTMENT OF TRANSPORTATION.", text: { path: "2026-regular/text/pa-20.json" } },
    { id: "sa-2026-regular-2", type: "special", number: 2, citation: "S.A. 26-2", bill: "HB 5100", title: "AN ACT CONCERNING A STUDY OF BEVERAGE CONTAINERS.", url: "https://example.test/sa-2.pdf" }
  ],
  index: { acts: ["pa-2026-regular-2", "pa-2026-regular-20"], terms: { vending: [0], "22a-245": [0, 1] } }
}];

test("finds Public and Special Acts by citation, bill, title, and text", () => {
  const [byCitation] = findActMatches(actSessions, "PA 26-2");
  assert.equal(byCitation.kind, "Public Act");
  assert.equal(byCitation.label, "P.A. 26-2");
  assert.equal(byCitation.href, "#/acts/2026-regular/pa-2");
  assert.equal(byCitation.exact, true);
  assert.match(byCitation.subtitle, /^An act concerning redemption .* · SB 299$/);

  assert.deepEqual(findActMatches(actSessions, "sb 299").map(({ label }) => label), ["P.A. 26-2"]);
  assert.deepEqual(findActMatches(actSessions, "26-2").map(({ label }) => label), ["P.A. 26-2", "S.A. 26-2", "P.A. 26-20"]);
  assert.equal(findActMatches(actSessions, "26-2")[0].exact, false);

  const titles = findActMatches(actSessions, "beverage containers");
  assert.deepEqual(titles.map(({ kind }) => kind), ["Public Act", "Special Act"]);
  // A Special Act without text opens the list filtered to it, with its PDF link.
  assert.equal(titles[1].href, "#/acts?session=2026-regular&q=S.A.%2026-2");

  const [text] = findActMatches(actSessions, "vending");
  assert.equal(text.href, "#/acts/2026-regular/pa-2?q=vending");
  assert.match(text.subtitle, /Found in the act's text$/);
  assert.equal(findActMatches(actSessions, "22a-245").length, 2);
  assert.deepEqual(findActMatches(actSessions, "nothing here"), []);
});

test("puts acts first only when the query names an act or bill", () => {
  const row = (kind, exact = false) => ({ kind, label: kind, subtitle: "", href: `#/${kind}`, exact });
  const groups = { statutes: [row("Section")], titles: [row("Title")], index: [row("Index")] };
  assert.deepEqual(buildOmniRows({ ...groups, acts: [row("Public Act")] }).map(({ kind }) => kind), ["Section", "Title", "Public Act", "Index"]);
  assert.deepEqual(buildOmniRows({ ...groups, acts: [row("Public Act", true)] }).map(({ kind }) => kind), ["Public Act", "Section", "Title", "Index"]);
});
