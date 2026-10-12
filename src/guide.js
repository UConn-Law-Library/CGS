// "Understanding the Statutes": how a bill becomes law, how Public Acts reach the General
// Statutes, the publication cycle, and what this app's data covers. renderGuide() returns markup
// only, so the build can also publish it as a static page; mountGuide() adds the interactions.
// Every year and "published" claim comes from publications.js, and every coverage claim from
// the app's own manifests.
import { escapeHtml } from "./reader.js";
import { actsRouteHref, guideRouteHref, routeHref } from "./routes.js";
import {
  PUBLISHED_EDITIONS,
  editionLabel,
  exampleCycle,
  publicationCycle,
  publicationForYear,
  regularSessionMonth,
  statuteTextEdition
} from "./publications.js";

const short = (year) => String(year).slice(-2);
const external = (href, label) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}<span class="visually-hidden"> (opens in a new tab)</span> <span aria-hidden="true">↗</span></a>`;

export const GUIDE_PARTS = Object.freeze([
  { id: "sources", label: "Where laws come from" },
  { id: "process", label: "How a bill becomes a law" },
  { id: "cycle", label: "The publication cycle" },
  { id: "public-acts", label: "What is a Public Act?" },
  { id: "effective", label: "When a law takes effect" },
  { id: "coverage", label: "What this app includes" },
  { id: "research", label: "Researching a statute" },
  { id: "official", label: "Official sources" }
]);

export const OFFICIAL_LINKS = Object.freeze({
  generalAssembly: "https://www.cga.ct.gov/",
  lcoServices: "https://www.cga.ct.gov/lco/about-services.asp",
  aboutBills: "https://www.cga.ct.gov/lco/resources-aboutbills.asp",
  enactment: "https://www.cga.ct.gov/asp/content/eob.asp",
  billFlowchart: "https://www.cga.ct.gov/html/bill.pdf",
  actsThisSession: "https://www.cga.ct.gov/asp/CGATodayFileCopies/CGAAllPA.asp",
  actsByNumber: "https://www.cga.ct.gov/lco/statutes-actsno.asp",
  actsSearch: "https://search.cga.state.ct.us/r/adv/dtsearch_form.asp",
  conversionTables: "https://www.cga.ct.gov/lco/statutes-conversion.asp",
  referenceTables: "https://www.cga.ct.gov/lco/statutes-actsref.asp",
  effectiveDates: "https://www.cga.ct.gov/asp/content/aeauto.asp",
  statutesAndActs: "https://www.cga.ct.gov/lco/statutes.asp"
});

// The default effective date of Public Acts, in this app's own copy of the statutes.
const SECTION_2_32 = routeHref({ title: "2", chapter: "016", section: "2-32" });

export const LEGISLATIVE_STAGES = Object.freeze([
  {
    id: "introduced",
    title: "Bill introduced",
    summary: "A legislator or a committee proposes legislation.",
    detail: `<p>Members file proposed bills, and the House or Senate clerk gives each one a number, such as H.B. 5001 or S.B. 1. Legislative committees can also raise bills of their own.</p>
      <p>In even-numbered years the session is shorter, and bills from individual members are limited to fiscal matters; committees may still raise bills on any topic.</p>`
  },
  {
    id: "committee",
    title: "Committee consideration",
    summary: "A committee holds a public hearing and votes.",
    detail: `<p>The bill goes to a joint standing committee, made up of members of both chambers. The committee usually holds a public hearing, may rewrite the bill as a substitute, and votes on whether to report it favorably.</p>
      <p>A legislative commissioner from the Legislative Commissioners' Office (LCO) reviews a favorably reported bill before it goes to the floor.</p>`
  },
  {
    id: "votes",
    title: "Debate and votes",
    summary: "The House and Senate must pass the same text.",
    event: "passage",
    detail: `<p>Each chamber debates the bill, may amend it, and votes. If the second chamber amends it, the first must agree to the change, or a conference committee may try to settle the differences.</p>
      <p><strong>Passage</strong> happens only when both chambers have approved identical text. A bill that does not pass both chambers before the session adjourns does not become law.</p>`
  },
  {
    id: "designation",
    title: "Public Act number",
    summary: "LCO assigns an act number to the passed bill.",
    detail: `<p>LCO engrosses the final text, designates the bill a Public Act or a Special Act, and assigns its act number. The chamber clerks then send it to the Secretary of the State, who presents it to the Governor.</p>`
  },
  {
    id: "governor",
    title: "Governor's action",
    summary: "The Governor signs or vetoes it, or it becomes law without a signature.",
    event: "enactment",
    detail: `<p>While the legislature is in session, the Governor has five days (not counting Sundays and legal holidays) to sign or veto a bill. After the session adjourns, the Governor has fifteen days after the bill is presented.</p>
      <p>A bill the Governor does not veto within that time becomes law without a signature. A veto can be overridden by at least two-thirds of the members of each chamber, often at a veto session. This is <strong>enactment</strong>: the bill has become law.</p>`
  },
  {
    id: "effective",
    title: "Law takes effect",
    summary: "Each section becomes operative on its effective date.",
    event: "effective",
    detail: `<p>An act states when each section takes effect. Unless an act says otherwise, a Public Act takes effect on October 1 after the session that passed it (<a href="${SECTION_2_32}">Sec. 2-32</a>). Many sections say "Effective from passage" or name another date, so one act can take effect in stages.</p>`
  },
  {
    id: "codified",
    title: "Codification and publication",
    summary: "LCO folds the changes into the next published statutes.",
    event: "codification",
    detail: `<p>LCO codifies the act's permanent provisions into the General Statutes: amended sections are rewritten, new sections receive statute numbers, and repealed sections are marked. The changes appear in the next Supplement or full revision.</p>
      <p>Codification does not make a law effective. A section can be in force for months before its language appears in the published statutes, and some provisions are never codified at all.</p>`
  }
]);

