const CHANGE_KEYS = [
  "titlesAdded",
  "titlesRemoved",
  "titlesChanged",
  "chaptersAdded",
  "chaptersRemoved",
  "chaptersChanged",
  "added",
  "removed",
  "changed"
];

function requiredNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number`);
  return number;
}

function percent(value, total) {
  if (total === 0) return value === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (value / total) * 100;
}

function check(name, actual, limit, unit) {
  return { name, actual, limit, unit, passed: actual <= limit };
}

export function evaluateCorpusRefresh(report, policy) {
  if (policy?.schemaVersion !== "1.0.0") throw new Error("Unsupported corpus refresh policy schemaVersion");
  if (report?.schemaVersion !== "1.0.0") throw new Error("Unsupported corpus diff schemaVersion");

  const beforeTitles = requiredNumber(report.before?.counts?.titles, "before title count");
  const afterTitles = requiredNumber(report.after?.counts?.titles, "after title count");
  const beforeChapters = requiredNumber(report.before?.counts?.chapters, "before chapter count");
  const afterChapters = requiredNumber(report.after?.counts?.chapters, "after chapter count");
  const beforeProvisions = requiredNumber(report.before?.counts?.provisionsRead, "before provision count");
  const afterProvisions = requiredNumber(report.after?.counts?.provisionsRead, "after provision count");
  const summary = Object.fromEntries(
    [...CHANGE_KEYS, "statusTransitions"].map((key) => [key, requiredNumber(report.summary?.[key], `summary.${key}`)])
  );

  const limits = {
    maxTitleCountDelta: requiredNumber(policy.maxTitleCountDelta, "policy.maxTitleCountDelta"),
    maxTitleMembershipChanges: requiredNumber(policy.maxTitleMembershipChanges, "policy.maxTitleMembershipChanges"),
    maxTitleMetadataChanges: requiredNumber(policy.maxTitleMetadataChanges, "policy.maxTitleMetadataChanges"),
    maxChapterCountDeltaPercent: requiredNumber(policy.maxChapterCountDeltaPercent, "policy.maxChapterCountDeltaPercent"),
    maxChapterMembershipChangesPercent: requiredNumber(policy.maxChapterMembershipChangesPercent, "policy.maxChapterMembershipChangesPercent"),
    maxChapterMetadataChangesPercent: requiredNumber(policy.maxChapterMetadataChangesPercent, "policy.maxChapterMetadataChangesPercent"),
    maxProvisionCountDeltaPercent: requiredNumber(policy.maxProvisionCountDeltaPercent, "policy.maxProvisionCountDeltaPercent"),
    maxAddedProvisionsPercent: requiredNumber(policy.maxAddedProvisionsPercent, "policy.maxAddedProvisionsPercent"),
    maxRemovedProvisionsPercent: requiredNumber(policy.maxRemovedProvisionsPercent, "policy.maxRemovedProvisionsPercent"),
    maxChangedProvisionsPercent: requiredNumber(policy.maxChangedProvisionsPercent, "policy.maxChangedProvisionsPercent")
  };

  const checks = [
    check("Title count delta", Math.abs(afterTitles - beforeTitles), limits.maxTitleCountDelta, "count"),
    check("Title additions and removals", summary.titlesAdded + summary.titlesRemoved, limits.maxTitleMembershipChanges, "count"),
    check("Title metadata changes", summary.titlesChanged, limits.maxTitleMetadataChanges, "count"),
    check("Chapter count delta", percent(Math.abs(afterChapters - beforeChapters), beforeChapters), limits.maxChapterCountDeltaPercent, "percent"),
    check("Chapter additions and removals", percent(summary.chaptersAdded + summary.chaptersRemoved, beforeChapters), limits.maxChapterMembershipChangesPercent, "percent"),
    check("Chapter metadata changes", percent(summary.chaptersChanged, beforeChapters), limits.maxChapterMetadataChangesPercent, "percent"),
    check("Provision count delta", percent(Math.abs(afterProvisions - beforeProvisions), beforeProvisions), limits.maxProvisionCountDeltaPercent, "percent"),
    check("Added provisions", percent(summary.added, beforeProvisions), limits.maxAddedProvisionsPercent, "percent"),
    check("Removed provisions", percent(summary.removed, beforeProvisions), limits.maxRemovedProvisionsPercent, "percent"),
    check("Changed provisions", percent(summary.changed, beforeProvisions), limits.maxChangedProvisionsPercent, "percent")
  ];

  return {
    passed: checks.every((item) => item.passed),
    hasChanges: CHANGE_KEYS.some((key) => summary[key] > 0),
    checks
  };
}

function formatValue(value, unit) {
  return unit === "percent" ? `${value.toFixed(2)}%` : value.toLocaleString("en-US");
}

export function renderRefreshSummary(report, evaluation) {
  const status = evaluation.passed ? "PASS" : "FAIL";
  const changeState = evaluation.hasChanges ? "Meaningful corpus changes detected" : "No meaningful corpus changes detected";
  const lines = [
    "# CGS refresh review",
    "",
    `Safety result: **${status}**`,
    "",
    `${changeState}.`,
    "",
    "| Corpus | Before | After |",
    "| --- | ---: | ---: |",
    `| Titles | ${report.before.counts.titles.toLocaleString("en-US")} | ${report.after.counts.titles.toLocaleString("en-US")} |`,
    `| Chapters | ${report.before.counts.chapters.toLocaleString("en-US")} | ${report.after.counts.chapters.toLocaleString("en-US")} |`,
    `| Provisions | ${report.before.counts.provisionsRead.toLocaleString("en-US")} | ${report.after.counts.provisionsRead.toLocaleString("en-US")} |`,
    "",
    "| Change | Count |",
    "| --- | ---: |",
    `| Titles added / removed / changed | ${report.summary.titlesAdded} / ${report.summary.titlesRemoved} / ${report.summary.titlesChanged} |`,
    `| Chapters added / removed / changed | ${report.summary.chaptersAdded} / ${report.summary.chaptersRemoved} / ${report.summary.chaptersChanged} |`,
    `| Provisions added / removed / changed | ${report.summary.added} / ${report.summary.removed} / ${report.summary.changed} |`,
    `| Status transitions | ${report.summary.statusTransitions} |`,
    "",
    "| Safety check | Actual | Limit | Result |",
    "| --- | ---: | ---: | :---: |",
    ...evaluation.checks.map((item) => `| ${item.name} | ${formatValue(item.actual, item.unit)} | ${formatValue(item.limit, item.unit)} | ${item.passed ? "PASS" : "FAIL"} |`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}
