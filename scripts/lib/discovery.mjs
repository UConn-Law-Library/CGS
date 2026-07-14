import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { routeHref, sectionRouteKey } from "../../src/routes.js";

const discoveryRoot = "discover/index.html";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

export function titleDiscoveryPath(title) {
  return `discover/titles/${encodeURIComponent(title.number)}/index.html`;
}

export function chapterDiscoveryPath(title, chapter) {
  return `discover/titles/${encodeURIComponent(title.number)}/chapters/${encodeURIComponent(chapter.number)}/index.html`;
}

function label(prefix, number) {
  return `${prefix} ${String(number).replace(/^0+(?=\d)/, "")}`;
}

function relativeFile(fromFile, toFile) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function relativeDirectory(fromFile, toIndex) {
  const relative = relativeFile(fromFile, toIndex).replace(/index\.html$/, "");
  return relative || "./";
}

function publicPath(file) {
  return file === "index.html" ? "" : file.replace(/index\.html$/, "");
}

function page({ file, title, description, siteUrl, breadcrumbs = [], body }) {
  const home = relativeFile(file, "index.html");
  const browse = relativeDirectory(file, discoveryRoot);
  const stylesheet = relativeFile(file, "styles.css");
  const canonical = new URL(publicPath(file), siteUrl).href;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="stylesheet" href="${escapeHtml(stylesheet)}">
  <title>${escapeHtml(title)} · Connecticut General Statutes</title>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="${escapeHtml(home)}">Connecticut General Statutes</a>
    <nav aria-label="Primary"><a href="${escapeHtml(browse)}">Static index</a> <a href="${escapeHtml(home)}#/">Interactive reader</a></nav>
  </header>
  <main class="discovery-page" id="main-content">
    ${breadcrumbs.length ? `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${breadcrumbs.map((item) => `<li>${item.href ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` : `<span aria-current="page">${escapeHtml(item.label)}</span>`}</li>`).join("")}</ol></nav>` : ""}
    ${body}
  </main>
  <footer>Unofficial access copy. Verify legal text with the Connecticut General Assembly.</footer>
</body>
</html>
`;
}

function renderDiscoveryIndex(catalog, siteUrl) {
  const file = discoveryRoot;
  return page({
    file,
    title: "Browse titles",
    description: "Static title and chapter index for the Connecticut General Statutes.",
    siteUrl,
    body: `<header class="discovery-intro"><p class="eyebrow">Static index</p><h1>Browse Connecticut General Statutes</h1><p>This index works without JavaScript and links to every title and chapter.</p></header>
    <section class="catalog" aria-labelledby="titles-heading"><div class="section-heading"><div><p class="eyebrow">${catalog.counts.chapters.toLocaleString("en-US")} chapters</p><h2 id="titles-heading">Titles</h2></div><p>${catalog.counts.sections.toLocaleString("en-US")} provisions</p></div>
    <div class="title-grid">${catalog.titles.map((title) => `<a class="title-card" href="${escapeHtml(relativeDirectory(file, titleDiscoveryPath(title)))}"><p>${escapeHtml(label("Title", title.number))}</p><h3>${escapeHtml(title.name)}</h3><span>${title.chapters.length} chapter${title.chapters.length === 1 ? "" : "s"}</span></a>`).join("")}</div></section>`
  });
}

function renderTitlePage(title, siteUrl) {
  const file = titleDiscoveryPath(title);
  const titleName = label("Title", title.number);
  return page({
    file,
    title: `${titleName} — ${title.name}`,
    description: `${titleName}, ${title.name}: static chapter index.`,
    siteUrl,
    breadcrumbs: [
      { label: "Titles", href: relativeDirectory(file, discoveryRoot) },
      { label: titleName }
    ],
    body: `<header class="discovery-intro"><p class="eyebrow">${title.chapters.length} chapters</p><h1>${escapeHtml(titleName)} — ${escapeHtml(title.name)}</h1><p><a href="${escapeHtml(title.sourceUrl)}">Official title source</a></p></header>
    <ol class="chapter-list">${title.chapters.map((chapter) => `<li><a href="${escapeHtml(relativeDirectory(file, chapterDiscoveryPath(title, chapter)))}"><strong>${escapeHtml(label("Chapter", chapter.number))}</strong><span>${escapeHtml(chapter.name)}</span><small>${chapter.sectionCount} provision${chapter.sectionCount === 1 ? "" : "s"}</small></a></li>`).join("")}</ol>`
  });
}

function renderChapterPage(title, chapter, siteUrl) {
  const file = chapterDiscoveryPath(title, chapter);
  const titleName = label("Title", title.number);
  const chapterName = label("Chapter", chapter.number);
  const home = relativeFile(file, "index.html");
  return page({
    file,
    title: `${chapterName} — ${chapter.name}`,
    description: `${chapterName}, ${chapter.name}: static section index for ${titleName}.`,
    siteUrl,
    breadcrumbs: [
      { label: "Titles", href: relativeDirectory(file, discoveryRoot) },
      { label: titleName, href: relativeDirectory(file, titleDiscoveryPath(title)) },
      { label: chapterName }
    ],
    body: `<header class="discovery-intro"><p class="eyebrow">${chapter.sections.length} provisions</p><h1>${escapeHtml(chapterName)} — ${escapeHtml(chapter.name)}</h1><p>${escapeHtml(titleName)} — ${escapeHtml(title.name)}</p><p><a href="${escapeHtml(chapter.sourceUrl)}">Official chapter source</a></p></header>
    <ol class="section-index">${chapter.sections.map((section) => {
      const reader = `${home}${routeHref({ title: title.number, chapter: chapter.number, section: sectionRouteKey(section) })}`;
      return `<li><h2>${escapeHtml(section.heading)}</h2><p><a href="${escapeHtml(reader)}">Open in the interactive reader</a> <a href="${escapeHtml(section.sourceUrl)}">Official text</a></p></li>`;
    }).join("")}</ol>`
  });
}

async function write(output, file, content) {
  const target = path.join(output, ...file.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export async function generateDiscovery({ catalog, dataDirectory, output, siteUrl }) {
  const normalizedSiteUrl = new URL(siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`);
  const pages = ["index.html", discoveryRoot];
  await write(output, discoveryRoot, renderDiscoveryIndex(catalog, normalizedSiteUrl));

  for (const title of catalog.titles) {
    const titleFile = titleDiscoveryPath(title);
    pages.push(titleFile);
    await write(output, titleFile, renderTitlePage(title, normalizedSiteUrl));
    await Promise.all(title.chapters.map(async (chapterMeta) => {
      const chapter = JSON.parse(await readFile(path.join(dataDirectory, ...chapterMeta.path.split("/")), "utf8"));
      const chapterFile = chapterDiscoveryPath(title, chapterMeta);
      pages.push(chapterFile);
      await write(output, chapterFile, renderChapterPage(title, chapter, normalizedSiteUrl));
    }));
  }

  pages.sort();
  const urls = pages.map((file) => new URL(publicPath(file), normalizedSiteUrl).href);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
  await write(output, "sitemap.xml", sitemap);
  await write(output, "robots.txt", `User-agent: *\nAllow: /\nSitemap: ${new URL("sitemap.xml", normalizedSiteUrl).href}\n`);
  return { pages: pages.length, titles: catalog.titles.length, chapters: pages.length - catalog.titles.length - 2 };
}
