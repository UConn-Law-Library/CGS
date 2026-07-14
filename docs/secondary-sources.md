# Secondary legal-source ingestion

Phase 7 adds two official, PDF-derived datasets without introducing a database or changing canonical statute chapters:

- the Connecticut Judicial Branch Mail-In Violations and Infractions Schedule;
- the Legislative Commissioners' Office Index to the General Statutes of Connecticut.

The extraction algorithms began with the proven parsers in the legacy repository. The migrated versions are now extraction-only modules. Acquisition, provenance, canonical statute resolution, sharding, reverse links, validation, and transactional publication belong to this repository.

## Source acquisition

Capture the current three index volumes and infractions schedule into a content-addressed staging directory:

```sh
npm run secondary:acquire -- --output .crawl/secondary/sources
```

TLS verification is the default. If the known CGA certificate-chain problem persists after the system trust store is loaded, the same explicit temporary workaround used by the statute crawler is available:

```sh
npm run secondary:acquire -- --output .crawl/secondary/sources --no-ssl-verify
```

The Judicial Branch sometimes rejects hosted-runner traffic. A manually retrieved official PDF can be supplied without weakening or silently bypassing acquisition:

```sh
npm run secondary:acquire -- --output .crawl/secondary/sources --infractions-file <infractions.pdf>
```

Every captured PDF is stored by SHA-256. The URL manifest records its official URL, name, byte length, digest, capture time, and the LCO revision label. HTML error pages and other non-PDF responses fail closed.

## Canonical import

Import directly from the capture manifest:

```sh
npm run secondary:import -- \
  --sources .crawl/secondary/sources/manifest.json \
  --base public/data \
  --output .crawl/secondary/canonical \
  --generated-at 2026-07-14T00:00:00Z

npm run validate:secondary -- \
  --data .crawl/secondary/canonical \
  --base public/data
```

The import is transactional and binds every derived artifact to the exact canonical base manifest. A later statute refresh therefore requires a new resolution and review pass.

Monetary values are integer cents. A citation resolution is `exact`, `section-only`, `unresolved`, or `not-applicable`; the importer never trims or guesses its way to a statute. Resolved references contain a canonical reader link, while reverse-link shards let a statute page discover associated infractions and index entries without changing its chapter artifact.

Chart B is modeled separately from the row-oriented Chart A schedule. Each rule retains the printed authority, description, complete affected-statute prose, comments, source pages, and revision. Authority and affected citations are derived without expanding printed ranges; reverse links record whether a statute is the rule's `authority` or is `affected` by it.

## Artifact layout

```text
secondary/
  manifest.json
  infractions/
    manifest.json
    fee-rules.json
    title-14.json
    unresolved.json
  statutes-index/
    manifest.json
    a-01.json
    ...
  links/
    manifest.json
    title-14.json
```

Infractions are sharded by resolved title. The subject index is grouped by initial letter and split at a deterministic two-megabyte target without dividing a heading. Reverse links are sharded by title. All artifacts carry byte length and SHA-256 records in the root manifest.

## Production-scale validation record

The migrated pipeline has completed a full isolated run against the current official PDFs:

- 1,737 Chart A infractions;
- 1,725 resolved infractions;
- 10 Chart B fee rules, including the rule spanning source pages 75–76;
- 234 Chart B affected-statute references, all resolved against the canonical corpus;
- 5,652 index headings;
- 193,922 index entries;
- 166,777 statute references;
- 164,529 resolved statute references;
- 161 derived artifacts, with the largest shard approximately two megabytes.

These generated artifacts remain in ignored `.crawl` staging until legal-data review approves publication under `public/data/secondary`.

## Refresh review

Compare a reviewed snapshot with a candidate and apply the versioned safety policy:

```sh
npm run diff:secondary -- \
  --before <reviewed-secondary> \
  --after .crawl/secondary/canonical \
  --json .crawl/secondary/diff.json \
  --markdown .crawl/secondary/diff.md

npm run review:secondary -- \
  --report .crawl/secondary/diff.json \
  --policy config/secondary-refresh-policy.json \
  --summary .crawl/secondary/review.md
```

The gate rejects implausibly small datasets, excessive removals, any Chart B rule removal, and citation-resolution regressions below the configured floors. Passing the gate does not publish data automatically; the diff and legal-source changes still require human review. The first reviewed dataset is now published under `public/data/secondary`, establishing the baseline for future refresh diffs.

## Reader integration

The reviewed artifacts are published under `public/data/secondary`. A statute page loads its title-level reverse-link shard on demand, then retrieves only the referenced infraction, fee-rule, and subject-index artifacts. Chart B relationships are labeled as `Fee authority` or `Affected statute`; source dates and official publication links remain visible beside the derived records.

The hash route `#/index` opens the General Statutes index. Alphabetical browsing loads only the selected letter's shards. Search derives the relevant initial letter from the query, searches that letter in memory, and caps the rendered result set at 100. Large headings render 250 entries at a time. These boundaries preserve responsive GitHub Pages behavior without a server or database.
