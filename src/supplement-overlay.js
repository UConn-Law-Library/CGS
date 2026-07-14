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

function resolveMatches(chapterId, overlaySection, matches) {
  if (matches.length === 0) return { mode: "addition", primary: null, matches: [], placeholders: [] };
  const exactMatches = matches.filter((section) => sameCitations(section, overlaySection));
  if (matches.length === 1) {
    const primary = matches[0];
    if (exactMatches.length === 0 && !isReservedPlaceholder(primary)) {
      throw new Error(`${chapterId}/${overlaySection.id}: partial grouped-provision overlays are ambiguous`);
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
  if (exactMatches.length !== 1) {
    throw new Error(`${chapterId}/${overlaySection.id}: overlay citations match multiple base provisions`);
  }
  const primary = exactMatches[0];
  const placeholders = matches.filter((section) => section !== primary);
  if (!placeholders.every(isReservedPlaceholder)) {
    throw new Error(`${chapterId}/${overlaySection.id}: overlay citations match multiple base provisions`);
  }
  return { mode: "single", primary, matches: [primary, ...placeholders], placeholders };
}

function trackMatches(chapterId, overlaySection, resolved, matchedBaseCitations) {
  for (const baseSection of resolved.matches) {
    const exactMatch = sameCitations(baseSection, overlaySection);
    const matched = matchedBaseCitations.get(baseSection.id) ?? new Set();
    if ((resolved.mode === "aggregate" || (baseSection === resolved.primary && exactMatch)) && matched.size > 0) {
      throw new Error(`${chapterId}/${overlaySection.id}: multiple overlay provisions replace ${baseSection.id}`);
    }
    for (const citation of citations(overlaySection)) {
      if (!citations(baseSection).includes(citation)) continue;
      if (matched.has(citation)) {
        throw new Error(`${chapterId}/${overlaySection.id}: multiple overlay provisions replace ${citation}`);
      }
      matched.add(citation);
    }
    matchedBaseCitations.set(baseSection.id, matched);
  }
}

function presentationKind(overlaySection, kind, previousSections) {
  if (overlaySection.status === "repealed") return "repealed";
  if (kind === "addition" || (previousSections.length && previousSections.every((section) => section.status === "reserved"))) {
    return "new";
  }
  return "amended";
}

export function classifyChapterOverlay(overlayChapter, baseChapter = null) {
  const baseSections = baseChapter?.sections ?? [];
  const matchedBaseCitations = new Map();
  let replacements = 0;
  let additions = 0;

  for (const overlaySection of overlayChapter.sections ?? []) {
    if (citations(overlaySection).length === 0) {
      throw new Error(`${overlayChapter.id}/${overlaySection.id}: supplement provisions require at least one citation`);
    }
    const matches = baseSections.filter((section) => sharesCitation(section, overlaySection));
    if (matches.length === 0) {
      additions += 1;
      continue;
    }
    const resolved = resolveMatches(overlayChapter.id, overlaySection, matches);
    trackMatches(overlayChapter.id, overlaySection, resolved, matchedBaseCitations);
    replacements += 1;
  }
  return { replacements, additions };
}

export function applyChapterOverlay(baseChapter, overlayChapter, editionYear) {
  if (baseChapter && baseChapter.id !== overlayChapter.id) throw new Error("Supplement chapter does not match base chapter");
  const baseSections = baseChapter?.sections ?? [];
  const entries = baseSections.map((section) => ({ baseId: section.id, section }));
  const matchedBaseCitations = new Map();
  const changes = [];

  for (const overlaySection of overlayChapter.sections ?? []) {
    if (citations(overlaySection).length === 0) {
      throw new Error(`${overlayChapter.id}/${overlaySection.id}: supplement provisions require at least one citation`);
    }
    const matches = baseSections.filter((section) => sharesCitation(section, overlaySection));
    if (matches.length === 0) {
      entries.push({ baseId: null, section: overlaySection });
      changes.push({
        sectionId: overlaySection.id,
        kind: "addition",
        presentation: presentationKind(overlaySection, "addition", []),
        previousSections: []
      });
      continue;
    }

    const resolved = resolveMatches(overlayChapter.id, overlaySection, matches);
    trackMatches(overlayChapter.id, overlaySection, resolved, matchedBaseCitations);
    const previousSections = resolved.mode === "aggregate" ? resolved.matches : [resolved.primary];

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
    changes.push({
      sectionId: overlaySection.id,
      kind: "replacement",
      presentation: presentationKind(overlaySection, "replacement", previousSections),
      previousSections
    });
  }

  const sections = entries.map((entry) => entry.section);
  sections.sort((left, right) => collator.compare(sectionKey(left), sectionKey(right)));
  return {
    chapter: { ...(baseChapter ?? overlayChapter), sections },
    overlay: { editionYear, sourceUrl: overlayChapter.sourceUrl, changes }
  };
}