const EVENTS = Object.freeze({
  passage: { label: "Passage", text: "Both chambers approve the same text." },
  enactment: { label: "Enactment", text: "The bill becomes law: signed, not vetoed in time, or passed over a veto." },
  effective: { label: "Effective date", text: "A section becomes operative. Sections of one act can differ." },
  codification: { label: "Codification", text: "The language appears in a published edition of the statutes." }
});

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

const count = (value) => Number(value ?? 0).toLocaleString("en-US");

// What the app's published data contains, from the same manifests the reader uses. The base
// corpus is CGA's current edition, and its catalog records the year it is revised to; when a
// supplement is merged, its manifest is bound to that base. Legislation is covered through the
// year before the newer of the two. Pass undefined for a source that could not be loaded: it is
// reported as unknown, never absent.
export function describeCoverage({ catalog = null, supplement, acts } = {}) {
  const supplementYear = supplement?.edition?.editionYear ?? supplement?.manifest?.editionYear ?? null;
  const baseYear = catalog?.source?.revisionYear ?? null;
  const textEdition = statuteTextEdition({ baseRevisionYear: baseYear, supplementYear });
  const covered = textEdition?.legislationThrough ?? null;
  const sessions = acts?.sessions ?? [];
  return {
    base: catalog ? {
      year: baseYear,
      label: baseYear ? `${baseYear} General Statutes` : "General Statutes",
      capturedAt: formatDate(catalog.source?.retrievedAt ?? catalog.generatedAt),
      sections: catalog.counts?.sections ?? null,
      url: catalog.source?.url ?? null
    } : null,
    supplement: supplement === undefined ? undefined : supplementYear ? {
      year: supplementYear,
      label: `${supplementYear} Supplement`,
      capturedAt: formatDate(supplement.manifest?.source?.retrievedAt ?? supplement.manifest?.generatedAt),
      sections: supplement.manifest?.counts?.sections ?? null,
      replacements: supplement.manifest?.counts?.replacements ?? null,
      additions: supplement.manifest?.counts?.additions ?? null
    } : null,
    acts: acts === undefined ? undefined : acts ? {
      updatedAt: formatDate(acts.generatedAt),
      sessions: sessions.map((session) => ({
        id: session.id,
        year: session.year,
        name: session.name,
        acts: session.counts?.acts ?? 0,
        publicActs: session.counts?.publicActs ?? 0,
        specialActs: session.counts?.specialActs ?? 0
      })),
      // Legislation the statute text covers, but whose acts the app does not list.
      unlistedCoveredYear: covered !== null && !sessions.some((session) => session.year === covered) ? covered : null,
      coveredBy: textEdition?.label ?? null
    } : null
  };
}

function sectionHeading(part, eyebrow, title) {
  return `<div class="guide-section-heading"><p class="eyebrow">${eyebrow}</p><h2 id="guide-${part}-heading" tabindex="-1">${title}</h2></div>`;
}

function guideSection(part, eyebrow, title, body) {
  return `<section class="guide-section" id="guide-${part}" aria-labelledby="guide-${part}-heading">${sectionHeading(part, eyebrow, title)}${body}</section>`;
}

// Interactive controls are buttons in the app; the static copy shows the same content
// without them, with every detail panel open.
function choice({ interactive, className, controls, pressed, data, content, label = null }) {
  if (!interactive) return `<div class="${className}">${content}</div>`;
  return `<button type="button" class="${className}" aria-pressed="${pressed}" aria-controls="${controls}" ${data}${label ? ` aria-label="${escapeHtml(label)}"` : ""}>${content}</button>`;
}

function renderSources({ example }) {
  const { revisionYear, supplementYear, nextRevisionYear } = example;
  return guideSection("sources", "Introduction", "Where do Connecticut’s laws come from?", `
    <div class="guide-prose">
      <p>The General Statutes are reprinted on a regular cycle, not every time a law changes. A newly enacted law can therefore take effect before its language appears in the published General Statutes. Researchers work with three kinds of source:</p>
    </div>
    <figure class="guide-source-flow">
      <ol>
        <li class="guide-source guide-source-acts">
          <span class="guide-source-kind">Newest</span>
          <h3>Public Acts</h3>
          <p>Newly enacted legislation, available soon after enactment. Acts can change the law before the statutes are republished.</p>
        </li>
        <li class="guide-source-arrow" aria-hidden="true"><span>codified into</span></li>
        <li class="guide-source guide-source-supplement">
          <span class="guide-source-kind">Even-numbered years</span>
          <h3>Supplements</h3>
          <p>Updated, added, and repealed sections since the last full revision. A supplement is read together with that revision.</p>
        </li>
        <li class="guide-source-arrow" aria-hidden="true"><span>consolidated into</span></li>
        <li class="guide-source guide-source-revision">
          <span class="guide-source-kind">Odd-numbered years</span>
          <h3>General Statutes</h3>
          <p>The complete codified collection, organized by title, chapter, and section.</p>
        </li>
      </ol>
      <figcaption>Acts from the ${revisionYear} sessions appear in the ${supplementYear} Supplement, then in the ${nextRevisionYear} General Statutes. Acts from an even-year session, such as ${supplementYear}, go straight into the next full revision.</figcaption>
    </figure>`);
}

