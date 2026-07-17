import assert from "node:assert/strict";
import test from "node:test";
import { aggregateShardCounts, contextualColumnCount } from "../src/context-navigation.js";

test("aggregates manifest-derived heading counts across letter shards", () => {
  const counts = aggregateShardCounts([
    { key: "a", headingCount: 40 },
    { key: "a", headingCount: 35 },
    { key: "b", headingCount: 12 }
  ]);
  assert.equal(counts.get("a"), 75);
  assert.equal(counts.get("b"), 12);
});

test("selects the correct number of contextual columns for each route depth", () => {
  assert.equal(contextualColumnCount("statutes", { kind: "home" }), 1);
  assert.equal(contextualColumnCount("statutes", { kind: "title" }), 1);
  assert.equal(contextualColumnCount("statutes", { kind: "chapter" }), 3);
  assert.equal(contextualColumnCount("statutes", { kind: "section" }), 3);
  assert.equal(contextualColumnCount("index", { letter: null }), 1);
  assert.equal(contextualColumnCount("index", { letter: "u" }), 2);
  assert.equal(contextualColumnCount("infractions", { category: null }), 1);
  assert.equal(contextualColumnCount("infractions", { category: "MOTOR VEHICLES" }), 2);
});
