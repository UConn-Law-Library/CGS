import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, renderSecondaryContext, searchIndexTopics, topicLetter } from "../src/secondary-ui.js";

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
  assert.match(html, /Related legal data/);
  assert.match(html, /\$117\.00/);
  assert.match(html, /Affected statute/);
  assert.match(html, /#\/index\/m\/topic\/topic-1/);
  assert.match(html, /Unsafe &lt;text&gt;/);
});