function renderProcess({ interactive }) {
  const selected = 0;
  const stages = LEGISLATIVE_STAGES.map((stage, index) => {
    const event = stage.event ? `<span class="guide-event-tag guide-event-${stage.event}">${EVENTS[stage.event].label}</span>` : "";
    return `<li class="guide-stage" data-guide-stage-item="${index}">${choice({
      interactive,
      className: "guide-stage-button",
      controls: "guide-stage-panel",
      pressed: index === selected,
      data: `data-guide-stage="${index}"`,
      content: `<span class="guide-stage-number" aria-hidden="true">${index + 1}</span><span class="guide-stage-text"><strong>${stage.title}</strong><small>${stage.summary}</small>${event}</span>`
    })}</li>`;
  }).join("");
  const details = LEGISLATIVE_STAGES.map((stage, index) => `<div class="guide-stage-detail" data-guide-stage-detail="${index}"${interactive && index !== selected ? " hidden" : ""}>
      <h3>Step ${index + 1}: ${stage.title}</h3>${stage.detail}</div>`).join("");
  return guideSection("process", "The legislative process", "How a bill becomes a law", `
    <div class="guide-prose"><p>A bill becomes law through a series of separate events. ${interactive ? "Select a step to read more about it." : ""}</p></div>
    <div class="guide-flow" data-guide-flow>
      <ol class="guide-stages" data-guide-stages>${stages}</ol>
      <div class="guide-stage-panel" id="guide-stage-panel"${interactive ? ' aria-live="polite"' : ""} data-guide-stage-panel>${details}</div>
    </div>
    <div class="guide-events">
      <h3>Four events that are easy to confuse</h3>
      <dl>${Object.entries(EVENTS).map(([id, event]) => `<div class="guide-event guide-event-${id}"><dt>${event.label}</dt><dd>${event.text}</dd></div>`).join("")}</dl>
    </div>
    <div class="guide-notes">
      <p><strong>Most bills never become law.</strong> A bill that fails in committee or does not pass both chambers in the same form before adjournment ends there.</p>
      <p><strong>Not every enacted provision is codified.</strong> Temporary provisions, one-time directions, and Special Acts remain law in the act itself without appearing in the General Statutes.</p>
    </div>`);
}

function editionRelationship(publication) {
  if (publication.type === "revision") {
    return `Replaces the ${editionLabel(publication.year - 2)} and the ${editionLabel(publication.year - 1)} with one complete text that includes changes from the ${publication.year - 2} and ${publication.year - 1} sessions.`;
  }
  return `Read together with the ${editionLabel(publication.year - 1)}. It contains only the sections changed, added, or repealed in the ${publication.year - 1} sessions, so it does not replace that edition.`;
}

function yearDetail(publication, coverage) {
  const revision = publication.type === "revision";
  const status = publication.status === "published"
    ? `Published. ${external(publication.url, `Open the ${publication.label}`)}`
    : publication.status === "anticipated"
      ? "Not yet published. This entry follows the usual cycle and does not predict a release date."
      : null;
  const inApp = coverage?.base?.year === publication.year
    ? "This app’s statute text starts from this edition."
    : coverage?.supplement?.year === publication.year
      ? "This app merges this supplement into its statute text."
      : null;
  const legislation = revision
    ? `All codified legislation through the end of ${publication.legislationThrough}. New since the last revision: the ${publication.newSessionYears.join(" and ")} sessions.`
    : `Changes from the ${publication.newSessionYears[0]} sessions, which can include amendments that take effect later.`;
  return `<h3>${publication.label}${publication.status === "anticipated" ? " <span class=\"guide-status guide-status-anticipated\">Anticipated</span>" : ""}</h3>
    <dl class="guide-facts">
      <div><dt>Publication</dt><dd>${revision ? "Full revision: the complete General Statutes" : "Supplement to the General Statutes"}</dd></div>
      <div><dt>Revised to</dt><dd><time datetime="${publication.revisedTo}">${publication.revisedToLabel}</time>, the cutoff for legislative content, not the release date</dd></div>
      <div><dt>Legislation included</dt><dd>${legislation}</dd></div>
      <div><dt>Relationship</dt><dd>${editionRelationship(publication)}</dd></div>
      ${status ? `<div><dt>Status</dt><dd>${status}</dd></div>` : ""}
      ${inApp ? `<div><dt>In this app</dt><dd>${inApp}</dd></div>` : ""}
    </dl>`;
}

