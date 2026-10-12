// Which General Statutes sections each listed Public Act amends or repeals, read from the
// opening clause of each act section, for example "Section 22a-245 of the 2026 supplement to
// the general statutes is repealed and the following is substituted in lieu thereof". The build
// derives one index from every act text (buildAmendmentIndex); the reader looks up the section
// it shows (amendmentsForSection). Only a clause that names a section "of the general
// statutes" counts: new sections, uncodified provisions, and changes to other acts do not.

import { statuteTextEdition } from "./publications.js";

// Title 42a (the UCC) numbers sections by article: 42a-9-204, 42a-12A-301.
const CITATION = String.raw`\d+[a-z]*-(?:\d+[a-z]*-)?\d+[a-z]*`;
// "section 1-1", "sections 1-1 and 1-2", "sections 1-1 to 1-5, inclusive," ending at "of the
// [2026 supplement to the] general statutes".
const TARGET = new RegExp(String.raw`\bsections?\s+((?:${CITATION})(?:(?:,\s*|\s+and\s+|,\s*and\s+|\s+to\s+|,?\s+inclusive,?\s*)+(?:${CITATION}))*)(?:,?\s+inclusive)?,?\s+of\s+the\s+(?:\d{4}\s+supplement\s+to\s+the\s+)?general\s+statutes\b`, "gi");
const VERB = /\s(?:is|are)\s+(?:hereby\s+)?(repealed and the following is substituted in lieu thereof|repealed|amended by adding)\b/i;

function runsText(runs = []) {
  return runs.map((run) => typeof run === "string" ? run : run.ins).join("");
}

function parseTargets(list) {
  const targets = [];
  const citation = new RegExp(String.raw`(${CITATION})(?:\s+to\s+(${CITATION}))?`, "gi");
  for (const [, from, to] of list.matchAll(citation)) {
    targets.push(to ? { from: from.toLowerCase(), to: to.toLowerCase() } : { citation: from.toLowerCase() });
  }
  return targets;
}

function tidy(value) {
  return value.replace(/,?\s+inclusive,?/gi, "").replace(/\s+/g, " ").trim().replace(/^./, (letter) => letter.toLowerCase());
}

// The opening clause of one act section, or null when it changes no statute section.
export function parseAmendmentClause(text) {
  const clause = String(text ?? "").replace(/^\s*(?:Section|Sec\.)\s+\d+\.\s*/, "");
  // Uncodified sections begin with their effective date; new sections with "(NEW)".
  if (/^\((?:NEW|Effective)\b/i.test(clause)) return null;
  const verb = VERB.exec(clause);
  if (!verb) return null;
  const subject = clause.slice(0, verb.index);
  const targets = [...subject.matchAll(TARGET)].flatMap((match) => parseTargets(match[1]));
  if (!targets.length) return null;
  const partial = subject.match(/^((?:sub\w+|paragraphs?|clauses?)\b[\s\S]*?)\s+of\s+sections?\s/i);
  const adding = verb[1].toLowerCase() === "amended by adding" ? clause.slice(verb.index + verb[0].length).match(/^\s+([\s\S]*?)\s+as follows\b/i) : null;
  // Repealing part of a section leaves the rest in force, so the section is amended.
  const action = verb[1].toLowerCase() === "repealed" && !partial ? "repealed" : "amended";
  const scope = adding ? `adds ${tidy(adding[1])}` : partial ? tidy(partial[1]) : null;
  return { action, targets, ...(scope && targets.length === 1 ? { scope } : {}) };
}

// One index for every listed session. Each act is described once, under "session/number";
// exact citations are keyed for lookup, and ranges are kept as ranges and compared in
// citation order.
export function buildAmendmentIndex(sessions, generatedAt = null) {
  const acts = {};
  const citations = {};
  const ranges = [];
  let references = 0;
  for (const { entry, acts: listed, texts } of sessions) {
    for (const act of listed) {
      const text = texts.get(act.id);
      if (!text || act.type !== "public") continue;
      const key = `${entry.id}/${act.number}`;
      const effective = new Map(text.sections.map((section) => [section.number, section.effective ?? null]));
      for (const block of text.blocks) {
        if (!block.anchor || !block.section) continue;
        const parsed = parseAmendmentClause(runsText(block.runs));
        if (!parsed) continue;
        acts[key] ??= {
          session: entry.id,
          year: entry.year,
          number: act.number,
          citation: act.citation,
          ...(text.approved ? { approved: text.approved.replace(/^Approved\s+/i, "") } : {})
        };
        const reference = {
          act: key,
          section: block.section,
          action: parsed.action,
          ...(parsed.scope ? { scope: parsed.scope } : {}),
          ...(effective.get(block.section) ? { effective: effective.get(block.section) } : {})
        };
        for (const target of parsed.targets) {
          references += 1;
          if (target.citation) (citations[target.citation] ??= []).push(reference);
          else ranges.push({ from: target.from, to: target.to, ...reference });
        }
      }
    }
  }
  return {
    schemaVersion: "1.0.0",
    generatedAt,
    sessions: sessions.map(({ entry }) => ({ id: entry.id, year: entry.year, name: entry.name })),
    counts: { acts: Object.keys(acts).length, citations: Object.keys(citations).length, ranges: ranges.length, references },
    acts,
    citations,
    ranges
  };
}

// Statute citations sort by title, then number, then letter suffix, where a longer suffix
// comes later (1-1z before 1-1aa). Citations in different titles (or UCC articles) are not
// comparable.
export function compareCitations(left, right) {
  const parse = (value) => String(value).toLowerCase().match(/^(.+)-(\d+)([a-z]*)$/);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b || a[1] !== b[1]) return null;
  return (Number(a[2]) - Number(b[2])) || (a[3].length - b[3].length) || a[3].localeCompare(b[3]);
}

export function citationInRange(citation, from, to) {
  const afterStart = compareCitations(citation, from);
  const beforeEnd = compareCitations(citation, to);
  return afterStart !== null && beforeEnd !== null && afterStart >= 0 && beforeEnd <= 0;
}

// Sessions whose acts the statute text cannot reflect yet: the newest edition in it, the base
// revision or a later supplement, covers legislation through the year before its own (as
// actsCurrencyNote describes).
export function pendingSessionIds(index, { supplementEditionYear = null, baseRevisionYear = null } = {}) {
  const covered = statuteTextEdition({ baseRevisionYear, supplementYear: supplementEditionYear })?.legislationThrough ?? null;
  return new Set((index?.sessions ?? []).filter((session) => covered === null || session.year > covered).map((session) => session.id));
}

// Every pending act section that amends or repeals the given statute section, in act order.
export function amendmentsForSection(index, section, { supplementEditionYear = null, baseRevisionYear = null } = {}) {
  if (!index || !section) return [];
  const pending = pendingSessionIds(index, { supplementEditionYear, baseRevisionYear });
  const citations = [...new Set((section.citations?.length ? section.citations : [section.citation]).filter(Boolean).map((citation) => citation.toLowerCase()))];
  const found = new Map();
  for (const citation of citations) {
    const references = [
      ...(index.citations[citation] ?? []),
      ...index.ranges.filter((range) => citationInRange(citation, range.from, range.to))
    ];
    for (const { act: key, section: actSection, action, scope = null, effective = null } of references) {
      const act = index.acts[key];
      if (!act || !pending.has(act.session)) continue;
      found.set(`${key}:${actSection}`, { ...act, section: actSection, action, scope, effective });
    }
  }
  return [...found.values()].sort((left, right) =>
    left.session.localeCompare(right.session) || left.number - right.number || Number(left.section) - Number(right.section));
}
