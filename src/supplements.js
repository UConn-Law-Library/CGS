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

export function applyChapterOverlay(baseChapter, overlayChapter, editionYear) {
  if (baseChapter && baseChapter.id !== overlayChapter.id) throw new Error("Supplement chapter does not match base chapter");
  const baseSections = baseChapter?.sections ?? [];
  const sections = [...baseSections];
  const replacedBaseSections = new Set();
  const changes = [];
  for (const overlaySection of overlayChapter.sections) {
    if (citations(overlaySection).length === 0) throw new Error("Supplement provisions require at least one citation");
    const matches = baseSections.filter((section) => sharesCitation(section, overlaySection));
    if (matches.length > 1) throw new Error("Supplement provision matches multiple chapter provisions");
    if (matches.length === 0) {
      sections.push(overlaySection);
      changes.push({ sectionId: overlaySection.id, kind: "addition" });
    } else {
      if (!sameCitations(matches[0], overlaySection)) throw new Error("Partial grouped-provision overlays are ambiguous");
      if (replacedBaseSections.has(matches[0].id)) throw new Error("Multiple supplement provisions replace one base provision");
      replacedBaseSections.add(matches[0].id);
      const index = sections.findIndex((section) => section.id === matches[0].id);
      sections[index] = overlaySection;
      changes.push({ sectionId: overlaySection.id, kind: "replacement" });
    }
  }
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