function renderCycle({ interactive, coverage }) {
  const years = publicationCycle();
  const selectedYear = Math.max(...PUBLISHED_EDITIONS.map((edition) => edition.year));
  const items = years.map((publication) => {
    const revision = publication.type === "revision";
    const status = publication.status === "anticipated" ? "Anticipated" : publication.status === "published" ? "Published" : "";
    const content = `<span class="guide-edition-kind"><span aria-hidden="true">${revision ? "▮" : "▯"}</span> ${publication.kindLabel}</span>
      <strong>${publication.label}</strong>
      <span class="guide-edition-meta">Revised to ${publication.revisedToLabel}</span>
      <span class="guide-edition-meta">${revision ? `Adds ${publication.newSessionYears.join(" + ")} sessions` : `Adds ${publication.newSessionYears[0]} sessions`}</span>
      ${status ? `<span class="guide-status guide-status-${publication.status}">${status}</span>` : ""}`;
    return `<li class="guide-year guide-year-${publication.type}${publication.status ? ` guide-year-${publication.status}` : ""}">
      <span class="guide-year-label" aria-hidden="true">${publication.year}</span>
      <p class="guide-session"><span class="visually-hidden">${publication.year}: </span>${regularSessionMonth(publication.year)} ${publication.year} session<small>Public Acts ${short(publication.year)}-1, ${short(publication.year)}-2…</small></p>
      <span class="guide-year-connector" aria-hidden="true"><svg viewBox="0 0 100 40" preserveAspectRatio="none" focusable="false"><path d="M-50 0 L50 40" vector-effect="non-scaling-stroke"/></svg></span>
      ${choice({
        interactive,
        className: "guide-edition",
        controls: "guide-year-panel",
        pressed: publication.year === selectedYear,
        data: `data-guide-year="${publication.year}"`,
        content
      })}
      ${revision ? `<span class="guide-cycle-bracket" aria-hidden="true">${publication.year}–${publication.year + 1} cycle</span>` : ""}
    </li>`;
  }).join("");
  const details = years.map((publication) => `<div class="guide-year-detail" data-guide-year-detail="${publication.year}"${interactive && publication.year !== selectedYear ? " hidden" : ""}>${yearDetail(publication, coverage)}</div>`).join("");
  return guideSection("cycle", "Central concept", "The statutes publication cycle", `
    <div class="guide-prose">
      <p>The Legislative Commissioners’ Office publishes a complete revision of the General Statutes in odd-numbered years and a Supplement in even-numbered years. Each edition is “revised to January 1” of its year: it reflects legislation through the end of the previous year.</p>
    </div>
    <ul class="guide-rules">
      <li><strong>Odd years: full revision.</strong> A complete, consolidated text.</li>
      <li><strong>Even years: Supplement.</strong> Only the sections that changed, read with the prior revision.</li>
      <li><strong>Public Acts throughout.</strong> Acts are available after enactment, long before codification.</li>
      <li><strong>“Revised to” is a cutoff.</strong> It marks the legislation included, not the day the edition went online.</li>
      <li><strong>Later effective dates appear inside editions.</strong> When an amendment takes effect after the revision date, the edition prints the current text and the amended version with its effective date.</li>
    </ul>
    <figure class="guide-timeline">
      <figcaption class="guide-timeline-caption">${interactive ? "Select an edition to see what it contains and how it relates to the one before it." : "Each edition and the sessions it draws on."} Each session’s Public Acts flow into the following year’s edition.</figcaption>
      <div class="guide-timeline-legend" aria-hidden="true"><span class="guide-legend-revision">▮ Full revision (odd years)</span><span class="guide-legend-supplement">▯ Supplement (even years)</span><span class="guide-legend-anticipated">Dashed: anticipated</span></div>
      <div class="guide-timeline-scroll"><ol class="guide-years">${items}</ol></div>
      <div class="guide-year-panel" id="guide-year-panel"${interactive ? ' aria-live="polite"' : ""} data-guide-year-panel>${details}</div>
    </figure>`);
}

function renderPublicActs({ example, appBase }) {
  const { revisionYear, supplementYear, nextRevisionYear } = example;
  const actName = `Public Act ${short(supplementYear)}-XXX`;
  return guideSection("public-acts", "Enacted legislation", "What is a Public Act?", `
    <div class="guide-prose">
      <p>A Public Act is a bill that passed both chambers, was designated a Public Act, and became law: the Governor signed it, did not veto it in time, or the legislature overrode a veto. Most Public Acts change the General Statutes. Until those changes are codified, the act is where its language lives.</p>
      <p>The number identifies the year and the act’s sequence: <strong>P.A. ${short(supplementYear)}-83</strong> is Public Act 83 of ${supplementYear}. Acts passed in a special session are numbered separately and cited with that session.</p>
    </div>
    <article class="guide-sample-act" aria-labelledby="guide-sample-act-heading">
      <header>
        <p class="guide-fictional">Fictional example. Not real law.</p>
        <h3 id="guide-sample-act-heading">${actName} (Illustrative)</h3>
        <p>An Act Concerning Community Garden Permits. “Sec. 99-101” and its text are invented for this guide.</p>
      </header>
      <ol class="guide-act-sections">
        <li><strong>Sec. 1</strong> <span class="guide-act-effect">Amends</span> Sec. 99-101 to lengthen permit terms. <em>Effective October 1, ${supplementYear}.</em></li>
        <li><strong>Sec. 2</strong> <span class="guide-act-effect">Creates</span> a new section, marked “(NEW)” in the act. LCO gives it a statute number when it is codified. <em>Effective October 1, ${supplementYear}.</em></li>
        <li><strong>Sec. 3</strong> <span class="guide-act-effect">Repeals</span> Sec. 99-104. <em>Effective July 1, ${nextRevisionYear}.</em></li>
        <li><strong>Sec. 4</strong> <span class="guide-act-effect">Temporary</span> Requires a one-time report by January 1, ${nextRevisionYear}. Likely never codified. <em>Effective from passage.</em></li>
      </ol>
    </article>
    <figure class="guide-amendment">
      <figcaption>How Sec. 1 of the fictional act changes the statute text</figcaption>
      <ol>
        <li class="guide-amendment-step">
          <p class="guide-amendment-label">${revisionYear} General Statutes</p>
          <p class="guide-amendment-text"><strong>Sec. 99-101.</strong> (a) A town may issue a community garden permit for a term of one year.</p>
        </li>
        <li class="guide-amendment-step guide-amendment-act">
          <p class="guide-amendment-label">${actName}, Sec. 1</p>
          <p class="guide-amendment-text act-document"><strong>Sec. 99-101.</strong> (a) A town may issue a community garden permit for a term of <del class="revision-deletion">[one year]</del> <ins class="revision-addition">two years</ins>.</p>
          <p class="guide-amendment-note">Acts show deleted words in [brackets] and new words underlined. This app highlights them in red and green.</p>
        </li>
        <li class="guide-amendment-step">
          <p class="guide-amendment-label">${nextRevisionYear} General Statutes (after codification)</p>
          <p class="guide-amendment-text"><strong>Sec. 99-101.</strong> (a) A town may issue a community garden permit for a term of two years.</p>
        </li>
      </ol>
    </figure>
    <p class="guide-aside">LCO’s ${external(OFFICIAL_LINKS.conversionTables, "conversion tables")} show which statute number each new section of a Public Act received. In this app, the <a href="${appBase}${escapeHtml(actsRouteHref())}">Acts list</a> shows each act’s text with these marks.</p>
    <div class="guide-table-wrap">
      <table class="guide-compare">
        <caption>Public Acts and Special Acts</caption>
        <thead><tr><th scope="col"><span class="visually-hidden">Feature</span></th><th scope="col">Public Act</th><th scope="col">Special Act</th></tr></thead>
        <tbody>
          <tr><th scope="row">Applies to</th><td>The public generally</td><td>Particular people, places, or programs, such as a task force, a study, or one entity’s charter</td></tr>
          <tr><th scope="row">Codified?</th><td>Most provisions are added to the General Statutes</td><td>Not codified</td></tr>
          <tr><th scope="row">Default effective date</th><td>October 1 after the session, unless the act says otherwise</td><td>The date it is approved, unless the act says otherwise</td></tr>
          <tr><th scope="row">Citation</th><td>P.A. ${short(supplementYear)}-83</td><td>S.A. ${short(supplementYear)}-1</td></tr>
        </tbody>
      </table>
    </div>`);
}

