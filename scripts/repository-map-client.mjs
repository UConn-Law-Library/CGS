import mermaid from "mermaid";
import DOMPurify from "dompurify";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  theme: "base",
  themeVariables: {
    fontFamily: "Atkinson Hyperlegible, Arial, sans-serif",
    primaryColor: "#eef4fb",
    primaryBorderColor: "#52789f",
    primaryTextColor: "#172538",
    lineColor: "#66788b",
    clusterBkg: "#f1f3f5",
    clusterBorder: "#aab5c1"
  },
  flowchart: { htmlLabels: false, useMaxWidth: false, wrappingWidth: 200, minNodeWidth: 160 }
});

await document.fonts.ready;
const diagrams = document.querySelectorAll(".diagram");
for (const [index, diagram] of diagrams.entries()) {
  const source = diagram.querySelector(".diagram-source code").textContent;
  const status = diagram.querySelector(".diagram-status");
  const viewport = diagram.querySelector(".diagram-viewport");
  try {
    const { svg, bindFunctions } = await mermaid.render(`repository-map-${index + 1}`, source);
    const safeSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { html: true, svg: true, svgFilters: true } });
    const template = document.createElement("template");
    template.innerHTML = safeSvg;
    const drawing = template.content.querySelector("svg");
    if (!drawing) throw new Error("Mermaid did not produce an SVG");
    const width = drawing.viewBox?.baseVal?.width;
    if (width > 0) drawing.style.width = `${Math.ceil(width)}px`;
    drawing.style.maxWidth = "none";
    drawing.style.height = "auto";
    viewport.replaceChildren(drawing);
    bindFunctions?.(viewport);
    status.hidden = true;
    diagram.classList.add("diagram-ready");
  } catch (error) {
    console.error(`Could not render repository map diagram ${index + 1}`, error);
    status.textContent = `Diagram ${index + 1} could not render. View its Mermaid source below.`;
    diagram.classList.add("diagram-error");
  }
}
