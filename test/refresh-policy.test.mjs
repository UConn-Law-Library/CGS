import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCorpusRefresh, renderRefreshSummary } from "../scripts/lib/refresh-policy.mjs";

const policy = {
  schemaVersion: "1.0.0",
  maxTitleCountDelta: 0,
  maxTitleMembershipChanges: 0,
  maxTitleMetadataChanges: 10,
  maxChapterCountDeltaPercent: 5,
  maxChapterMembershipChangesPercent: 5,
  maxChapterMetadataChangesPercent: 10,
  maxProvisionCountDeltaPercent: 5,
  maxAddedProvisionsPercent: 5,
  maxRemovedProvisionsPercent: 2,
  maxChangedProvisionsPercent: 35
};

function report(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    before: { counts: { titles: 81, chapters: 1141, provisionsRead: 33013 } },
    after: { counts: { titles: 81, chapters: 1141, provisionsRead: 33013 } },
    summary: {
      titlesAdded: 0,
      titlesRemoved: 0,
      titlesChanged: 0,
      chaptersAdded: 0,
      chaptersRemoved: 0,
      chaptersChanged: 0,
      added: 0,
      removed: 0,
      changed: 0,
      statusTransitions: 0,
      ...overrides
    }
  };
}

test("accepts an unchanged corpus", () => {
  const value = report();
  const evaluation = evaluateCorpusRefresh(value, policy);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.hasChanges, false);
  assert.match(renderRefreshSummary(value, evaluation), /No meaningful corpus changes detected/);
});

test("accepts bounded changes and identifies structural-only changes", () => {
  const value = report({ titlesChanged: 1, chaptersChanged: 2 });
  const evaluation = evaluateCorpusRefresh(value, policy);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.hasChanges, true);
});

test("rejects a suspicious provision removal", () => {
  const value = report({ removed: 1000 });
  value.after.counts.provisionsRead -= 1000;
  const evaluation = evaluateCorpusRefresh(value, policy);
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.hasChanges, true);
  assert.equal(evaluation.checks.find((item) => item.name === "Removed provisions").passed, false);
  assert.match(renderRefreshSummary(value, evaluation), /Safety result: \*\*FAIL\*\*/);
});
