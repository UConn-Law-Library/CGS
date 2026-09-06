import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

function categoryFor(subject) {
  if (/^(?:fix|repair|resolve|correct)\b/i.test(subject)) return "Bug fix";
  if (/^(?:add|build|enhance|improve|refine|strengthen|link|feat)\b/i.test(subject)) return "Enhancement";
  if (/^(?:chore|docs|test|ci|refactor|update|refresh)\b/i.test(subject)) return "Maintenance";
  return "Update";
}

export function buildRecentUpdates(log, summaries = {}, limit = 8) {
  const updates = [];
  for (const line of log.trim().split("\n")) {
    const [commit, date, ...subjectParts] = line.split("\t");
    const subject = subjectParts.join("\t").trim();
    if (!/^[a-f0-9]{40}$/.test(commit) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !subject) continue;
    const summary = summaries[commit];
    if (summary?.hidden) continue;
    updates.push({
      commit,
      date,
      category: summary?.category ?? categoryFor(subject),
      title: summary?.title ?? subject,
      summary: summary?.summary ?? ""
    });
    if (updates.length >= limit) break;
  }
  return updates;
}

export async function readRecentUpdates(root) {
  const summaries = JSON.parse(await readFile(path.join(root, "config", "site-updates.json"), "utf8"));
  // Read only commits included in this checkout. No network request or GitHub
  // credentials are needed, and unreleased commits on other branches stay out.
  const log = execFileSync("git", ["log", "HEAD", "--date-order", "--no-merges", "-n", "40", "--format=%H%x09%cs%x09%s"], {
    cwd: root, encoding: "utf8", windowsHide: true
  });
  return buildRecentUpdates(log, summaries);
}