const EFFECTIVE_MOMENTS = Object.freeze([
  { id: "summer", label: (year) => `July ${year}` },
  { id: "fall", label: (year) => `November ${year}` },
  { id: "published", label: (_, next) => `After the ${next} General Statutes are published` }
]);

function effectiveOutcome(moment, example) {
  const { supplementYear, nextRevisionYear, revisionYear } = example;
  const published = moment === "published";
  const rows = [
    ["Sec. 1 (effective from passage)", "In effect", "In effect since the act was approved in June."],
    ["Sec. 2 (effective October 1)", moment === "summer" ? null : "In effect", moment === "summer" ? `Enacted, but not operative until October 1, ${supplementYear}.` : `In effect since October 1, ${supplementYear}.`],
    ["Published General Statutes", published ? "Updated" : null, published ? `The new language appears in the ${nextRevisionYear} General Statutes.` : `Still show the old language. The ${revisionYear} General Statutes and ${supplementYear} Supplement were revised before this act passed.`]
  ];
  return `<table class="guide-effective-table">
    <caption class="visually-hidden">Status of the fictional act</caption>
    <tbody>${rows.map(([label, state, text]) => `<tr><th scope="row">${label}</th><td><span class="guide-state guide-state-${state ? "yes" : "no"}">${state ?? "Not yet"}</span> ${text}</td></tr>`).join("")}</tbody>
  </table>`;
}

function renderEffective({ interactive, example, appBase }) {
  const { supplementYear, nextRevisionYear } = example;
  const selected = "fall";
  const statute = `${appBase}${SECTION_2_32}`;
  const options = EFFECTIVE_MOMENTS.map((moment) => interactive
    ? `<label class="guide-moment"><input type="radio" name="guide-moment" value="${moment.id}"${moment.id === selected ? " checked" : ""} data-guide-moment> <span>${moment.label(supplementYear, nextRevisionYear)}</span></label>`
    : "").join("");
  const outcomes = EFFECTIVE_MOMENTS.map((moment) => `<div class="guide-moment-outcome" data-guide-moment-outcome="${moment.id}"${interactive && moment.id !== selected ? " hidden" : ""}>
      ${interactive ? "" : `<h3>${moment.label(supplementYear, nextRevisionYear)}</h3>`}${effectiveOutcome(moment.id, example)}</div>`).join("");
  const markers = [
    { date: `June ${supplementYear}`, text: "Act approved. Sec. 1 takes effect.", position: 0 },
    { date: `October 1, ${supplementYear}`, text: "Sec. 2 takes effect.", position: 2 },
    { date: `January 1, ${nextRevisionYear}`, text: `Revision date for the ${nextRevisionYear} General Statutes.`, position: 4 },
    { date: `${nextRevisionYear}, later`, text: "The revision is published with the new language.", position: 6 }
  ];
  return guideSection("effective", "Timing", "When does a law actually take effect?", `
    <dl class="guide-terms">
      <div><dt>Enactment date</dt><dd>When the legislation becomes law: the Governor signs it, the time to veto runs out, or a veto is overridden.</dd></div>
      <div><dt>Effective date</dt><dd>When a particular section becomes operative. Public Acts take effect on October 1 after the session unless the act says otherwise (<a href="${statute}">Sec. 2-32</a>), and sections of one act often have different dates.</dd></div>
      <div><dt>Codification and publication</dt><dd>When the change is incorporated into a published edition of the statutes. This does not affect when the law took effect.</dd></div>
    </dl>
    <p class="guide-key-message"><strong>A law can already be in effect even if the updated language has not yet appeared in the published General Statutes.</strong></p>
    <div class="guide-effective" data-guide-effective>
      <p class="guide-effective-intro">A fictional act is approved in June ${supplementYear}. Sec. 1 is effective from passage; Sec. 2 is effective October 1, ${supplementYear}.</p>
      <ol class="guide-effective-line" data-guide-moment-line data-moment="${selected}">
        ${markers.map((marker) => `<li style="--marker:${marker.position}"><time>${marker.date}</time><span>${marker.text}</span></li>`).join("")}
      </ol>
      ${interactive ? `<fieldset class="guide-moments"><legend>Check the law on a date</legend>${options}</fieldset>` : ""}
      <div class="guide-moment-outcomes" aria-live="polite">${outcomes}</div>
    </div>`);
}

function coverageLayer({ number, title, law, app, state, stateLabel }) {
  return `<li class="guide-layer guide-layer-${number}">
    <div class="guide-layer-title"><span class="guide-layer-number">Layer ${number}</span><h3>${title}</h3></div>
    <div class="guide-layer-law"><p class="guide-layer-heading">What the law may include</p><p>${law}</p></div>
    <div class="guide-layer-app"><p class="guide-layer-heading">What this app currently displays <span class="guide-coverage-state guide-coverage-${state}">${stateLabel}</span></p>${app}</div>
  </li>`;
}

