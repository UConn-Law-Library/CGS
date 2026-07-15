import { escapeHtml } from "./reader.js";
import { indexRouteHref } from "./routes.js";

const amountLabels = {
  total_due: "Total due",
  fine: "Fine",
  fee: "Fee",
  z_fee: "Zone fee",
  cost: "Cost",
  surcharge: "Surcharge",
  stf: "Transportation Fund",
  bipsa: "Brain injury assessment",
  mf: "Municipal fee",
  plus: "Additional"
};

export function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}

export function topicLetter(label) {
  return String(label ?? "").trim().toLowerCase().match(/[a-z0-9]/)?.[0] ?? "a";
}

function renderResolution(display, resolution) {
  return resolution?.href
    ? `<a href="${escapeHtml(resolution.href)}">${escapeHtml(display)}</a>`
    : `<span>${escapeHtml(display)}</span>`;
}

function renderAmounts(amounts = {}) {
  const values = Object.entries(amounts);
  if (!values.length) return "";
  return `<dl class="amounts">${values.map(([key, value]) =>
    `<div><dt>${escapeHtml(amountLabels[key] ?? key)}</dt><dd>${escapeHtml(formatMoney(value))}</dd></div>`
  ).join("")}</dl>`;
}

function renderInfraction(entry) {
  return `<li class="secondary-record">
    <div class="record-heading"><strong>${escapeHtml(entry.citation)}</strong>${entry.subsequent ? `<span class="record-tag">Subsequent offense</span>` : ""}</div>
    <p>${escapeHtml(entry.description)}</p>
    ${renderAmounts(entry.amounts)}
  </li>`;
}

function renderFeeRule({ rule, roles }) {
  const roleLabels = roles.map((role) => role === "authority" ? "Fee authority" : "Affected statute");
  return `<li class="secondary-record">
    <div class="record-heading"><strong>${renderResolution(rule.authorityCitation, rule.authorityResolution)}</strong>${roleLabels.map((label) => `<span class="record-tag">${escapeHtml(label)}</span>`).join("")}</div>
    <p>${escapeHtml(rule.description)}</p>
    <details class="record-detail"><summary>Affected statutes and notes</summary>
      <p>${escapeHtml(rule.affectedText)}</p>
      ${rule.comments ? `<p><strong>Comments:</strong> ${escapeHtml(rule.comments)}</p>` : ""}
    </details>
  </li>`;
}

export function renderIndexReferences(references = []) {
  if (!references.length) return "";
  return `<span class="index-references">${references.map((reference) =>
    renderResolution(reference.display, reference.resolution)
  ).join(", ")}</span>`;
}

