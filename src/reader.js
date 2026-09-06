import { routeHref } from "./routes.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

export function navigationSections(sections, { hideRepealed = false, selected = null } = {}) {
  if (!hideRepealed) return sections;
  return sections.filter((section) => section.status !== "repealed" || section === selected);
}

function compactCitation(citation) {
  return String(citation ?? "").replace(/^[^-]+-/, "");
}

export function navigationSectionLabel(section) {
  const citations = section.citations?.filter(Boolean) ?? (section.citation ? [section.citation] : []);
  if (citations.length > 1) {
    return `§§ ${citations[0]}–${compactCitation(citations.at(-1))}`;
  }
  if (citations.length === 1) return `§ ${citations[0]}`;
  return section.heading;
}

export function navigationSectionDescription(section) {
  return String(section.heading ?? "").replace(/^Secs?\.\s*[^.]+\.\s*/i, "").trim();
}

export function leadingSubsection(value) {
  const match = String(value ?? "").match(/^\s*(\(([a-z0-9ivxlcdm]+)\))\s*/i);
  if (!match) return null;
  return { label: match[1], key: match[2].toLowerCase(), text: String(value).slice(match[0].length) };
}

const sectionCitation = String.raw`\d+[a-z]*-\d+[a-z0-9]*(?:-\d+[a-z0-9]*)*(?![\w-])`;
const chapterCitation = String.raw`\d+[a-z]*(?![\w-])`;
const referenceSeparator = String.raw`(?:\s+(?:to|through|and|or)\s+|\s*,\s*(?:(?:and|or)\s+)?|\s*[–—]\s*)`;

// Share citation spans between discovery and rendering so every displayed link
// also has its destination loaded. Continue only through a citation list/range.
function* legalReferences(text) {
  const start = new RegExp(String.raw`\bsections?\s+(${sectionCitation})|\bchapters?\s+(${chapterCitation})`, "gi");
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
    const attributes = kind ? "" : ` target="_blank" rel="noopener noreferrer" title="Public Act ${escapeHtml(target)} on the Connecticut General Assembly website (opens in a new tab)"`;
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
