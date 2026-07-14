import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOmniRows,
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
