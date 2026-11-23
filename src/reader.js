import { routeHref } from "./routes.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

// A link inside a grouped entry can be imported as a separate section whose heading is
// just its citation. Use the first matching provision, as citation routes do.
export function groupedSectionAliases(sections) {
  const firstByCitation = new Map();
  const aliases = new Map();
  for (const section of sections) {
    const citation = section.citation?.toLowerCase();
    const first = firstByCitation.get(citation);
    if (first?.kind === "group" && section.heading?.replace(/\s+/g, "").toLowerCase() === citation) {
      aliases.set(section, first);
    }
    for (const value of section.citations ?? (citation ? [citation] : [])) {
      const key = value.toLowerCase();
      if (!firstByCitation.has(key)) firstByCitation.set(key, section);
    }
  }
  return aliases;
}

// Leaves out sections whose every status is hidden. An entry that was "transferred or
// repealed" stays unless both are hidden. The open section always stays.
export function navigationSections(sections, { hiddenStatuses = [], selected = null } = {}) {
  if (!hiddenStatuses.length) return sections;
  return sections.filter((section) => section === selected || !isHiddenByStatus(sectionStatuses(section), hiddenStatuses));
}

export function isHiddenByStatus(statuses, hiddenStatuses) {
  return statuses.length > 0 && statuses.every((status) => hiddenStatuses.includes(status));
}

// Tags always show in this order, whether they come from the stored data or from the note.
const TAGGED_STATUSES = ["transferred", "repealed", "obsolete", "reserved"];
const DISPOSITION_WORD = "(?:deemed\\s+)?(?:transferred|repealed|obsolete|reserved)";
const GROUP_DISPOSITION = new RegExp(
  `^S\\s?ections?\\s+.{0,300}?\\b(?:has|have)\\s+been\\s+((?:${DISPOSITION_WORD},?\\s+(?:(?:or|and)\\s+)?)*${DISPOSITION_WORD})\\s*(?:[.;,]|$)`,
  "is"
);

function orderedStatuses(values) {
  const present = new Set(values.map((value) => String(value).toLowerCase()));
  return TAGGED_STATUSES.filter((status) => present.has(status));
}

// The statuses a section's tags show. A "mixed" entry lists its statuses in `statuses`. Entries
// imported before issue #64 was fixed are recorded as active although their text is only a
// disposition note, such as "Sections 46-1 to 46-8, inclusive, have been transferred or
// repealed."; that sentence decides their tags until the next corpus refresh records them.
// Search documents, which carry `text` rather than `content.body`, are read the same way.
export function sectionStatuses(section) {
  const status = section?.status;
  if (TAGGED_STATUSES.includes(status)) return [status];
  if (status === "mixed" && Array.isArray(section.statuses)) {
    const stored = orderedStatuses(section.statuses);
    if (stored.length) return stored;
  }
  if (status && status !== "active" && status !== "mixed") return [];
  const note = section?.content?.body?.[0] ?? String(section?.text ?? "").split("\n\n", 1)[0];
  const match = String(note ?? "").match(GROUP_DISPOSITION);
  return match ? orderedStatuses(match[1].match(/transferred|repealed|obsolete|reserved/gi)) : [];
}

// The advanced search's status filter reads the same tags as navigation. A filter on one
// status finds entries that list it among others; "Mixed" finds entries with several.
export function statusFilterMatches(section, filter) {
  if (!filter) return true;
  const tags = sectionStatuses(section);
  if (filter === "active") return tags.length === 0 && (section?.status ?? "active") === "active";
  if (filter === "mixed") return section?.status === "mixed" || tags.length > 1;
  return section?.status === filter || tags.includes(filter);
}

function compactCitation(citation) {
  return String(citation ?? "").replace(/^[^-]+-/, "");
}

export function navigationSectionLabel(section, { compact = true } = {}) {
  const citations = section.citations?.filter(Boolean) ?? (section.citation ? [section.citation] : []);
  if (citations.length > 1) {
    const first = citations[0];
    const last = citations.at(-1);
    return compact ? `§§ ${first}–${compactCitation(last)}` : `Secs. ${first} to ${last}`;
  }
  if (citations.length === 1) return `${compact ? "§" : "Sec."} ${citations[0]}`;
  return section.heading;
}

export function navigationSectionDescription(section) {
  return String(section.heading ?? "").replace(/^Secs?\.\s*[^.]+\.\s*/i, "").trim();
}

// The first sentence of a description, for compact navigation rows. A leading
// "(Formerly Sec. 1-66)." note is skipped, since its periods would end the sentence early.
export function shortSectionDescription(description) {
  const text = String(description ?? "");
  const title = text.replace(/^\(Formerly\b[^()]*\)\.?\s*/i, "");
  return title ? title.split(/(?<=\.)\s+/, 1)[0] : text;
}

export function leadingSubsection(value) {
  const match = String(value ?? "").match(/^\s*(\(([a-z0-9ivxlcdm]+)\))\s*/i);
  if (!match) return null;
  return { label: match[1], key: match[2].toLowerCase(), text: String(value).slice(match[0].length) };
}

