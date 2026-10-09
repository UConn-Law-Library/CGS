import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  chapterDiscoveryPath,
  generateDiscovery,
  titleDiscoveryPath
} from "../scripts/lib/discovery.mjs";

const title = {
  id: "title-01",
  number: "01",
  name: "General & Public Provisions",
  sourceUrl: "https://example.test/title_01.htm",
  chapters: [{
    id: "chapter-001",
    number: "001",
    name: "Construction of Statutes",
    path: "chapters/001.json",
    sourceUrl: "https://example.test/chap_001.htm",
    sectionCount: 1
  }]
};

const chapter = {
  id: "chapter-001",
  number: "001",
  name: "Construction of Statutes",
  sourceUrl: "https://example.test/chap_001.htm",
  sections: [{
    id: "section-1-1",
    citation: "1-1",
    citations: ["1-1"],
    heading: "Sec. 1-1. Words & phrases.",
    sourceUrl: "https://example.test/chap_001.htm#sec_1-1"
  }]
};

test("generates script-free discovery pages, sitemap, and robots metadata", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cgs-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, "data");
  const output = path.join(root, "dist");
  await mkdir(path.join(dataDirectory, "chapters"), { recursive: true });
  await writeFile(path.join(dataDirectory, "chapters", "001.json"), JSON.stringify(chapter), "utf8");

  const catalog = {
    counts: { titles: 1, chapters: 1, sections: 1 },
    titles: [title]
  };
  const summary = await generateDiscovery({
    catalog,
    dataDirectory,
    output,
    siteUrl: "https://example.test/CGS/"
  });

  assert.deepEqual(summary, { pages: 5, titles: 1, chapters: 1 });
  assert.equal(titleDiscoveryPath(title), "discover/titles/01/index.html");
  assert.equal(chapterDiscoveryPath(title, title.chapters[0]), "discover/titles/01/chapters/001/index.html");

  const index = await readFile(path.join(output, "discover", "index.html"), "utf8");
  const titlePage = await readFile(path.join(output, "discover", "titles", "01", "index.html"), "utf8");
  const chapterPage = await readFile(path.join(output, "discover", "titles", "01", "chapters", "001", "index.html"), "utf8");
  assert.match(index, /href="\.\/titles\/01\/"/);
  assert.match(titlePage, /General &amp; Public Provisions/);
  assert.match(chapterPage, /Sec\. 1-1\. Words &amp; phrases\./);
  assert.match(chapterPage, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/index\.html#\/t\/01\/c\/001\/s\/1-1/);
  assert.match(chapterPage, /https:\/\/example\.test\/chap_001\.htm#sec_1-1/);
  const guidePage = await readFile(path.join(output, "discover", "understanding-the-statutes", "index.html"), "utf8");
  assert.match(index, /href="\.\/understanding-the-statutes\/"/);
  assert.match(guidePage, /<h1>Understanding the Statutes<\/h1>/);
  // Every detail is open in the static copy, and its contents use in-page anchors.
  assert.doesNotMatch(guidePage, /\shidden[\s>]|<button\b|aria-pressed/);
  assert.match(guidePage, /href="#guide-cycle"/);
  assert.match(guidePage, /href="\.\.\/\.\.\/index\.html#\/guide"/);
  // Without supplement or acts data the page says so instead of claiming coverage.
  assert.match(guidePage, /No supplement is merged into the statute text\./);
  assert.match(guidePage, /No Public Acts are listed\./);
  assert.doesNotMatch(index + titlePage + chapterPage + guidePage, /<script\b/i);

  const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
  assert.equal((sitemap.match(/<url>/g) ?? []).length, 5);
  assert.match(sitemap, /https:\/\/example\.test\/CGS\/discover\/understanding-the-statutes\//);
  assert.match(sitemap, /https:\/\/example\.test\/CGS\/discover\/titles\/01\/chapters\/001\//);
  assert.equal(
    await readFile(path.join(output, "robots.txt"), "utf8"),
    "User-agent: *\nAllow: /\nSitemap: https://example.test/CGS/sitemap.xml\n"
  );
});
