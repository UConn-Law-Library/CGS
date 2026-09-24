import { statSync } from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";

export const REPOSITORY_URL = "https://github.com/UConn-Law-Library/CGS";
export const REPOSITORY_MAP_SOURCE_URL = `${REPOSITORY_URL}/blob/main/docs/repository-map.md`;

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function repositoryLink(href, { root, sourceFile }) {
  if (href.startsWith("#")) return href;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) {
    throw new Error(`Unsupported repository map link: ${href}`);
  }

  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : href.slice(hashIndex);
  if (pathPart.startsWith("/") || pathPart.includes("?")) throw new Error(`Unsupported repository map link: ${href}`);
  const target = path.resolve(path.dirname(sourceFile), decodeURIComponent(pathPart || "."));
  if (!within(root, target)) throw new Error(`Repository map link leaves the repository: ${href}`);
  const info = statSync(target, { throwIfNoEntry: false });
  if (!info) throw new Error(`Repository map link does not exist: ${href}`);
  const relative = path.relative(root, target).split(path.sep).map(encodeURIComponent).join("/");
  const kind = info.isDirectory() ? "tree" : "blob";
  return `${REPOSITORY_URL}/${kind}/main/${relative}${fragment}`;
}

export function renderRepositoryMapMarkdown(source, { root, sourceFile }) {
  const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
  let diagramNumber = 0;
  const slugs = new Map();

  markdown.core.ruler.push("heading_ids", (state) => {
    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token.type !== "heading_open") continue;
      const label = state.tokens[index + 1]?.content ?? "section";
      const base = label.toLowerCase().normalize("NFKD").replace(/[^\p{Letter}\p{Number}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
      const count = slugs.get(base) ?? 0;
      slugs.set(base, count + 1);
      token.attrSet("id", count ? `${base}-${count}` : base);
    }
  });

  const originalLinkOpen = markdown.renderer.rules.link_open
    ?? ((tokens, index, options, _env, renderer) => renderer.renderToken(tokens, index, options));
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    token.attrSet("href", repositoryLink(token.attrGet("href"), { root, sourceFile }));
    if (!token.attrGet("href").startsWith("#")) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }
    return originalLinkOpen(tokens, index, options, env, renderer);
  };

  markdown.renderer.rules.table_open = () => '<div class="table-scroll" role="region" aria-label="Repository table" tabindex="0"><table>\n';
  markdown.renderer.rules.table_close = () => '</table></div>\n';
  markdown.renderer.rules.fence = (tokens, index, options, _env, renderer) => {
    const token = tokens[index];
    if (token.info.trim().split(/\s+/, 1)[0].toLowerCase() !== "mermaid") {
      return `<pre><code>${markdown.utils.escapeHtml(token.content)}</code></pre>\n`;
    }
    diagramNumber += 1;
    const label = `Repository map diagram ${diagramNumber}`;
    const code = markdown.utils.escapeHtml(token.content);
    return `<section class="diagram" aria-label="${label}">\n`
      + `<p class="diagram-status" role="status">Rendering diagram ${diagramNumber}…</p>\n`
      + `<div class="diagram-viewport" role="img" aria-label="${label}"></div>\n`
      + `<details class="diagram-source"><summary>View Mermaid source</summary><pre><code>${code}</code></pre></details>\n`
      + `</section>\n`;
  };

  return { html: markdown.render(source), diagrams: diagramNumber };
}

export function repositoryMapPage(content, diagrams) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Source, browser, build, and deployment map for the CGS repository.">
  <meta name="theme-color" content="#071e38">
  <title>CGS Repository Map</title>
  <link rel="stylesheet" href="./styles.css">
  <script type="module" src="./map.js"></script>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to repository map</a>
  <header class="page-header">
    <strong>CGS Repository Map</strong>
    <a href="${REPOSITORY_MAP_SOURCE_URL}" target="_blank" rel="noopener noreferrer">View Markdown on GitHub</a>
  </header>
  <main id="main-content" class="content">
${content}
  </main>
  <footer class="page-footer">Generated from <a href="${REPOSITORY_MAP_SOURCE_URL}" target="_blank" rel="noopener noreferrer">docs/repository-map.md</a> at build time.</footer>
  <noscript><p class="no-script">JavaScript is needed to draw the ${diagrams} Mermaid diagrams. Their source is available in each diagram's disclosure and on GitHub.</p></noscript>
</body>
</html>
`;
}
