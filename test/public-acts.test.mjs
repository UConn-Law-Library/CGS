import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, extractLegalReferences, renderLinkedText } from "../src/reader.js";

function actLinks(text) {
  return [...renderLinkedText(text).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map((match) => ({ href: match[1].replaceAll("&amp;", "&"), citation: match[2] }));
}

const lookup = (year, number) => `https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Public+Act&which_year=${year}&bill_num=${number}`;

test("links the public act reference in 4a-52a without confusing it with a statute", () => {
  const text = "The provisions of sections 4-212 to 4-219 , inclusive, and section 9 of public act 93-336* shall not apply.";
  assert.deepEqual(actLinks(text), [{ citation: "93-336", href: lookup(1993, 336) }]);
  assert.deepEqual(extractLegalReferences([text]), { sections: ["4-212", "4-219"], chapters: [] });
  const html = renderLinkedText(text, {
    sections: new Map([["4-212", "#/t/04/c/055a/s/4-212"], ["4-219", "#/t/04/c/055a/s/4-219"]])
  });
  assert.equal((html.match(/<a /g) ?? []).length, 3);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /title="Public Act 93-336 on the Connecticut General Assembly website \(opens in a new tab\)"/);
  assert.match(html, />93-336<\/a>\*/);
  assert.equal(html.replace(/<a\b[^>]*>([^<]*)<\/a>/g, "$1"), escapeHtml(text));
});

test("recognizes abbreviated source notes with omitted repeated P.A. labels", () => {
  assert.deepEqual(actLinks("(P.A. 88-192, S. 1, 2; P.A. 93-336, S. 5, 13; 93-435, S. 83, 95; P.A. 00-66, S. 27.)"), [
    { citation: "93-336", href: lookup(1993, 336) },
    { citation: "93-435", href: lookup(1993, 435) },
    { citation: "00-66", href: lookup(2000, 66) }
  ]);
  assert.deepEqual(actLinks("History: P.A. 93-336 effective June 29, 1993; P.A. 93-435 amended Subsec. (a)."), [
    { citation: "93-336", href: lookup(1993, 336) },
    { citation: "93-435", href: lookup(1993, 435) }
  ]);
});

test("handles Public Act lists, ranges, casing, and optional No. labels", () => {
  assert.deepEqual(actLinks("Public Acts Nos. 91-256, 93-336 and 93-435; PUBLIC ACT NO. 00-066; P. A. 21-75 to 21-76."), [
    { citation: "91-256", href: lookup(1991, 256) },
    { citation: "93-336", href: lookup(1993, 336) },
    { citation: "93-435", href: lookup(1993, 435) },
    { citation: "00-066", href: lookup(2000, 66) },
    { citation: "21-75", href: lookup(2021, 75) },
    { citation: "21-76", href: lookup(2021, 76) }
  ]);
});

test("uses the session-disambiguating CGA lookup for special-session references", () => {
  for (const text of ["June Sp. Sess. P.A. 15-5", "public act 15-5 of the June special session"]) {
    assert.deepEqual(actLinks(text), [{ citation: "15-5", href: lookup(2015, 5) }]);
    assert.equal(renderLinkedText(text).replace(/<a\b[^>]*>([^<]*)<\/a>/g, "$1"), text);
  }
});

test("limits links to supported years and valid act numbers", () => {
  assert.deepEqual(actLinks("P.A. 73-1; 90-91; 91-1; 99-1; 00-1; 26-1; 93-0."), [
    { citation: "91-1", href: lookup(1991, 1) },
    { citation: "99-1", href: lookup(1999, 1) },
    { citation: "00-1", href: lookup(2000, 1) },
    { citation: "26-1", href: lookup(2026, 1) }
  ]);
  const future = `P.A. ${String((new Date().getFullYear() + 1) % 100).padStart(2, "0")}-1`;
  assert.equal(renderLinkedText(future), future);
});

test("does not link special acts, bare numbers, malformed citations, or unrelated prose", () => {
  for (const text of [
    "special act 93-336; S.A. 93-336; section 93-336; 93-336",
    "P.A. 93-336a; public act 93-336-1; P.A. 1993-336",
    "P.A. 88-192 <unsafe> & public act 90-91"
  ]) {
    assert.equal(renderLinkedText(text), escapeHtml(text));
  }
  const text = 'Public act\n93-336 applies to sections 4-212 and 4-219; other text mentions 93-435. <unsafe> & "quoted"';
  assert.deepEqual(actLinks(text), [{ citation: "93-336", href: lookup(1993, 336) }]);
  assert.equal(renderLinkedText(text).replace(/<a\b[^>]*>([^<]*)<\/a>/g, "$1"), escapeHtml(text));
});
