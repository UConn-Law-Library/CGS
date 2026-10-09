import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  amendmentsForSection,
  buildAmendmentIndex,
  citationInRange,
  compareCitations,
  parseAmendmentClause
} from "../src/act-amendments.js";
import { generateActAmendments } from "../scripts/lib/act-amendments-artifact.mjs";

test("reads the sections an act amends or repeals from its opening clause", () => {
  assert.deepEqual(
    parseAmendmentClause("Section 1. Section 22a-245 of the 2026 supplement to the general statutes is repealed and the following is substituted in lieu thereof (Effective from passage):"),
    { action: "amended", targets: [{ citation: "22a-245" }] }
  );
  assert.deepEqual(
    parseAmendmentClause("Sec. 35. Subdivision (2) of subsection (d) of section 10-51 of the 2026 supplement to the general statutes is repealed and the following is substituted in lieu thereof (Effective July 1, 2026):"),
    { action: "amended", targets: [{ citation: "10-51" }], scope: "subdivision (2) of subsection (d)" }
  );
  assert.deepEqual(
    parseAmendmentClause("Sec. 20. Section 10-5 of the general statutes is amended by adding subsection (g) as follows (Effective July 1, 2026):"),
    { action: "amended", targets: [{ citation: "10-5" }], scope: "adds subsection (g)" }
  );
  assert.deepEqual(
    parseAmendmentClause("Sec. 98. Section 10-234gg of the general statutes is repealed. (Effective from passage)"),
    { action: "repealed", targets: [{ citation: "10-234gg" }] }
  );
  // A range and a list, as one repeal.
  assert.deepEqual(
    parseAmendmentClause("Sec. 69. Sections 20-324g and 42-103b to 42-103m, inclusive, of the general statutes are repealed. (Effective from passage)"),
    { action: "repealed", targets: [{ citation: "20-324g" }, { from: "42-103b", to: "42-103m" }] }
  );
  // Repealing part of a section leaves the rest, so it is an amendment.
  assert.equal(parseAmendmentClause("Sec. 4. Subsections (b) and (c) of section 10-66bb of the general statutes are repealed. (Effective July 1, 2026)").action, "amended");
  // UCC sections have three parts.
  assert.deepEqual(parseAmendmentClause("Sec. 3. Subsection (a) of section 42a-9-204 of the 2026 supplement to the general statutes is repealed and the following is substituted in lieu thereof (Effective October 1, 2026):").targets, [{ citation: "42a-9-204" }]);
  // "As amended by" names the history, not another target.
  assert.deepEqual(
    parseAmendmentClause("Sec. 51. Subsections (e) to (s), inclusive, of section 21a-420d of the 2026 supplement to the general statutes, as amended by section 54 of public act 26-8, and section 50 of this act, are repealed and the following is substituted in lieu thereof (Effective from passage):"),
    { action: "amended", targets: [{ citation: "21a-420d" }], scope: "subsections (e) to (s)" }
  );
});

test("ignores new sections, uncodified provisions, and changes to other acts", () => {
  assert.equal(parseAmendmentClause("Sec. 2. (NEW) (Effective October 1, 2026) (a) As used in this section:"), null);
  assert.equal(parseAmendmentClause("Sec. 17. (Effective from passage) Notwithstanding the provisions of section 10-283 of the general statutes, the commissioner may"), null);
  assert.equal(parseAmendmentClause("Sec. 8. Section 140 of public act 25-168 is repealed and the following is substituted in lieu thereof (Effective from passage):"), null);
  assert.equal(parseAmendmentClause("Sec. 66. Sections 11 and 16 of public act 26-64 are repealed. (Effective from passage)"), null);
});

test("orders citations the way the statutes number them", () => {
  assert.ok(compareCitations("1-1z", "1-1aa") < 0);
  assert.ok(compareCitations("1-9", "1-10") < 0);
  assert.ok(compareCitations("42a-9-204", "42a-9-301") < 0);
  assert.equal(compareCitations("42a-9-204", "42a-10-105"), null);
  assert.equal(compareCitations("22-50", "22a-50"), null);
  assert.ok(citationInRange("42-103f", "42-103b", "42-103m"));
  assert.ok(!citationInRange("42-103n", "42-103b", "42-103m"));
  assert.ok(!citationInRange("42-103", "42-103b", "42-103m"));
});

