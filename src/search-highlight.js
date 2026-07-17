import { compileSearchQuery } from "./search.js";
import { escapeHtml } from "./reader.js";

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchHighlightTerms(query) {
  try {
    return compileSearchQuery(query).positives
      .map(({ value }) => value)
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
  } catch {
    return [];
  }
}

function highlightPattern(terms) {
  if (!terms.length) return null;
  const alternatives = terms.map((term) => escapePattern(term).replace(/\s+/g, "\\s+"));
  return new RegExp(`(${alternatives.join("|")})`, "giu");
}

export function renderSearchHighlight(value, terms) {
  const text = String(value ?? "");
  const pattern = highlightPattern(terms);
  if (!pattern) return escapeHtml(text);
  return text.split(pattern)
    .map((part, index) => index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))
    .join("");
}

export function renderSearchExcerpt(value, terms, { length = 240, context = 60 } = {}) {
  const text = String(value ?? "");
  const pattern = highlightPattern(terms);
  const firstMatch = pattern ? text.search(pattern) : -1;
  let start = firstMatch > context ? firstMatch - context : 0;
  let end = Math.min(text.length, start + length);
  if (end === text.length) start = Math.max(0, end - length);
  if (start > 0) {
    const nextSpace = text.indexOf(" ", start);
    if (nextSpace !== -1 && nextSpace < firstMatch) start = nextSpace + 1;
  }
  if (end < text.length) {
    const previousSpace = text.lastIndexOf(" ", end);
    if (previousSpace > start) end = previousSpace;
  }
  return `${start ? "…" : ""}${renderSearchHighlight(text.slice(start, end), terms)}${end < text.length ? "…" : ""}`;
}
