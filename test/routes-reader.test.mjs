import assert from "node:assert/strict";
import test from "node:test";
import {
  comparableNumber,
  findChapter,
  findSection,
  findTitle,
  parseRoute,
  routeHref,
  sectionRouteKey
} from "../src/routes.js";
import {
  escapeHtml,
  extractLegalReferences,
  leadingSubsection,
  renderLinkedText,
  routeForDocument
} from "../src/reader.js";

const catalog = {
  titles: [
    {
      id: "title-01",
      number: "01",
      chapters: [{ id: "chapter-001", number: "001", name: "Construction" }]
    },
    {
      id: "title-07",
      number: "07",
      chapters: [{ id: "chapter-113", number: "113", name: "Retirement" }]
    }
  ]
};

const chapter = {
  sections: [
    { id: "section-1-1", citation: "1-1", citations: ["1-1"] },
    { id: "group-1-2-to-1-3", citation: null, citations: ["1-2", "1-3"] }
  ]
};

test("builds and parses stable reader routes", () => {
  const href = routeHref({ title: "01", chapter: "001", section: "1-1", subsection: "a" });
  assert.equal(href, "#/t/01/c/001/s/1-1/p/a");
  assert.deepEqual(parseRoute({ hash: href }), {
    kind: "section",
    title: "01",
    chapter: "001",
    section: "1-1",
    subsection: "a"
  });
});

test("accepts the Phase 1 query route as a migration fallback", () => {
  assert.deepEqual(parseRoute({ search: "?chapter=001&section=section-1-1" }), {
    kind: "section",
    title: null,
    chapter: "001",
    section: "section-1-1",
    subsection: null,
    legacyQuery: true
  });
});

test("normalizes catalog numbers and resolves grouped sections", () => {
  assert.equal(comparableNumber("001a"), "1a");
  assert.equal(findTitle(catalog, "1").id, "title-01");
  assert.equal(findChapter(catalog, "113").title.id, "title-07");
  assert.equal(findSection(chapter, "1-3").id, "group-1-2-to-1-3");
  assert.equal(sectionRouteKey(chapter.sections[1]), "1-2");
});

test("recognizes subsection markers and safely renders linked legal references", () => {
  assert.deepEqual(leadingSubsection("(a) See section 7-452 and chapter 113."), {
    label: "(a)",
    key: "a",
    text: "See section 7-452 and chapter 113."
  });
  assert.deepEqual(extractLegalReferences(["See section 7-452 and chapter 113."]), {
    sections: ["7-452"],
    chapters: ["113"]
  });
  const rendered = renderLinkedText("See section 7-452 and chapter 113. <unsafe>", {
    sections: new Map([["7-452", "#/t/07/c/113/s/7-452"]]),
    chapters: new Map([["113", "#/t/07/c/113"]])
  });
  assert.match(rendered, /class="legal-reference" href="#\/t\/07\/c\/113\/s\/7-452">7-452<\/a>/);
  assert.match(rendered, /href="#\/t\/07\/c\/113">113<\/a>/);
  assert.match(rendered, /&lt;unsafe&gt;/);
  assert.equal(escapeHtml('"<&'), "&quot;&lt;&amp;");
});

test("uses canonical reader routes for annotated search documents", () => {
  assert.equal(routeForDocument({
    id: "section-1-1",
    citation: "1-1",
    citations: ["1-1"],
    href: "?chapter=001&section=section-1-1",
    title: { number: "01" },
    chapter: { number: "001" }
  }), "#/t/01/c/001/s/1-1");
});
