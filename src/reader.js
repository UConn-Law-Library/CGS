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

export function renderLinkedText(value, { sections = new Map(), chapters = new Map() } = {}) {
  const text = String(value ?? "");
  const parts = [];
  let cursor = 0;
  for (const { kind, target, index, end } of legalReferences(text)) {
    parts.push(escapeHtml(text.slice(cursor, index)));
    const href = (kind === "sections" ? sections : chapters).get(target.toLowerCase());
    parts.push(href
      ? `<a class="legal-reference" href="${escapeHtml(href)}">${escapeHtml(target)}</a>`
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