function renderCoverage({ coverage, example, appBase }) {
  const { revisionYear, supplementYear, nextRevisionYear } = example;
  const base = coverage?.base;
  const supplement = coverage?.supplement;
  const acts = coverage?.acts;
  const link = (route, label) => `<a href="${appBase}${escapeHtml(route)}">${label}</a>`;
  const unknown = "<p>Coverage details could not be loaded. Check the About page when you are online.</p>";
  const baseApp = base
    ? `<p>The ${escapeHtml(base.label)}${base.year ? ` (revised to January 1, ${base.year})` : ""}, as published on the General Assembly’s website${base.capturedAt ? ` and captured ${escapeHtml(base.capturedAt)}` : ""}${base.sections ? `: ${count(base.sections)} sections` : ""}.</p>`
    : unknown;
  const supplementApp = supplement
    ? `<p>Merged into the statute text section by section: ${count(supplement.replacements)} sections replaced and ${count(supplement.additions)} added. Each is labeled “${supplement.year} Supp.”, and the superseded ${base?.year ?? supplement.year - 1} text stays available in a comparison panel. Sections the Supplement does not include keep their ${base?.year ?? supplement.year - 1} text.</p>`
    : supplement === null ? "<p>No supplement is merged into the statute text.</p>" : unknown;
  const sessions = acts?.sessions ?? [];
  const actsApp = acts
    ? sessions.length
      ? `<p>${sessions.map((session) => `${escapeHtml(session.name)}: ${count(session.acts)} acts (${count(session.publicActs)} public, ${count(session.specialActs)} special)`).join("; ")}, with act text and effective dates in the ${link(actsRouteHref(), "Acts list")}.</p>
        <p>Acts are <strong>not merged</strong> into the statute text. When a listed act states that it amends or repeals a section, that section’s page shows a notice linking to the act, and the chapter list marks it. Only the sessions named here are included.${acts.unlistedCoveredYear ? ` Acts of the ${acts.unlistedCoveredYear} sessions are not listed; their codified changes appear through the ${acts.coveredBy}.` : ""}</p>`
      : "<p>No Public Acts are listed.</p>"
    : acts === null ? "<p>No Public Acts are listed.</p>" : unknown;
  return guideSection("coverage", "This app", "What does the CGS Explorer include?", `
    <div class="guide-prose"><p>Finding the law in force can mean reading three sources together. The left side of each layer describes the official sources; the right side describes only what this app’s published data contains.</p></div>
    <ol class="guide-layers">
      ${coverageLayer({
        number: 1,
        title: "Full General Statutes revision",
        law: `The complete codified collection, such as the ${revisionYear} General Statutes.`,
        app: baseApp,
        state: base ? "included" : "unknown",
        stateLabel: base ? "Included" : "Unknown"
      })}
      ${coverageLayer({
        number: 2,
        title: "Supplement",
        law: `Sections updated, added, or repealed since that revision, such as the ${supplementYear} Supplement.`,
        app: supplementApp,
        state: supplement ? "merged" : supplement === null ? "absent" : "unknown",
        stateLabel: supplement ? "Merged" : supplement === null ? "Not included" : "Unknown"
      })}
      ${coverageLayer({
        number: 3,
        title: "Public Acts",
        law: `Legislation enacted since the latest edition’s revision date, which may change the law before the ${nextRevisionYear} revision. Includes provisions that are never codified.`,
        app: actsApp,
        state: sessions.length ? "separate" : acts !== undefined ? "absent" : "unknown",
        stateLabel: sessions.length ? "Listed separately" : acts !== undefined ? "Not included" : "Unknown"
      })}
    </ol>
    <div class="guide-limits">
      <h3>Limits to keep in mind</h3>
      <ul>
        <li>The statute text is a copy captured on a specific date. Corrections the General Assembly publishes later appear after the app’s next reviewed update.</li>
        <li>When an amendment takes effect after the revision date, the app shows both versions in one section, as the official text does, marked “See end of section for amended version and effective date.”</li>
        <li>Uncodified provisions appear only in act text, and only for the sessions the Acts list includes.</li>
        <li>Act notices on statute pages come from each act’s statement of the sections it amends or repeals. An act can still affect a section without amending it, for example through a “notwithstanding” provision, so a page without a notice is not proof that nothing changed.</li>
        <li>Each section shows its source: a “${supplement ? `${supplement.year} Supp.` : "Supplement"}” label for supplement text, and an Official source link to the General Assembly page it came from.</li>
      </ul>
    </div>
    <aside class="legal-data-note guide-notice" role="note" aria-label="Unofficial research interface">
      <strong>An unofficial research interface</strong>
      <p>The CGS Explorer is not the official publication of Connecticut law and is not legal advice. To determine the law in effect on a particular date, consult the official General Statutes, Supplement, and applicable Public Acts from the Connecticut General Assembly.</p>
    </aside>`);
}