export function subsectionCitation(section, subsection) {
  const citation = section?.citation ?? section?.citations?.find(Boolean);
  if (!citation) return null;
  return `C.G.S. § ${citation}${String(subsection?.label ?? subsection ?? "").trim()}`;
}

const sectionCitation = String.raw`\d+[a-z]*-\d+[a-z0-9]*(?:-\d+[a-z0-9]*)*(?![\w-])`;
const chapterCitation = String.raw`\d+[a-z]*(?![\w-])`;
const referenceSeparator = String.raw`(?:\s+(?:to|through|and|or)\s+|\s*,\s*(?:(?:and|or)\s+)?|\s*[–—]\s*)`;

// Share citation spans between discovery and rendering so every displayed link
// also has its destination loaded. Continue only through a citation list/range.
function* legalReferences(text) {
  const start = new RegExp(String.raw`\b(?:sections?\s+|secs?\.\s*)(${sectionCitation})|\bchapters?\s+(${chapterCitation})`, "gi");
  for (const match of text.matchAll(start)) {
    const kind = match[1] ? "sections" : "chapters";
    const target = match[1] ?? match[2];
    let end = match.index + match[0].length;
    yield { kind, target, index: end - target.length, end };

    const continuation = new RegExp(
      String.raw`(?:\s*\([a-z0-9]+\))*(?:\s*,\s*inclusive\b)?${referenceSeparator}(${kind === "sections" ? sectionCitation : chapterCitation})`,
      "iy"
    );
    continuation.lastIndex = end;
    let next;
    while ((next = continuation.exec(text))) {
      end = continuation.lastIndex;
      yield { kind, target: next[1], index: end - next[1].length, end };
    }
  }
}

export function extractLegalReferences(values) {
  const sections = new Set();
  const chapters = new Set();
  for (const value of values) {
    for (const { kind, target } of legalReferences(String(value ?? ""))) {
      (kind === "sections" ? sections : chapters).add(target.toLowerCase());
    }
  }
  return { sections: [...sections], chapters: [...chapters] };
}

const publicActCitation = String.raw`\d{2}-\d{1,5}(?![\w-])`;

function publicActHref(citation) {
  const [shortYear, number] = citation.split("-").map(Number);
  // Year-prefixed act numbers date from 1973. CGA's bill/act lookup offers
  // 1991 onward; don't turn older citations into misleading or broken links.
  const year = (shortYear >= 73 ? 1900 : 2000) + shortYear;
  if (year < 1991 || year > new Date().getFullYear() || number === 0) return null;
  // CGA lists the matching sessions when an act number is shared, rather than
  // silently selecting a regular-session act for a special-session reference.
  return `https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Public+Act&which_year=${year}&bill_num=${number}`;
}

function* publicActReferences(text) {
  const start = new RegExp(String.raw`\b(?:public\s+acts?\s+(?:nos?\.?\s+)?|P\.\s*A\.\s*)(${publicActCitation})`, "gi");
  for (const match of text.matchAll(start)) {
    const target = match[1];
    let end = match.index + match[0].length;
    yield { target, index: end - target.length, end, href: publicActHref(target) };

    // Source notes often omit "P.A." after a semicolon, including after the
    // act's section numbers: "P.A. 93-336, S. 5, 13; 93-435, S. 83, 95".
    const continuation = new RegExp(
      String.raw`(?:${referenceSeparator}|(?:\s*,\s*S\.\s*\d+(?:\s*,\s*\d+)*)?\s*;\s*)(${publicActCitation})`,
      "iy"
    );
    continuation.lastIndex = end;
    let next;
    while ((next = continuation.exec(text))) {
      end = continuation.lastIndex;
      yield { target: next[1], index: end - next[1].length, end, href: publicActHref(next[1]) };
    }
  }
}

export function renderLinkedText(value, { sections = new Map(), chapters = new Map() } = {}) {
  const text = String(value ?? "");
  const parts = [];
  let cursor = 0;
  const references = [...legalReferences(text), ...publicActReferences(text)].sort((a, b) => a.index - b.index);
  for (const { kind, target, index, end, href: actHref } of references) {
    parts.push(escapeHtml(text.slice(cursor, index)));
    const href = kind ? (kind === "sections" ? sections : chapters).get(target.toLowerCase()) : actHref;
    // data-public-act keeps later statute-link enrichment off these links: "P.A. 14-1" and
    // "section 14-1" read the same once the prefix is gone.
    const attributes = kind ? "" : ` data-public-act target="_blank" rel="noopener noreferrer" title="Public Act ${escapeHtml(target)} on the Connecticut General Assembly website (opens in a new tab)"`;
    parts.push(href
      ? `<a class="legal-reference" href="${escapeHtml(href)}"${attributes}>${escapeHtml(target)}</a>`
      : escapeHtml(target));
    cursor = end;
  }
  parts.push(escapeHtml(text.slice(cursor)));
  return parts.join("");
}

export function routeForDocument(document) {
  if (!document.title?.number || !document.chapter?.number) return document.href;
  return routeHref({
    title: document.title.number,
    chapter: document.chapter.number,
    section: document.citation ?? document.citations?.[0] ?? document.id
  });
}