export function renderIndexEntry(entry) {
  const targets = entry.see ?? [];
  let text = String(entry.text ?? "");
  const linked = [];
  let cursor = 0;
  const matches = targets.map((target) => {
    const heading = String(target.heading);
    const exactIndex = text.indexOf(heading, cursor);
    const index = exactIndex >= 0
      ? exactIndex
      : text.toLowerCase().indexOf(heading.toLowerCase(), cursor);
    if (index < 0) return null;
    cursor = index + heading.length;
    return { target, index };
  }).filter(Boolean).sort((left, right) => left.index - right.index);
  cursor = 0;
  for (const { target, index } of matches) {
    linked.push(escapeHtml(text.slice(cursor, index)));
    const label = text.slice(index, index + target.heading.length);
    const href = indexRouteHref(topicLetter(target.heading), {
      heading: target.heading,
      subheading: target.subheading
    });
    linked.push(`<a class="index-see-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
    cursor = index + target.heading.length;
  }
  linked.push(escapeHtml(text.slice(cursor)));
  const unmatched = targets.filter((target) => !matches.some((match) => match.target === target));
  return `<li id="${escapeHtml(entry.id)}" tabindex="-1" class="index-entry index-level-${Math.min(4, Math.max(0, Number(entry.level) || 0))}">
    <span>${linked.join("")}</span>
    ${renderIndexReferences(entry.references)}
    ${unmatched.length ? `<span class="index-see">${unmatched.map((target) => {
      const href = indexRouteHref(topicLetter(target.heading), { heading: target.heading, subheading: target.subheading });
      return `See <a class="index-see-link" href="${escapeHtml(href)}">${escapeHtml(target.heading)}</a>${target.subheading ? `, at ${escapeHtml(target.subheading)}` : ""}`;
    }).join("; ")}</span>` : ""}
  </li>`;
}

function renderLinkedIndex({ topic, entry }) {
  const href = indexRouteHref(topicLetter(topic.label), { topic: topic.id });
  return `<li class="secondary-record">
    <div class="record-heading"><a href="${escapeHtml(href)}"><strong>${escapeHtml(topic.label)}</strong></a></div>
    <p>${escapeHtml(entry.text)}</p>
    ${renderIndexReferences(entry.references)}
  </li>`;
}

export function renderSecondaryContext(context) {
  if (!context) return "";
  if (context.error) return `<section class="secondary-sources" aria-labelledby="secondary-heading"><h2 id="secondary-heading">Related legal data</h2><p class="secondary-warning">Related records could not be loaded. The statute text above is unaffected.</p></section>`;
  const total = context.infractions.length + context.feeRules.length + context.indexEntries.length;
  if (!total) return "";
  const infractionSource = context.manifests.infractions.source;
  const indexSource = context.manifests.index.source;
  return `<section class="secondary-sources" aria-labelledby="secondary-heading">
    <div class="secondary-heading">
      <div><p class="eyebrow">Official cross-references</p><h2 id="secondary-heading">Related legal data</h2></div>
      <p>Derived from official publications; verify amounts and applicability with the linked source.</p>
    </div>
    ${context.infractions.length ? `<details class="related-group" open><summary>Infractions schedule <span>${context.infractions.length}</span></summary>
      <p class="source-note">Judicial Branch schedule effective ${escapeHtml(infractionSource.effective ?? "date not stated")}. <a href="${escapeHtml(infractionSource.url)}">Official schedule (PDF)</a></p>
      <ol class="secondary-records">${context.infractions.map(renderInfraction).join("")}</ol>
    </details>` : ""}
    ${context.feeRules.length ? `<details class="related-group"><summary>Fees and surcharges <span>${context.feeRules.length}</span></summary>
      <p class="source-note">Chart B revision ${escapeHtml(infractionSource.chartBRevision ?? "not stated")}. Roles describe whether this section creates or is affected by the rule.</p>
      <ol class="secondary-records">${context.feeRules.map(renderFeeRule).join("")}</ol>
    </details>` : ""}
    ${context.indexEntries.length ? `<details class="related-group"><summary>General Statutes index <span>${context.indexEntries.length}</span></summary>
      <p class="source-note">${escapeHtml(indexSource.revision)}. <a href="${escapeHtml(indexSource.url)}">Official index</a></p>
      <ol class="secondary-records">${context.indexEntries.map(renderLinkedIndex).join("")}</ol>
    </details>` : ""}
  </section>`;
}

function searchableEntry(entry) {
  return [
    entry.text,
    ...(entry.references ?? []).map((reference) => reference.display),
    ...(entry.see ?? []).flatMap((target) => [target.heading, target.subheading])
  ].filter(Boolean).join(" ").toLowerCase();
}

export function groupIndexEntries(entries = []) {
  const groups = [];
  for (const entry of entries) {
    if (!groups.length || (Number(entry.level) || 0) === 0) groups.push([entry]);
    else groups.at(-1).push(entry);
  }
  return groups;
}

export function searchIndexEntries(entries, query, limit = 100) {
  const normalized = String(query ?? "").trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { results: [], total: 0, truncated: false };
  const matches = entries.filter((entry) => {
    const text = searchableEntry(entry);
    return tokens.every((token) => text.includes(token));
  });
  return { results: matches.slice(0, limit), total: matches.length, truncated: matches.length > limit };
}

export function searchIndexTopics(topics, query, limit = 100) {
  const normalized = String(query ?? "").trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { results: [], total: 0, truncated: false };
  const matches = [];
  for (const topic of topics) {
    const label = topic.label.toLowerCase();
    if (tokens.every((token) => label.includes(token))) {
      matches.push({ topic, entry: null, score: label === normalized ? 0 : 1 });
    }
    for (const entry of topic.items) {
      const text = searchableEntry(entry);
      if (tokens.every((token) => text.includes(token))) {
        matches.push({ topic, entry, score: text.startsWith(normalized) ? 2 : 3 });
      }
    }
  }
  matches.sort((left, right) => left.score - right.score
    || left.topic.position - right.topic.position
    || (left.entry?.id ?? "").localeCompare(right.entry?.id ?? ""));
  return { results: matches.slice(0, limit), total: matches.length, truncated: matches.length > limit };
}