const RESEARCH_STEPS = Object.freeze([
  {
    title: (e) => `Read the section in the ${e.revisionYear} General Statutes`,
    body: (e) => `<p>Start with the full revision, revised to January 1, ${e.revisionYear}. Note any “See end of section for amended version” mark in the heading: part of the section may already be scheduled to change.</p>`,
    app: () => "In this app, sections without a supplement label show this text."
  },
  {
    title: (e) => `Check whether the ${e.supplementYear} Supplement updates it`,
    body: (e) => `<p>The Supplement contains the updated versions of sections amended, added, or repealed during the ${e.revisionYear} sessions.</p>`,
    question: (e) => `Does the ${e.supplementYear} Supplement include the section?`,
    yes: (e) => `Use the Supplement’s text. In this app the section is labeled “${e.supplementYear} Supp.”, and the earlier text is under “Compare with ${e.revisionYear} text.” Continue to step 3.`,
    no: (e) => `The ${e.revisionYear} sessions generally did not change it, so the ${e.revisionYear} text carries forward. Continue to step 3: later legislation can still change it.`
  },
  {
    title: (e) => `Check whether ${e.supplementYear} Public Acts amend it`,
    body: (e, appBase) => `<p>Look for the section in LCO’s ${external(OFFICIAL_LINKS.referenceTables, "General Statutes Amended or Repealed")} table for ${e.supplementYear} once it is published, and search the text of ${e.supplementYear} acts for the section number. In this app, a section that a listed act amends or repeals shows a notice under its heading, and you can <a href="${appBase}${escapeHtml(actsRouteHref())}">search the Acts list</a> for the section number.</p>
      <p class="guide-caution"><strong>A section-number search is not exhaustive.</strong> It finds acts that cite the section. It can miss uncodified provisions that affect the same subject, acts from sessions not searched, and changes to related sections or definitions the section relies on.</p>`,
    question: (e) => `Does a ${e.supplementYear} Public Act amend the section?`,
    yes: () => "Read the act with the section, then check its effective dates in step 4.",
    no: (e) => `If no act changes it, the published text (${e.revisionYear} General Statutes plus the ${e.supplementYear} Supplement) is likely current. Confirm in step 5.`
  },
  {
    title: () => "Examine the effective dates",
    body: () => "<p>Find the amending section of the act and its “(Effective …)” line. Different sections of one act can take effect on different dates.</p>",
    question: (e) => `Was the amendment in effect on the date you care about, such as October ${e.supplementYear}?`,
    yes: () => "The act’s language governs from its effective date, even though the published statutes do not show it yet.",
    no: () => "The published text still governs until the amendment’s effective date. Note when it will change."
  },
  {
    title: () => "Confirm with official sources",
    body: () => `<p>Verify the text and dates with the General Assembly’s official statutes, Supplement, and Public Acts. For questions about a specific situation, ask a law librarian or an attorney.</p>`
  }
]);

function renderResearch({ interactive, example, appBase }) {
  const steps = RESEARCH_STEPS.map((step, index) => {
    const id = `guide-step-${index + 1}`;
    const question = step.question ? interactive
      ? `<div class="guide-question" role="group" aria-labelledby="${id}-question">
          <p id="${id}-question">${step.question(example)}</p>
          <div class="guide-answer-buttons">
            <button type="button" aria-pressed="false" aria-controls="${id}-outcome" data-guide-answer="yes" data-guide-step="${index}">Yes</button>
            <button type="button" aria-pressed="false" aria-controls="${id}-outcome" data-guide-answer="no" data-guide-step="${index}">No</button>
          </div>
          <div class="guide-outcome" id="${id}-outcome" aria-live="polite">
            <p data-guide-outcome="yes" hidden><strong>Yes:</strong> ${step.yes(example)}</p>
            <p data-guide-outcome="no" hidden><strong>No:</strong> ${step.no(example)}</p>
          </div>
        </div>`
      : `<div class="guide-question"><p>${step.question(example)}</p><ul><li><strong>Yes:</strong> ${step.yes(example)}</li><li><strong>No:</strong> ${step.no(example)}</li></ul></div>`
      : "";
    return `<li class="guide-step" data-guide-step-item="${index}">
      <span class="guide-step-marker" aria-hidden="true">${index + 1}</span>
      <div class="guide-step-body">
        <h3 id="${id}">${step.title(example)}</h3>
        ${step.body(example, appBase)}
        ${step.app ? `<p class="guide-step-app">${step.app(example)}</p>` : ""}
        ${question}
      </div>
    </li>`;
  }).join("");
  return guideSection("research", "Worked example", `Researching a statute in ${example.supplementYear}`, `
    <p class="guide-scenario">You find a section in the ${example.revisionYear} General Statutes. Is it still the law in October ${example.supplementYear}?</p>
    <ol class="guide-steps">${steps}</ol>
    <p class="guide-key-message guide-takeaway"><strong>The most recent published statutory text is not always the complete picture.</strong> Newly enacted Public Acts and their effective dates may also matter.</p>`);
}

function renderOfficial({ example }) {
  const revision = publicationForYear(example.revisionYear);
  const supplement = publicationForYear(example.supplementYear);
  const groups = [
    {
      title: "The statutes",
      links: [
        revision.url && [revision.url, revision.label, `The full revision, revised to January 1, ${revision.year}.`],
        supplement.url && [supplement.url, supplement.label, `Changes from the ${example.revisionYear} sessions, revised to January 1, ${supplement.year}.`],
        [OFFICIAL_LINKS.statutesAndActs, "General Statutes and Public Acts", "LCO’s index of statutes, acts, indexes, and tables."]
      ].filter(Boolean)
    },
    {
      title: "Public Acts",
      links: [
        [OFFICIAL_LINKS.actsThisSession, "Public and Special Acts", "Acts of the current session, with PDFs."],
        [OFFICIAL_LINKS.actsByNumber, "Acts by number", "LCO’s list of Public and Special Acts by act number."],
        [OFFICIAL_LINKS.actsSearch, "Search Public and Special Acts", "Full-text search of acts across years."],
        [OFFICIAL_LINKS.effectiveDates, "Legislation effective by date", "Acts grouped by the date they take effect."]
      ]
    },
    {
      title: "Finding tables",
      links: [
        [OFFICIAL_LINKS.conversionTables, "Public Acts to General Statutes conversion tables", "The statute number each new section of an act received."],
        [OFFICIAL_LINKS.referenceTables, "Reference tables", "General Statutes amended or repealed each year, and acts enacted by bill number."]
      ]
    },
    {
      title: "The process",
      links: [
        [OFFICIAL_LINKS.billFlowchart, "How a Bill Becomes a Law (PDF)", "The General Assembly’s flowchart."],
        [OFFICIAL_LINKS.enactment, "Enactment of Bills", "Committee action, votes, the Governor’s deadlines, and veto sessions."],
        [OFFICIAL_LINKS.aboutBills, "About bills and codification", "LCO’s explanation of bills, acts, and the revision cycle."],
        [OFFICIAL_LINKS.lcoServices, "Legislative Commissioners’ Office", "Drafting, engrossing, codification, and statute publication."],
        [OFFICIAL_LINKS.generalAssembly, "Connecticut General Assembly", "Bills, sessions, and legislative resources."]
      ]
    }
  ];
  return guideSection("official", "Verify", "Official sources and further reading", `
    <div class="guide-resources">${groups.map((group) => `<section class="guide-resource-group" aria-label="${escapeHtml(group.title)}">
      <h3>${group.title}</h3>
      <ul>${group.links.map(([href, label, text]) => `<li>${external(href, label)}<span>${text}</span></li>`).join("")}</ul>
    </section>`).join("")}</div>`);
}

