import assert from "node:assert/strict";
import test from "node:test";

import {
  renderSearchExcerpt,
  renderSearchHighlight,
  searchHighlightTerms
} from "../src/search-highlight.js";

test("highlights positive Boolean terms and excludes negated terms", () => {
  const terms = searchHighlightTerms('"Effective January" OR ballots NOT repealed');
  assert.deepEqual(terms, ["effective january", "ballots"]);
  assert.equal(
    renderSearchHighlight("Effective January ballots repealed", terms),
    "<mark>Effective January</mark> <mark>ballots</mark> repealed"
  );
});

test("search highlights escape untrusted result text", () => {
  assert.equal(
    renderSearchHighlight("<script>Effective January</script>", ["effective january"]),
    "&lt;script&gt;<mark>Effective January</mark>&lt;/script&gt;"
  );
});

test("excerpts center the first match and mark it", () => {
  const text = `${"Earlier material ".repeat(12)}Effective January 1, 2027, this section changes. ${"Later material ".repeat(12)}`;
  const excerpt = renderSearchExcerpt(text, ["effective january"], { length: 120, context: 30 });
  assert.match(excerpt, /^…/);
  assert.match(excerpt, /<mark>Effective January<\/mark>/);
  assert.match(excerpt, /…$/);
});
