import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { importLegacy } from "./importer.mjs";
import { importSupplement } from "./supplement-importer.mjs";

// A representative edition pair built from the checked-in legacy fixture (Title 1, chapter 1):
// a full revision, its supplement with one replacement and one addition, and the next revision
// with the supplement's changes consolidated. Unit tests and the browser-test rehearsal use it
// while CGA has not yet published a real rollover.
const fixture = path.resolve("fixtures/legacy");

export const FIXTURE_REPLACED_SECTION = "1-1";
export const FIXTURE_ADDED_SECTION = "1-99";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function legacyInput(directory, { revisionYear, kind = "current", supplementYear = null, consolidated = null, prefix }) {
  const index = JSON.parse(await readFile(path.join(fixture, "titles_index.json"), "utf8"));
  const title = JSON.parse(await readFile(path.join(fixture, "title_01.json"), "utf8"));
  index.source = {
    ...index.source,
    kind,
    titles_url: `https://www.cga.ct.gov/${prefix}/titles.htm`,
    revision_year: revisionYear,
    generated_at_utc: `${revisionYear}-08-01T00:00:00Z`,
    ...(supplementYear ? { supplement_year: supplementYear } : {})
  };
  if (supplementYear) {
    title.url = `https://www.cga.ct.gov/${prefix}/title_01.htm`;
    title.supplement_year = supplementYear;
    title.chapters = [title.chapters[0]];
    const replacement = structuredClone(title.chapters[0].sections.find((section) => section.section_key === FIXTURE_REPLACED_SECTION));
    replacement.url = `https://www.cga.ct.gov/${prefix}/chap_001.htm#sec_${FIXTURE_REPLACED_SECTION}`;
    replacement.content.body_paragraphs = [`${replacement.content.body_paragraphs[0]} As amended by the ${supplementYear} Supplement.`];
    replacement.content.text = replacement.content.body_paragraphs.join("\n");
    const addition = structuredClone(replacement);
    addition.section_key = FIXTURE_ADDED_SECTION;
    addition.section_keys = [FIXTURE_ADDED_SECTION];
    addition.grouped = false;
    addition.label = `Sec. ${FIXTURE_ADDED_SECTION}. Provision added by the ${supplementYear} Supplement.`;
    addition.url = `https://www.cga.ct.gov/${prefix}/chap_001.htm#sec_${FIXTURE_ADDED_SECTION}`;
    addition.content.body_paragraphs = [`A provision first published in the ${supplementYear} Supplement.`];
    addition.content.text = addition.content.body_paragraphs[0];
    title.chapters[0].sections = [replacement, addition];
  } else if (consolidated) {
    // The next revision folds in the supplement's text.
    const chapter = title.chapters[0];
    const section = chapter.sections.find((entry) => entry.section_key === FIXTURE_REPLACED_SECTION);
    section.content.body_paragraphs = [`${section.content.body_paragraphs[0]} As amended by the ${consolidated} Supplement.`];
    section.content.text = section.content.body_paragraphs.join("\n");
  }
  await writeJson(path.join(directory, "titles_index.json"), index);
  await writeJson(path.join(directory, "title_01.json"), title);
  return directory;
}

// Writes <root>/published (revision N with supplement N+1) and <root>/candidate (revision N+2).
export async function buildEditionFixture(root, { revisionYear = 2025 } = {}) {
  const supplementYear = revisionYear + 1;
  const nextRevisionYear = revisionYear + 2;
  const published = path.join(root, "published");
  const candidate = path.join(root, "candidate");
  await importLegacy({
    inputDir: await legacyInput(path.join(root, "input-base"), { revisionYear, prefix: "current/pub" }),
    outputDir: published,
    generatedAt: `${supplementYear}-07-14T00:00:00Z`,
    revisionYear
  });
  await importSupplement({
    inputDir: await legacyInput(path.join(root, "input-supplement"), { revisionYear: supplementYear, kind: "supplement", supplementYear, prefix: `${supplementYear}/sup` }),
    outputDir: path.join(published, "supplements", String(supplementYear)),
    baseDataDir: published,
    editionYear: supplementYear,
    generatedAt: `${supplementYear}-08-01T00:00:00Z`
  });
  await importLegacy({
    inputDir: await legacyInput(path.join(root, "input-candidate"), { revisionYear: nextRevisionYear, consolidated: supplementYear, prefix: "current/pub" }),
    outputDir: candidate,
    generatedAt: `${nextRevisionYear}-07-14T00:00:00Z`,
    revisionYear: nextRevisionYear
  });
  return { published, candidate, revisionYear, supplementYear, nextRevisionYear };
}
