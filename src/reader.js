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

const legalReferencePattern = /\b(section(?:s)?)\s+(\d+[a-z]*-\d+[a-z0-9-]*)|\b(chapter(?:s)?)\s+(\d+[a-z]*)/gi;

export function extractLegalReferences(values) {
  const sections = new Set();
  const chapters = new Set();
  for (const value of values) {
    legalReferencePattern.lastIndex = 0;
    for (const match of String(value ?? "").matchAll(legalReferencePattern)) {
      if (match[2]) sections.add(match[2].toLowerCase());
      if (match[4]) chapters.add(match[4].toLowerCase());
    }
  }
  return { sections: [...sections], chapters: [...chapters] };
}

export function renderLinkedText(value, { sections = new Map(), chapters = new Map() } = {}) {
  const text = String(value ?? "");
  const parts = [];
  let cursor = 0;
  legalReferencePattern.lastIndex = 0;
  for (const match of text.matchAll(legalReferencePattern)) {
    parts.push(escapeHtml(text.slice(cursor, match.index)));
    const label = match[1] ?? match[3];
    const target = match[2] ?? match[4];
    const href = match[2] ? sections.get(target.toLowerCase()) : chapters.get(target.toLowerCase());
    parts.push(`${escapeHtml(label)} ${href
      ? `<a class="legal-reference" href="${escapeHtml(href)}">${escapeHtml(target)}</a>`
      : escapeHtml(target)}`);
    cursor = match.index + match[0].length;
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
