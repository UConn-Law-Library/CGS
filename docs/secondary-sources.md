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
npm run secondary:acquire -- --output .crawl/secondary/sources --no-cga-ssl-verify
```

This exception is scoped to `www.cga.ct.gov`. Judicial Branch TLS verification remains enabled. Downloads make five attempts with exponential backoff. The infractions download tries the official `jud.ct.gov` endpoint first and the official `www.jud.ct.gov` endpoint second, preserving the successful URL in the capture manifest. If both verified endpoints fail, acquisition fails closed.

The standalone refresh uses a Windows runner and the system `curl.exe` (Schannel) for the Judicial PDF. This avoids the Python/OpenSSL TLS handshake failures observed on the Ubuntu runner. CGA discovery and index acquisition continue to use the Python client. To reproduce the workflow on Windows:

```sh
npm run secondary:acquire -- --output .crawl/secondary/sources --judicial-client windows-curl --no-cga-ssl-verify
```

The native client verifies certificates, accepts only HTTPS URLs and redirects, ignores local curl configuration, and checks both the response content type and PDF signature before capture. It uses the same retries and official-host fallback as the default Python client. It does not fall back to insecure TLS or a previously captured PDF when the current download fails.

If the official endpoints are unavailable, a manually retrieved official PDF can still be supplied explicitly:

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

## Rebinding after statute changes

Refreshing statute links does not require downloading or parsing the PDFs again:

```sh
npm run secondary:rebind -- \
  --input public/data/secondary \
  --base .crawl/refresh/canonical \
  --output .crawl/refresh/canonical/secondary

npm run validate:secondary -- \
  --data .crawl/refresh/canonical/secondary \
  --base .crawl/refresh/canonical
```

Rebinding verifies the published artifact hashes and counts before rebuilding citation resolutions, title shards, reverse links, and the base-manifest binding. Printed text, integer-cent amounts, record IDs, heading order, source revisions, and source PDF hashes remain unchanged. Removed citations become unresolved; newly available citations acquire links. The output directory must be separate from the input. The corpus workflow validates the input and candidate, produces a secondary-link diff, and applies the secondary-source safety policy before creating its draft PR. A validation or policy failure still stops publication.

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

The first reviewed artifacts are published under `public/data/secondary`; future candidates remain in ignored `.crawl` staging until legal-data review approves their replacement.

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

## Automated refresh runbook

The `Review secondary sources refresh` GitHub Actions workflow runs Wednesdays at 11:43 UTC and can also be dispatched from **Actions → Review secondary sources refresh → Run workflow**. It:

1. acquires the four official PDFs into a content-addressed snapshot;
2. parses and resolves a candidate against the published canonical corpus;
3. validates schemas, provenance, hashes, counts, links, and base identity;
4. compares the candidate with `public/data/secondary` and applies `config/secondary-refresh-policy.json`;
5. runs the complete project check and, only for meaningful passing changes, creates a draft data PR without writing to `main`.

Every run retains `secondary-refresh-review-*` reports for 30 days and `secondary-refresh-sources-*` PDFs for 14 days. An unchanged run creates no branch or PR. A policy failure creates no PR and requires review of the uploaded report; legitimate threshold changes belong in a separate policy PR.

The Judicial Branch source fails closed if a hosted runner cannot retrieve a verified PDF. Inspect `acquisition.log` and the partial source artifact, then use the documented local fallback with an official manually retrieved `infractions.pdf` and submit the resulting data as a normal reviewed PR. Never substitute an unofficial mirror or disable Judicial Branch TLS verification.

Only this standalone workflow acquires new secondary-source editions. Primary corpus refreshes rebind the already-published records offline against the candidate statutes and include the link-change report in their draft PR. An unavailable Judicial or LCO PDF therefore cannot block a statute refresh. Rebinding updates artifact generation times and the base binding; it does not represent a new PDF acquisition or change the recorded source revisions.

## Reader integration

The reviewed artifacts are published under `public/data/secondary`. A statute page loads its title-level reverse-link shard on demand, then retrieves only the referenced infraction, fee-rule, and subject-index artifacts. Chart B relationships are labeled as `Fee authority` or `Affected statute`; source dates and official publication links remain visible beside the derived records.

The hash route `#/index` opens the General Statutes index. Alphabetical browsing loads only the selected letter's shards. Search derives the relevant initial letter from the query, searches that letter in memory, and caps the rendered result set at 100. Large headings render 250 entries at a time. These boundaries preserve responsive GitHub Pages behavior without a server or database.
