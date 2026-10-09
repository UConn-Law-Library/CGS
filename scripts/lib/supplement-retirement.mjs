import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// A supplement is read with the revision published the year before it. Once the base corpus is
// a revision of the supplement's year or later, that revision already contains everything the
// supplement changed, and overlaying the older supplement text would undo later amendments.
export function baseRevisionYear(catalog) {
  const year = catalog?.source?.revisionYear;
  return Number.isInteger(year) ? year : null;
}

export function supersededSupplementError(editionYear, catalog) {
  const base = baseRevisionYear(catalog);
  if (base === null) return "the base corpus does not record its revision year (catalog.json source.revisionYear)";
  if (editionYear <= base) {
    return `the ${editionYear} Supplement is superseded by the base corpus, revised to January 1, ${base}; retire supplements/${editionYear}`;
  }
  return null;
}

async function supplementYears(supplementsDir) {
  const root = path.resolve(supplementsDir);
  if (!(await stat(root).catch(() => null))?.isDirectory()) return [];
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => left - right);
}

// Which published supplements a corpus refresh rebinds to the candidate base, and which the
// candidate supersedes. Only an edition the base revision covers is retired; every newer one is
// rebound, so a failure to rebind it stops the refresh rather than dropping it.
export async function planSupplementRebind({ supplementsDir, baseDataDir }) {
  const catalog = JSON.parse(await readFile(path.join(path.resolve(baseDataDir), "catalog.json"), "utf8"));
  const base = baseRevisionYear(catalog);
  if (base === null) throw new Error(supersededSupplementError(null, catalog));
  const years = await supplementYears(supplementsDir);
  return {
    baseRevisionYear: base,
    rebind: years.filter((year) => year > base),
    retire: years.filter((year) => year <= base)
  };
}

export function renderRetirementSummary(plan) {
  if (!plan.retire.length) return null;
  const editions = plan.retire.map((year) => `${year} Supplement`).join(", ");
  return [
    "## Retired supplements",
    "",
    `The candidate corpus is the General Statutes revised to January 1, ${plan.baseRevisionYear}, which already contains the changes in the ${editions}. This pull request removes ${plan.retire.map((year) => `\`public/data/supplements/${year}\``).join(", ")} instead of overlaying the older text on the new revision.`,
    "",
    `Also retire the Public Acts sessions this revision now codifies (\`python -m crawler.cgs_crawler.acts --retire <session-id>\`) and add ${plan.baseRevisionYear} to \`PUBLISHED_EDITIONS\` in \`src/publications.js\` after confirming the edition on cga.ct.gov. See docs/corpus-refresh.md.`,
    ""
  ].join("\n");
}
