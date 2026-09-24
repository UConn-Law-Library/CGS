import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderRepositoryMapMarkdown, repositoryLink, repositoryMapPage } from "../scripts/lib/repository-map-page.mjs";

const root = path.resolve(".");
const sourceFile = path.join(root, "docs", "repository-map.md");

test("renders the source Markdown with three diagram placeholders and working repository links", async () => {
  const source = await readFile(sourceFile, "utf8");
  const result = renderRepositoryMapMarkdown(source, { root, sourceFile });
  assert.equal(result.diagrams, 3);
  assert.match(result.html, /<h1 id="repository-map">Repository map<\/h1>/);
  assert.match(result.html, /<table>/);
  assert.match(result.html, /<ul>/);
  assert.match(result.html, /<code>/);
  assert.match(result.html, /<details class="diagram-source">/);
  assert.match(result.html, /github\.com\/UConn-Law-Library\/CGS\/tree\/main\/public\/data/);
  assert.match(result.html, /github\.com\/UConn-Law-Library\/CGS\/blob\/main\/ARCHITECTURE\.md/);
  assert.doesNotMatch(result.html, /href="\.\.\//);
  assert.match(repositoryMapPage(result.html, result.diagrams), /CGS Repository Map/);
});

test("escapes raw Markdown HTML and rejects unsafe or broken local links", () => {
  const result = renderRepositoryMapMarkdown('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))', { root, sourceFile });
  assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(result.html, /<img|href="javascript:/);
  assert.throws(() => repositoryLink("../../../../private.txt", { root, sourceFile }), /leaves the repository/);
  assert.throws(() => repositoryLink("missing-file.md", { root, sourceFile }), /does not exist/);
});
