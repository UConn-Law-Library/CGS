function number(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be a non-negative number`);
  return result;
}

function percent(value, total) {
  return total === 0 ? (value === 0 ? 0 : Number.POSITIVE_INFINITY) : value / total * 100;
}

function minimum(name, actual, limit, unit = "count") {
  return { name, actual, limit, unit, comparison: "minimum", passed: actual >= limit };
}

function maximum(name, actual, limit) {
  return { name, actual, limit, unit: "percent", comparison: "maximum", passed: actual <= limit };
}

export function evaluateSecondaryRefresh(report, policy) {
  if (report?.schemaVersion !== "1.0.0" || policy?.schemaVersion !== "1.0.0") throw new Error("Unsupported secondary refresh schemaVersion");
  const after = report.after?.counts ?? {};
  const changes = report.changes ?? {};
  const minimumCounts = policy.minimumCounts ?? {};
  const maximumRemoval = policy.maximumRemovalPercent ?? {};
  const minimumResolution = policy.minimumResolutionPercent ?? {};
  const checks = [
    minimum("Infraction count", number(after.infractions, "after.infractions"), number(minimumCounts.infractions, "policy minimum infractions")),
    minimum("Fee-rule count", number(after.feeRules, "after.feeRules"), number(minimumCounts.feeRules, "policy minimum fee rules")),
    minimum("Index heading count", number(after.indexHeadings, "after.indexHeadings"), number(minimumCounts.indexHeadings, "policy minimum index headings")),
    minimum("Index entry count", number(after.indexItems, "after.indexItems"), number(minimumCounts.indexItems, "policy minimum index entries")),
    maximum("Infraction removals", percent(number(changes.infractions?.removed, "removed infractions"), number(report.before?.counts?.infractions, "before infractions")), number(maximumRemoval.infractions, "policy infraction removals")),
    maximum("Fee-rule removals", percent(number(changes.feeRules?.removed, "removed fee rules"), number(report.before?.counts?.feeRules, "before fee rules")), number(maximumRemoval.feeRules, "policy fee-rule removals")),
    maximum("Index heading removals", percent(number(changes.indexHeadings?.removed, "removed index headings"), number(report.before?.counts?.indexHeadings, "before index headings")), number(maximumRemoval.indexHeadings, "policy index heading removals")),
    maximum("Index entry removals", percent(number(changes.indexEntries?.removed, "removed index entries"), number(report.before?.counts?.indexItems, "before index entries")), number(maximumRemoval.indexEntries, "policy index entry removals")),
    minimum("Infraction resolution", percent(number(after.infractionsResolved, "resolved infractions"), number(after.infractions, "after infractions")), number(minimumResolution.infractions, "policy infraction resolution"), "percent"),
    minimum("Fee-reference resolution", percent(number(after.feeRuleResolved, "resolved fee references"), number(after.feeRuleReferences, "fee references")), number(minimumResolution.feeRuleReferences, "policy fee-reference resolution"), "percent"),
    minimum("Index-reference resolution", percent(number(after.indexResolved, "resolved index references"), number(after.indexReferences, "index references")), number(minimumResolution.indexReferences, "policy index-reference resolution"), "percent")
  ];
  const hasChanges = Object.values(changes).some((change) => change.added || change.removed || change.changed);
  return { passed: checks.every((check) => check.passed), hasChanges, checks };
}

function display(value, unit) {
  return unit === "percent" ? `${value.toFixed(2)}%` : value.toLocaleString("en-US");
}

export function renderSecondaryReview(report, evaluation) {
  const lines = [
    "# CGS secondary-source refresh review", "",
    `Safety result: **${evaluation.passed ? "PASS" : "FAIL"}**`, "",
    evaluation.hasChanges ? "Secondary-source changes detected." : "No secondary-source changes detected.", "",
    "| Safety check | Actual | Required | Result |", "| --- | ---: | ---: | :---: |",
    ...evaluation.checks.map((check) => `| ${check.name} | ${display(check.actual, check.unit)} | ${check.comparison === "minimum" ? "≥" : "≤"} ${display(check.limit, check.unit)} | ${check.passed ? "PASS" : "FAIL"} |`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}