function fixtureSession(year, blocks) {
  return {
    entry: { id: `${year}-regular`, year, name: `${year} Regular Session` },
    acts: [{ id: `pa-${year}-regular-7`, type: "public", number: 7, citation: `P.A. ${String(year).slice(-2)}-7` }, { id: `sa-${year}-regular-1`, type: "special", number: 1, citation: `S.A. ${String(year).slice(-2)}-1` }],
    texts: new Map([
      [`pa-${year}-regular-7`, {
        approved: "Approved May 1, 2026",
        sections: blocks.map((_, index) => ({ number: String(index + 1), anchor: `sec-${index + 1}`, effective: index === 0 ? "Effective from passage" : "Effective October 1, 2026" })),
        blocks: blocks.map((text, index) => ({ type: "p", page: 1, anchor: `sec-${index + 1}`, section: String(index + 1), runs: [text] }))
      }],
      [`sa-${year}-regular-1`, { sections: [], blocks: [{ type: "p", page: 1, anchor: "sec-1", section: "1", runs: ["Section 1. Section 1-1 of the general statutes is repealed."] }] }]
    ])
  };
}

test("indexes each act once and finds a section's pending changes", () => {
  const index = buildAmendmentIndex([fixtureSession(2026, [
    "Section 1. Section 1-1 of the general statutes is repealed and the following is substituted in lieu thereof (Effective from passage):",
    "Sec. 2. Sections 1-2 to 1-4, inclusive, of the general statutes are repealed. (Effective October 1, 2026)"
  ])], "2026-10-05T00:00:00Z");
  assert.deepEqual(index.counts, { acts: 1, citations: 1, ranges: 1, references: 2 });
  assert.deepEqual(index.acts["2026-regular/7"], { session: "2026-regular", year: 2026, number: 7, citation: "P.A. 26-7", approved: "May 1, 2026" });
  // Special Acts are never codified, so they are not indexed.
  assert.equal(index.citations["1-1"].length, 1);

  assert.deepEqual(amendmentsForSection(index, { citation: "1-1", citations: ["1-1"] }, { supplementEditionYear: 2026 }), [{
    session: "2026-regular", year: 2026, number: 7, citation: "P.A. 26-7", approved: "May 1, 2026",
    section: "1", action: "amended", scope: null, effective: "Effective from passage"
  }]);
  // A grouped section matches through any of its citations, and a range through its order.
  assert.equal(amendmentsForSection(index, { citation: null, citations: ["1-3", "1-3a"] })[0].action, "repealed");
  assert.deepEqual(amendmentsForSection(index, { citations: ["1-5"] }), []);
  // Once a supplement covers the session, its acts are already in the text.
  assert.deepEqual(amendmentsForSection(index, { citations: ["1-1"] }, { supplementEditionYear: 2027 }), []);
  assert.deepEqual(amendmentsForSection(null, { citations: ["1-1"] }), []);
});

test("the build derives the index from the published act texts", async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "cgs-amendments-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const index = await generateActAmendments({ actsDir: fileURLToPath(new URL("../public/data/acts/", import.meta.url)), outputDir: output });
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "amendments.json"), "utf8")), index);
  assert.ok(index.counts.citations > 1000);
  const redemption = amendmentsForSection(index, { citations: ["22a-245"] }, { supplementEditionYear: 2026 });
  assert.deepEqual(redemption.map(({ citation, section }) => `${citation} § ${section}`), ["P.A. 26-2 § 1", "P.A. 26-148 § 2"]);
  const empty = await generateActAmendments({ actsDir: path.join(output, "missing"), outputDir: output });
  assert.deepEqual(empty.counts, { acts: 0, citations: 0, ranges: 0, references: 0 });
});