export function renderGuide({ coverage = null, interactive = true, appBase = "" } = {}) {
  const example = exampleCycle();
  // The app's hash router owns fragment links, so its contents open guide routes; the static
  // copy has no router and uses ordinary in-page anchors.
  const contents = GUIDE_PARTS.map((part) => interactive
    ? `<li><a href="${escapeHtml(guideRouteHref(part.id))}" data-guide-jump="${part.id}">${part.label}</a></li>`
    : `<li><a href="#guide-${part.id}">${part.label}</a></li>`).join("");
  return `<header class="guide-intro">
      <p class="eyebrow">Research guide</p>
      <h1>Understanding the Statutes</h1>
      <p class="guide-lede">Connecticut’s General Statutes are an organized collection of the state’s laws. But laws don’t begin as statutes. They begin as bills, become Public Acts when passed by the legislature, and are incorporated into the General Statutes through a process called codification.</p>
    </header>
    <nav class="guide-contents" aria-label="On this page"><ol>${contents}</ol></nav>
    ${renderSources({ example })}
    ${renderProcess({ interactive })}
    ${renderCycle({ interactive, coverage })}
    ${renderPublicActs({ example, appBase })}
    ${renderEffective({ interactive, example, appBase })}
    ${renderCoverage({ coverage, example, appBase })}
    ${renderResearch({ interactive, example, appBase })}
    ${renderOfficial({ example })}`;
}

function select(buttons, details, value, attribute) {
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset[attribute] === value));
  for (const detail of details) detail.hidden = detail.dataset[`${attribute}Detail`] !== value;
}

export function mountGuide(root, { scrollTo = null } = {}) {
  if (!root) return () => {};
  const stagesList = root.querySelector("[data-guide-stages]");
  const stagePanel = root.querySelector("[data-guide-stage-panel]");
  const flow = root.querySelector("[data-guide-flow]");
  const stageButtons = [...root.querySelectorAll("[data-guide-stage]")];
  const stageDetails = [...root.querySelectorAll("[data-guide-stage-detail]")];
  const yearButtons = [...root.querySelectorAll("[data-guide-year]")];
  const yearDetails = [...root.querySelectorAll("[data-guide-year-detail]")];

  // In the vertical stepper the panel opens under the selected step; across the page, it sits
  // below the whole row. The stylesheet reports which layout applies.
  const placeStagePanel = () => {
    const vertical = getComputedStyle(stagesList).getPropertyValue("--guide-flow").trim() === "vertical";
    const selected = stageButtons.find((button) => button.getAttribute("aria-pressed") === "true");
    const target = vertical ? selected?.closest("li") : flow;
    if (target && stagePanel.parentElement !== target) target.append(stagePanel);
  };

  const onClick = (event) => {
    const stage = event.target.closest("[data-guide-stage]");
    if (stage) {
      select(stageButtons, stageDetails, stage.dataset.guideStage, "guideStage");
      placeStagePanel();
      return;
    }
    const year = event.target.closest("[data-guide-year]");
    if (year) {
      select(yearButtons, yearDetails, year.dataset.guideYear, "guideYear");
      return;
    }
    const answer = event.target.closest("[data-guide-answer]");
    if (answer) {
      const group = answer.closest(".guide-question");
      for (const button of group.querySelectorAll("[data-guide-answer]")) button.setAttribute("aria-pressed", String(button === answer));
      for (const outcome of group.querySelectorAll("[data-guide-outcome]")) outcome.hidden = outcome.dataset.guideOutcome !== answer.dataset.guideAnswer;
      answer.closest(".guide-step")?.classList.add("guide-step-answered");
      return;
    }
    const jump = event.target.closest("[data-guide-jump]");
    if (jump && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      // Replacing the URL keeps the part shareable without re-rendering the page.
      history.replaceState(history.state, "", guideRouteHref(jump.dataset.guideJump));
      showPart(root, jump.dataset.guideJump);
    }
  };

  const onChange = (event) => {
    const moment = event.target.closest("[data-guide-moment]");
    if (!moment) return;
    for (const outcome of root.querySelectorAll("[data-guide-moment-outcome]")) outcome.hidden = outcome.dataset.guideMomentOutcome !== moment.value;
    root.querySelector("[data-guide-moment-line]")?.setAttribute("data-moment", moment.value);
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => placeStagePanel()) : null;
  observer?.observe(flow);
  placeStagePanel();
  if (scrollTo) requestAnimationFrame(() => showPart(root, scrollTo));
  return () => {
    observer?.disconnect();
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
  };
}

export function showPart(root, part) {
  const heading = root.querySelector(`#guide-${CSS.escape(part)}-heading`);
  if (!heading) return false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  heading.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  heading.focus({ preventScroll: true });
  return true;
}

