function citations(section) {
  return new Set(section.citations ?? (section.citation ? [section.citation] : []));
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function isReservedPlaceholder(section) {
  const body = section.content?.body?.map((paragraph) => String(paragraph).trim())
    ?? String(section.content?.plainText ?? "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return section.kind === "group"
    && section.status === "reserved"
    && citations(section).size > 1
    && body[0]?.toLowerCase() === "reserved for future use."
    && body.slice(1).every((paragraph) => /^note:/i.test(paragraph));
}

function resolveMatches(overlayChapter, overlaySection, matches, overlayCitations) {
  if (matches.length === 0) return { mode: "addition", primary: null, matches: [], placeholders: [] };
  const exactMatches = matches.filter((section) => sameSet(overlayCitations, citations(section)));
  if (matches.length === 1) {
    const primary = matches[0];
    if (exactMatches.length === 0 && !isReservedPlaceholder(primary)) {
      throw new Error(`${overlayChapter.id}/${overlaySection.id}: partial grouped-provision overlays are ambiguous`);
    }
    return { mode: "single", primary, matches: [primary], placeholders: [] };
  }
  if (exactMatches.length === 0) {
    const combined = new Set();
    let disjoint = true;
    for (const section of matches) {
      for (const citation of citations(section)) {
        if (combined.has(citation)) disjoint = false;
        combined.add(citation);
      }
    }
    if (disjoint && sameSet(overlayCitations, combined)) {
      return { mode: "aggregate", primary: null, matches, placeholders: [] };
    }
  }
  if (exactMatches.length !== 1) {
    throw new Error(`${overlayChapter.id}/${overlaySection.id}: overlay citations match multiple base provisions`);
  }
  const primary = exactMatches[0];
  const placeholders = matches.filter((section) => section !== primary);
  if (!placeholders.every(isReservedPlaceholder)) {
    throw new Error(`${overlayChapter.id}/${overlaySection.id}: overlay citations match multiple base provisions`);
  }
  return { mode: "single", primary, matches: [primary, ...placeholders], placeholders };
}

export function classifyChapterOverlay(overlayChapter, baseChapter = null) {
  const baseSections = baseChapter?.sections ?? [];
  const matchedBaseCitations = new Map();
  let replacements = 0;
  let additions = 0;

  for (const overlaySection of overlayChapter.sections ?? []) {
    const overlayCitations = citations(overlaySection);
    if (overlayCitations.size === 0) {
      throw new Error(`${overlayChapter.id}/${overlaySection.id}: supplement provisions require at least one citation`);
    }
    const matches = baseSections.filter((section) => {
      const baseCitations = citations(section);
      return [...overlayCitations].some((citation) => baseCitations.has(citation));
    });
    if (matches.length === 0) {
      additions += 1;
      continue;
    }
    const resolved = resolveMatches(overlayChapter, overlaySection, matches, overlayCitations);
    for (const baseSection of resolved.matches) {
      const baseCitations = citations(baseSection);
      const exactMatch = sameSet(overlayCitations, baseCitations);
      const matched = matchedBaseCitations.get(baseSection.id) ?? new Set();
      if ((resolved.mode === "aggregate" || (baseSection === resolved.primary && exactMatch)) && matched.size > 0) {
        throw new Error(`${overlayChapter.id}/${overlaySection.id}: multiple overlay provisions replace ${baseSection.id}`);
      }
      for (const citation of overlayCitations) {
        if (!baseCitations.has(citation)) continue;
        if (matched.has(citation)) {
          throw new Error(`${overlayChapter.id}/${overlaySection.id}: multiple overlay provisions replace ${citation}`);
        }
        matched.add(citation);
      }
      matchedBaseCitations.set(baseSection.id, matched);
    }
    replacements += 1;
  }
  return { replacements, additions };
}
