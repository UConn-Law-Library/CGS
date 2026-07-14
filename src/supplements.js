import { comparableNumber } from "./routes.js";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function citations(section) {
  return section.citations ?? (section.citation ? [section.citation] : []);
}

function sameCitations(left, right) {
  const leftValues = citations(left);
  const rightValues = citations(right);
  return leftValues.length === rightValues.length && leftValues.every((value) => rightValues.includes(value));
}

function sharesCitation(left, right) {
  const rightValues = citations(right);
  return citations(left).some((value) => rightValues.includes(value));
}

function sectionKey(section) {
  return citations(section)[0] ?? section.id;
}

function isReservedPlaceholder(section) {
  const body = section.content?.body?.map((paragraph) => String(paragraph).trim())
    ?? String(section.content?.plainText ?? "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return section.kind === "group"
    && section.status === "reserved"
    && citations(section).length > 1
    && body[0]?.toLowerCase() === "reserved for future use."
    && body.slice(1).every((paragraph) => /^note:/i.test(paragraph));
}

function residualReservedPlaceholder(section, remaining) {
  const label = remaining.length === 1
    ? `Sec. ${remaining[0]}.`
    : `Secs. ${remaining.slice(0, -1).join(", ")} and ${remaining.at(-1)}.`;
  return {
    ...section,
    id: remaining.length === 1 ? `section-${remaining[0]}` : `group-${remaining.join("-to-")}`,
    kind: remaining.length === 1 ? "section" : "group",
    citation: remaining.length === 1 ? remaining[0] : null,
    citations: remaining,
    heading: `${label} Reserved for future use.`
  };
}

function resolveMatches(matches, overlaySection) {
  if (matches.length === 0) return { mode: "addition", primary: null, matches: [], placeholders: [] };
  const exactMatches = matches.filter((section) => sameCitations(section, overlaySection));
  if (matches.length === 1) {
    const primary = matches[0];
    if (exactMatches.length === 0 && !isReservedPlaceholder(primary)) {
      throw new Error("Partial grouped-provision overlays are ambiguous");
    }
    return { mode: "single", primary, matches: [primary], placeholders: [] };
  }
  if (exactMatches.length === 0) {
    const combined = [];
    let disjoint = true;
    for (const section of matches) {
      for (const citation of citations(section)) {
        if (combined.includes(citation)) disjoint = false;
        combined.push(citation);
      }
    }
    if (disjoint && combined.length === citations(overlaySection).length
      && combined.every((citation) => citations(overlaySection).includes(citation))) {
      return { mode: "aggregate", primary: null, matches, placeholders: [] };
    }
  }
  if (exactMatches.length !== 1) throw new Error("Supplement provision matches multiple chapter provisions");
  const primary = exactMatches[0];
  const placeholders = matches.filter((section) => section !== primary);
  if (!placeholders.every(isReservedPlaceholder)) {
    throw new Error("Supplement provision matches multiple chapter provisions");
  }
  return { mode: "single", primary, matches: [primary, ...placeholders], placeholders };
}

export function applyChapterOverlay(baseChapter, overlayChapter, editionYear) {
  if (baseChapter && baseChapter.id !== overlayChapter.id) throw new Error("Supplement chapter does not match base chapter");
  const baseSections = baseChapter?.sections ?? [];
  const entries = baseSections.map((section) => ({ baseId: section.id, section }));
  const matchedBaseCitations = new Map();
  const changes = [];
  for (const overlaySection of overlayChapter.sections) {
    if (citations(overlaySection).length === 0) throw new Error("Supplement provisions require at least one citation");
    const matches = baseSections.filter((section) => sharesCitation(section, overlaySection));
    if (matches.length === 0) {
      entries.push({ baseId: null, section: overlaySection });
      changes.push({ sectionId: overlaySection.id, kind: "addition" });
    } else {
      const resolved = resolveMatches(matches, overlaySection);
      for (const baseSection of resolved.matches) {
        const exactMatch = sameCitations(baseSection, overlaySection);
        const matched = matchedBaseCitations.get(baseSection.id) ?? new Set();
        if ((resolved.mode === "aggregate" || (baseSection === resolved.primary && exactMatch)) && matched.size > 0) {
          throw new Error("Multiple supplement provisions replace one base provision");
        }
        for (const citation of citations(overlaySection)) {
          if (!citations(baseSection).includes(citation)) continue;
          if (matched.has(citation)) throw new Error("Multiple supplement provisions replace one base citation");
          matched.add(citation);
        }
        matchedBaseCitations.set(baseSection.id, matched);
      }

      const updatePlaceholder = (baseSection) => {
        const index = entries.findIndex((entry) => entry.baseId === baseSection.id);
        if (index < 0) throw new Error("Supplement placeholder state is inconsistent");
        const remaining = citations(entries[index].section)
          .filter((citation) => !citations(overlaySection).includes(citation));
        if (remaining.length) entries[index].section = residualReservedPlaceholder(entries[index].section, remaining);
        else entries.splice(index, 1);
      };

      if (resolved.mode === "aggregate") {
        for (const baseSection of resolved.matches) {
          const index = entries.findIndex((entry) => entry.baseId === baseSection.id);
          if (index < 0) throw new Error("Supplement placeholder state is inconsistent");
          entries.splice(index, 1);
        }
        entries.push({ baseId: null, section: overlaySection });
      } else if (sameCitations(resolved.primary, overlaySection)) {
        const index = entries.findIndex((entry) => entry.baseId === resolved.primary.id);
        if (index < 0) throw new Error("Supplement placeholder state is inconsistent");
        entries[index].section = overlaySection;
      } else {
        updatePlaceholder(resolved.primary);
        entries.push({ baseId: null, section: overlaySection });
      }
      for (const placeholder of resolved.placeholders) updatePlaceholder(placeholder);
      changes.push({ sectionId: overlaySection.id, kind: "replacement" });
    }
  }
  const sections = entries.map((entry) => entry.section);
  sections.sort((left, right) => collator.compare(sectionKey(left), sectionKey(right)));
  return {
    chapter: { ...(baseChapter ?? overlayChapter), sections },
    overlay: { editionYear, sourceUrl: overlayChapter.sourceUrl, changes }
  };
}

export class SupplementRepository {
  #baseUrl;
  #fetch;
  #index;
  #manifests = new Map();

  constructor({ baseUrl = "./data/supplements/", fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = new URL(baseUrl, globalThis.location?.href ?? "http://localhost/");
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async #json(relativePath) {
    const response = await this.#fetch(new URL(relativePath, this.#baseUrl));
    if (!response.ok) throw new Error(`Could not load supplement ${relativePath} (${response.status})`);
    return response.json();
  }

  async init() {
    this.#index ??= await this.#json("manifest.json");
    return this.#index;
  }

  async loadEdition(editionYear) {
    const index = await this.init();
    const entry = index.editions.find((edition) => edition.editionYear === Number(editionYear));
    if (!entry) throw new Error(`Supplement edition ${editionYear} is not available`);
    if (!this.#manifests.has(entry.editionYear)) this.#manifests.set(entry.editionYear, this.#json(entry.path));
    return this.#manifests.get(entry.editionYear);
  }

  async loadChapter(editionYear, chapterNumber) {
    const manifest = await this.loadEdition(editionYear);
    const wanted = comparableNumber(chapterNumber);
    const chapter = manifest.titles
      .flatMap((title) => title.chapters)
      .find((entry) => comparableNumber(entry.number) === wanted);
    if (!chapter) return null;
    return this.#json(`${editionYear}/${chapter.path}`);
  }
}
