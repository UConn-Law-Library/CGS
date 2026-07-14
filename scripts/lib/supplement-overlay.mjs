function citations(section) {
  return new Set(section.citations ?? (section.citation ? [section.citation] : []));
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function classifyChapterOverlay(overlayChapter, baseChapter = null) {
  const baseSections = baseChapter?.sections ?? [];
  const matchedBaseSections = new Set();
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
    if (matches.length > 1) {
      throw new Error(`${overlayChapter.id}/${overlaySection.id}: overlay citations match multiple base provisions`);
    }
    if (matches.length === 0) {
      additions += 1;
      continue;
    }
    if (!sameSet(overlayCitations, citations(matches[0]))) {
      throw new Error(`${overlayChapter.id}/${overlaySection.id}: partial grouped-provision overlays are ambiguous`);
    }
    if (matchedBaseSections.has(matches[0].id)) {
      throw new Error(`${overlayChapter.id}/${overlaySection.id}: multiple overlay provisions replace ${matches[0].id}`);
    }
    matchedBaseSections.add(matches[0].id);
    replacements += 1;
  }
  return { replacements, additions };
}
