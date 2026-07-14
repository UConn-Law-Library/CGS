import { searchDocument } from "./importer.mjs";

export function createSupplementSearchPatch(baseChapter, consolidated, editionYear) {
  const baseDocuments = (baseChapter?.sections ?? []).map((section) => searchDocument(section, baseChapter));
  const changeBySection = new Map(consolidated.overlay.changes.map((change) => [change.sectionId, change]));
  const currentDocuments = consolidated.chapter.sections.map((section) => {
    const document = searchDocument(section, consolidated.chapter);
    const change = changeBySection.get(section.id);
    return change ? {
      ...document,
      supplement: { editionYear, presentation: change.presentation }
    } : document;
  });
  const baseById = new Map(baseDocuments.map((document) => [document.id, document]));
  const currentById = new Map(currentDocuments.map((document) => [document.id, document]));
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  return {
    removedDocumentIds: baseDocuments
      .filter((document) => !same(document, currentById.get(document.id)))
      .map((document) => document.id),
    documents: currentDocuments.filter((document) => !same(document, baseById.get(document.id)))
  };
}
