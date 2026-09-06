import assert from "node:assert/strict";
import test from "node:test";
import {
  chapterDisplayLabel,
  comparableNumber,
  findChapter,
  findSection,
  findTitle,
  infractionsRouteHref,
  indexRouteHref,
  parseRoute,
  routeHref,
  searchRouteHref,
  sectionRouteKey,
  titlesRouteHref
} from "../src/routes.js";
import {
  escapeHtml,
  extractLegalReferences,
  leadingSubsection,
  navigationSectionDescription,
  navigationSectionLabel,
  navigationSections,
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

test("formats UCC article identifiers as article labels", () => {
  assert.equal(chapterDisplayLabel({ number: "art-001" }), "Article 1");
  assert.equal(chapterDisplayLabel({ number: "art-002a" }), "Article 2A");
  assert.equal(chapterDisplayLabel({ number: "319aa" }), "Chapter 319aa");
  assert.equal(chapterDisplayLabel({ number: "former-58" }), "Former Chapter 58");
});

test("builds and parses index browse, search, and topic routes", () => {
  assert.equal(indexRouteHref("M"), "#/index/m");
  assert.equal(indexRouteHref("m", { query: "motor vehicles" }), "#/index/m?q=motor%20vehicles");
  assert.equal(
    indexRouteHref("c", { heading: "CHILDREN AND MINORS", subheading: "Abandonment" }),
    "#/index/c?heading=CHILDREN%20AND%20MINORS&subheading=Abandonment"
  );
  assert.deepEqual(parseRoute({ hash: "#/index/m/topic/topic-123?q=motor%20vehicles" }), {
    kind: "index", letter: "m", topic: "topic-123", query: "motor vehicles"
  });
  assert.deepEqual(parseRoute({ hash: "#/index" }), {
    kind: "index", letter: null, topic: null, query: null
  });
  assert.deepEqual(parseRoute({ hash: "#/index/c?heading=CHILDREN%20AND%20MINORS&subheading=Abandonment" }), {
    kind: "index",
    letter: "c",
    topic: null,
    query: null,
    heading: "CHILDREN AND MINORS",
    subheading: "Abandonment"
  });
});

test("builds and parses mobile destination routes", () => {
  assert.equal(titlesRouteHref(), "#/titles");
  assert.deepEqual(parseRoute({ hash: titlesRouteHref() }), { kind: "titles" });
  assert.equal(searchRouteHref("public records"), "#/search?q=public%20records");
  assert.deepEqual(parseRoute({ hash: "#/search?q=public%20records" }), {
    kind: "search", query: "public records", title: null, chapter: null, status: null,
    supplement: null, field: "statute", within: null, sort: "relevance"
  });
  const filteredSearch = searchRouteHref("public NEAR/5 records", {
    title: "title-01", chapter: "001", status: "active", supplement: "updated",
    field: "history", within: "tax*", sort: "citation"
  });
  assert.equal(filteredSearch, "#/search?q=public%20NEAR%2F5%20records&title=title-01&chapter=001&status=active&supplement=updated&field=history&within=tax*&sort=citation");
  assert.deepEqual(parseRoute({ hash: filteredSearch }), {
    kind: "search", query: "public NEAR/5 records", title: "title-01", chapter: "001",
    status: "active", supplement: "updated", field: "history", within: "tax*", sort: "citation"
  });
  const detail = infractionsRouteHref("MOTOR VEHICLES", { entry: "infraction-1" });
  assert.equal(detail, "#/infractions/MOTOR%20VEHICLES/entry/infraction-1");
  assert.deepEqual(parseRoute({ hash: detail }), {
    kind: "infractions", category: "MOTOR VEHICLES", entry: "infraction-1", query: null
  });
  assert.deepEqual(parseRoute({ hash: "#/bookmarks" }), { kind: "bookmarks" });
  assert.deepEqual(parseRoute({ hash: "#/about" }), { kind: "about" });
  assert.deepEqual(parseRoute({ hash: "#/a" }), { kind: "about" });
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

test("filters repealed sections from navigation while preserving a selected direct link", () => {
  const active = { id: "active", status: "active" };
  const repealed = { id: "repealed", status: "repealed" };
  assert.deepEqual(navigationSections([active, repealed]), [active, repealed]);
  assert.deepEqual(navigationSections([active, repealed], { hideRepealed: true }), [active]);
  assert.deepEqual(navigationSections([active, repealed], { hideRepealed: true, selected: repealed }), [active, repealed]);
});

test("uses complete citations and clean descriptions in chapter navigation", () => {
  assert.equal(navigationSectionLabel({ citation: "36-53", citations: ["36-53"] }), "§ 36-53");
  assert.equal(navigationSectionLabel({ citation: null, citations: ["36-53", "36-54", "36-93"] }), "§§ 36-53–93");
  assert.equal(
    navigationSectionDescription({ heading: "Sec. 9-135b. Preparation and printing of absentee ballots." }),
    "Preparation and printing of absentee ballots."
  );
  assert.equal(navigationSectionDescription({ heading: "Sec. 9-136." }), "");
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

test("links both endpoints of the section range in 4-66aa", () => {
  const text = "historic preservation activities as provided in sections 10-409 to 10-415 , inclusive;";
  assert.deepEqual(extractLegalReferences([text]), {
    sections: ["10-409", "10-415"], chapters: []
  });
  assert.equal(renderLinkedText(text, {
    sections: new Map([
      ["10-409", "#/t/10/c/184b/s/10-409"],
      ["10-415", "#/t/10/c/184b/s/10-415"]
    ])
  }), 'historic preservation activities as provided in sections <a class="legal-reference" href="#/t/10/c/184b/s/10-409">10-409</a> to <a class="legal-reference" href="#/t/10/c/184b/s/10-415">10-415</a> , inclusive;');
});

test("discovers citation lists, subsection-qualified references, and chapter ranges", () => {
  assert.deepEqual(extractLegalReferences([
    "Sections 4-66aa(a)(1), 4-66cc and 10-409 through 10-415, inclusive, or 22-26j.",
    "Chapters 50, 184b and 422 to 425; sections 42a-9-101–42a-9-103.",
    "Section 4-66AA and section 4a-1; chapters 50—54."
  ]), {
    sections: ["4-66aa", "4-66cc", "10-409", "10-415", "22-26j", "42a-9-101", "42a-9-103", "4a-1"],
    chapters: ["50", "184b", "422", "425", "54"]
  });
});

test("preserves citation list formatting and escapes text and destinations", () => {
  const text = "SECTIONS\n4-66AA(a),\t4-66cc & <unsafe>; chapters 50 and 184b.";
  const maps = {
    sections: new Map([["4-66aa", '#/example?x="&y=1']]),
    chapters: new Map([["184b", "#/t/10/c/184b"]])
  };
  assert.equal(renderLinkedText(text, maps), 'SECTIONS\n<a class="legal-reference" href="#/example?x=&quot;&amp;y=1">4-66AA</a>(a),\t4-66cc &amp; &lt;unsafe&gt;; chapters 50 and <a class="legal-reference" href="#/t/10/c/184b">184b</a>.');
  assert.equal(renderLinkedText(text), escapeHtml(text));
});

test("stops citation lists at unrelated prose and does not infer bare references", () => {
  assert.deepEqual(extractLegalReferences([
    "Section 4-66aa applies to special act 75-93 and 10-415 is mentioned later.",
    "Sections 10-409 to 10-415, inclusive; special act 75-93.",
    "Chapters 50 and section 4-66cc. 2026-01-01 and 10-409.",
    "Chapter 42a-9-101 is not a chapter number."
  ]), { sections: ["4-66aa", "10-409", "10-415", "4-66cc"], chapters: ["50"] });
});

test("links the abbreviated See references at the end of 2-71h", () => {
  const values = [
    "See Sec. 4b-54(b) for powers and duties re paintings, portraits, statues or tablets to be hung or placed at the State Capitol.",
    "See Sec. 5-142(a) re injuries sustained by State Capitol Police.",
    "See Sec. 5-145a re disability or death resulting from hypertension or heart disease suffered by State Capitol Police.",
    "See Secs. 29-8a and 53-39a re indemnification of State Capitol Police."
  ];
  const destinations = [
    ["4b-54", "#/t/04b/c/060/s/4b-54"],
    ["5-142", "#/t/05/c/065/s/5-142"],
    ["5-145a", "#/t/05/c/065/s/5-145a"],
    ["29-8a", "#/t/29/c/529/s/29-8a"],
    ["53-39a", "#/t/53/c/939/s/53-39a"]
  ];
  assert.deepEqual(extractLegalReferences(values), {
    sections: destinations.map(([citation]) => citation), chapters: []
  });
  const text = values.join("\n");
  const html = renderLinkedText(text, { sections: new Map(destinations) });
  for (const [citation, href] of destinations) {
    assert.ok(html.includes(`<a class="legal-reference" href="${href}">${citation}</a>`));
  }
  assert.ok(html.includes('>4b-54</a>(b)'));
  assert.ok(html.includes('>5-142</a>(a)'));
  assert.equal(html.replace(/<a\b[^>]*>([^<]*)<\/a>/g, "$1"), text);
});

test("recognizes abbreviated ranges and history references with varied casing and spacing", () => {
  assert.deepEqual(extractLegalReferences([
    "See sec.4b-54(b); SEC.\n5-142(a).",
    "See Secs. 10-409 to 10-415, inclusive, and 5-145a.",
    "History: P.A. 83-13 deleted reference to a special policeman under Sec. 29-18 in Subsec. (a).",
    "See SECS.\t29-8a and 53-39a; section 4b-54."
  ]), {
    sections: ["4b-54", "5-142", "10-409", "10-415", "5-145a", "29-18", "29-8a", "53-39a"], chapters: []
  });
});

test("does not treat subsection abbreviations as section labels and preserves unresolved citations", () => {
  const text = "Subsec. 4b-54; Subsecs. 5-142 and 5-145a; 29-8a. See Sec. 999-1(b). <unsafe>";
  assert.deepEqual(extractLegalReferences([text]), { sections: ["999-1"], chapters: [] });
  assert.equal(renderLinkedText(text, {
    sections: new Map([["4b-54", "#/t/04b/c/060/s/4b-54"]])
  }), escapeHtml(text));
});
