import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMoney,
  findIndexSubheadingEntry,
  groupIndexEntries,
  renderIndexEntry,
  renderSecondaryContext,
  searchIndexEntries,
  searchIndexTopics,
  topicLetter
} from "../src/secondary-ui.js";

test("formats schedule money and derives index letters", () => {
  assert.equal(formatMoney(11700), "$117.00");
  assert.equal(topicLetter(" Motor vehicles"), "m");
});

test("searches heading and entry text without loading another letter", () => {
  const topics = [{
    id: "topic-1", label: "MOTOR VEHICLES", position: 1,
    items: [
      { id: "entry-1", text: "Operator licenses", references: [{ display: "14-36" }], see: [] },
      { id: "entry-2", text: "Registration", references: [], see: [] }
    ]
  }];
  const heading = searchIndexTopics(topics, "motor vehicles");
  assert.equal(heading.total, 1);
  assert.equal(heading.results[0].entry, null);
  const entry = searchIndexTopics(topics, "14-36");
  assert.equal(entry.results[0].entry.id, "entry-1");
});

test("renders indented index entries with direct links for structured SEE targets", () => {
  const html = renderIndexEntry({
    id: "entry-see",
    level: 2,
    text: "Children—See CHILDREN AND MINORS, at Abandonment.",
    references: [],
    see: [{ heading: "CHILDREN AND MINORS", subheading: "Abandonment" }]
  });
  assert.match(html, /id="entry-see"/);
  assert.match(html, /index-level-2/);
  assert.match(html, /class="index-see-link"/);
  assert.match(html, /#\/index\/c\?heading=CHILDREN%20AND%20MINORS&amp;subheading=Abandonment/);
  assert.equal((html.match(/CHILDREN AND MINORS/g) ?? []).length, 1);
});

test("links the exact SEE heading instead of an earlier mixed-case phrase", () => {
  const html = renderIndexEntry({
    id: "entry-abandoned",
    level: 0,
    text: "Motor vehicles\u2014See MOTOR VEHICLES, at Abandoned.",
    references: [],
    see: [{ heading: "MOTOR VEHICLES", subheading: "Abandoned" }]
  });
  assert.match(html, /Motor vehicles\u2014See <a class="index-see-link"[^>]*>MOTOR VEHICLES<\/a>/);
  assert.doesNotMatch(html, /<a class="index-see-link"[^>]*>Motor vehicles<\/a>/);
});

test("links same-heading SEE labels to the destination subgroup", () => {
  const entries = [
    {
      id: "entry-source",
      level: 0,
      text: "Accessions\u2014See Secured transactions, this heading.",
      references: [],
      see: [{
        heading: "UNIFORM COMMERCIAL CODE",
        subheading: "Secured transactions",
        label: "Secured transactions"
      }]
    },
    { id: "entry-nested", level: 1, text: "Secured transactions", references: [], see: [] },
    { id: "entry-target", level: 0, text: "Secured transactions, 42a-9-101 to", references: [], see: [] }
  ];
  const html = renderIndexEntry(entries[0]);
  assert.match(html, /See <a class="index-see-link"[^>]*>Secured transactions<\/a>, this heading/);
  assert.match(html, /#\/index\/u\?heading=UNIFORM%20COMMERCIAL%20CODE&amp;subheading=Secured%20transactions/);
  assert.equal(findIndexSubheadingEntry(entries, "Secured transactions").id, "entry-target");
});

test("groups large index topics by top-level entry and searches their descendants", () => {
  const entries = [
    { id: "acceleration", level: 0, text: "Acceleration", references: [], see: [] },
    { id: "under-protest", level: 1, text: "Under protest", references: [{ display: "42a-1-308(a)" }], see: [] },
    { id: "bank", level: 0, text: "Bank", references: [], see: [] }
  ];
  assert.deepEqual(groupIndexEntries(entries).map((group) => group.map((entry) => entry.id)), [
    ["acceleration", "under-protest"],
    ["bank"]
  ]);
  const search = searchIndexEntries(entries, "42a-1-308");
  assert.equal(search.total, 1);
  assert.equal(search.results[0].id, "under-protest");
});

test("renders linked infractions, fee roles, sources, and index records safely", () => {
  const html = renderSecondaryContext({
    manifests: {
      infractions: { source: { effective: "October 1, 2025", chartBRevision: "10-2025", url: "https://example.test/infractions.pdf" } },
      index: { source: { revision: "Revised 2025", url: "https://example.test/index" } }
    },
    infractions: [{ citation: "14-1", description: "Unsafe <text>", subsequent: false, amounts: { total_due: 11700 } }],
    feeRules: [{ roles: ["affected"], rule: { authorityCitation: "51-56a(c)", authorityResolution: { href: "#/t/51/c/873/s/51-56a" }, description: "Fee", affectedText: "14-1", comments: "", } }],
    indexEntries: [{ topic: { id: "topic-1", label: "MOTOR VEHICLES" }, entry: { text: "Licenses", references: [] } }]
  });
  assert.doesNotMatch(html, /Related legal data|Official cross-references/);
  assert.match(html, /Infractions schedule/);
  assert.match(html, /\$117\.00/);
  assert.match(html, /Affected statute/);
  assert.match(html, /#\/index\/m\/topic\/topic-1/);
  assert.match(html, /Unsafe &lt;text&gt;/);
});

test("omits empty related-record groups without rendering a placeholder", () => {
  const html = renderSecondaryContext({
    manifests: {
      infractions: { source: {} },
      index: { source: {} }
    },
    infractions: [],
    feeRules: [],
    indexEntries: []
  });
  assert.equal(html, "");
});
