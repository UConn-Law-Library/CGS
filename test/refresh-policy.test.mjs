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
  maxChangedProvisionsPercent: 15,
  maxStatusTransitionsPercent: 2,
  maxShrunkBodies: 25,
  maxEmptyActiveIncrease: 0,
  maxIdentifierWarningIncrease: 5
};

function report(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    before: { counts: { titles: 81, chapters: 1141, provisionsRead: 33013 }, quality: { emptyActive: 0, identifierWarnings: 3 } },
    after: { counts: { titles: 81, chapters: 1141, provisionsRead: 33013 }, quality: { emptyActive: 0, identifierWarnings: 3 } },
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
      shrunkBodies: 0,
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

test("rejects text that empties or shrinks without a change in status", () => {
  const value = report({ changed: 30, shrunkBodies: 30 });
  value.after.quality.emptyActive = 2;
  const evaluation = evaluateCorpusRefresh(value, policy);
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.checks.find((item) => item.name === "Bodies shrunk by more than half").passed, false);
  assert.equal(evaluation.checks.find((item) => item.name === "New in-force provisions with no text").passed, false);
});

test("limits status transitions and new identifier warnings", () => {
  const value = report({ changed: 800, statusTransitions: 800 });
  value.after.quality.identifierWarnings = 20;
  const evaluation = evaluateCorpusRefresh(value, policy);
  assert.equal(evaluation.checks.find((item) => item.name === "Status transitions").passed, false);
  assert.equal(evaluation.checks.find((item) => item.name === "New identifier warnings").passed, false);
});

test("removing parser artifacts still needs a reviewed policy change", () => {
  // A crawler fix that drops thousands of phantom entries lowers the empty-text count but
  // exceeds the removal limit; the gate has no workflow override.
  const value = report({ removed: 2446 });
  value.after.counts.provisionsRead -= 2446;
  value.before.quality.emptyActive = 387;
  const evaluation = evaluateCorpusRefresh(value, policy);
  assert.equal(evaluation.checks.find((item) => item.name === "New in-force provisions with no text").passed, true);
  assert.equal(evaluation.checks.find((item) => item.name === "Removed provisions").passed, false);
  assert.equal(evaluation.passed, false);
  assert.match(renderRefreshSummary(value, evaluation), /\| In-force provisions with no text \| 387 → 0 \|/);
});
