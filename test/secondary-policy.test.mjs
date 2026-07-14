import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSecondaryRefresh } from "../scripts/lib/secondary-policy.mjs";

const policy = {
  schemaVersion: "1.0.0",
  minimumCounts: { infractions: 1300, feeRules: 8, indexHeadings: 4000, indexItems: 150000 },
  maximumRemovalPercent: { infractions: 5, feeRules: 0, indexHeadings: 5, indexEntries: 5 },
  minimumResolutionPercent: { infractions: 90, feeRuleReferences: 85, indexReferences: 95 }
};

function report() {
  const counts = { infractions: 1737, feeRules: 10, feeRuleReferences: 230, feeRuleResolved: 225, indexHeadings: 5652, indexItems: 193922, indexReferences: 166777, indexResolved: 164529, infractionsResolved: 1725 };
  const unchanged = { added: 0, removed: 0, changed: 0 };
  return {
    schemaVersion: "1.0.0", before: { counts: { ...counts } }, after: { counts: { ...counts } },
    changes: { infractions: { ...unchanged }, feeRules: { ...unchanged }, indexHeadings: { ...unchanged }, indexEntries: { ...unchanged } }
  };
}

test("accepts a complete unchanged secondary corpus", () => {
  const evaluation = evaluateSecondaryRefresh(report(), policy);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.hasChanges, false);
});

test("rejects fee-rule removals", () => {
  const value = report();
  value.changes.feeRules.removed = 1;
  value.after.counts.feeRules = 9;
  assert.equal(evaluateSecondaryRefresh(value, policy).passed, false);
});

test("rejects a resolution-rate collapse", () => {
  const value = report();
  value.after.counts.indexResolved = 1000;
  assert.equal(evaluateSecondaryRefresh(value, policy).passed, false);
});
