import assert from "node:assert/strict";
import test from "node:test";
import { SecondarySourceRepository } from "../src/secondary-sources.js";

function response(value) {
  return { ok: value !== undefined, status: value === undefined ? 404 : 200, json: () => Promise.resolve(value) };
}

test("loads sharded infractions, index letters, and reverse section links", async () => {
  const base = "https://example.test/data/secondary/";
  const values = new Map([
    [`${base}manifest.json`, { schemaVersion: "1.0.0" }],
    [`${base}infractions/manifest.json`, { schemaVersion: "1.0.0", shards: [{ key: "title-14", path: "title-14.json" }] }],
    [`${base}statutes-index/manifest.json`, { shards: [{ key: "m", path: "m-01.json" }, { key: "m", path: "m-02.json" }] }],
    [`${base}links/manifest.json`, { shards: [{ titleId: "title-14", path: "title-14.json" }] }],
    [`${base}infractions/title-14.json`, { entries: [{ id: "infraction-1" }] }],
    [`${base}infractions/fee-rules.json`, { rules: [{ id: "fee-rule-1" }] }],
    [`${base}statutes-index/m-01.json`, { headings: [{ id: "topic-1" }] }],
    [`${base}statutes-index/m-02.json`, { headings: [{ id: "topic-2" }] }],
    [`${base}links/title-14.json`, { sections: { "14-1": { infractions: [{ id: "infraction-1" }], feeRules: [{ id: "fee-rule-1", role: "affected" }], indexEntries: [] } } }]
  ]);
  const repository = new SecondarySourceRepository({
    baseUrl: base,
    fetchImpl(url) { return Promise.resolve(response(values.get(url.href))); }
  });
  assert.equal((await repository.loadInfractions("title-14")).entries[0].id, "infraction-1");
  assert.equal((await repository.loadFeeRules()).rules[0].id, "fee-rule-1");
  assert.deepEqual((await repository.loadIndexLetter("M")).map((heading) => heading.id), ["topic-1", "topic-2"]);
  assert.equal((await repository.loadSectionLinks("title-14", "14-1")).infractions[0].id, "infraction-1");
  assert.equal((await repository.loadSectionLinks("title-14", "14-1")).feeRules[0].role, "affected");
  assert.deepEqual((await repository.loadSectionLinks("title-99", "99-1")).infractions, []);
  assert.deepEqual((await repository.loadSectionLinks("title-99", "99-1")).feeRules, []);
});

test("returns an empty infraction shard for a title without entries", async () => {
  const base = "https://example.test/data/secondary/";
  const values = new Map([
    [`${base}manifest.json`, { schemaVersion: "1.0.0" }],
    [`${base}infractions/manifest.json`, { schemaVersion: "1.0.0", shards: [] }],
    [`${base}statutes-index/manifest.json`, { shards: [] }],
    [`${base}links/manifest.json`, { shards: [] }]
  ]);
  const repository = new SecondarySourceRepository({
    baseUrl: base,
    fetchImpl(url) { return Promise.resolve(response(values.get(url.href))); }
  });
  assert.deepEqual((await repository.loadInfractions("title-1")).entries, []);
});
