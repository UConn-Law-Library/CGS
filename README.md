# CGS

A database-free, GitHub Pages-only platform for publishing and searching the Connecticut General Statutes.

The repository turns the legacy title-level JSON export into versioned, canonical, chapter-level artifacts. The browser reads those static artifacts directly; there is no API server, database, hosted search service, or runtime build step.

## Quick start

Requirements: Node.js 24 or newer. The static platform has no npm dependencies. Crawler and PDF-ingestion tests additionally require Python 3.12 and the packages in `crawler/requirements.txt`.

```sh
npm ci
python -m pip install -r crawler/requirements.txt
npm run check
npm run dev
```

`npm run check` validates every checked-in artifact, runs the tests, and assembles `dist/` exactly as GitHub Pages will serve it. Use `npm run check:fixture` to first replace `public/data/` with the small legacy fixture.

## Import the complete legacy corpus

The old repository is an input only. This command reads it and replaces this repository's generated `public/data/` directory; it does not write to the legacy repository.

```sh
npm run import:legacy -- --input ../uconn-law-library.github.io/CT-Statutes/data --output public/data
npm run validate
npm run build
```

For a reproducible build, pass `--generated-at 2026-07-13T13:33:18Z`. Otherwise the importer uses the timestamp in `titles_index.json`, then `SOURCE_DATE_EPOCH`, then the current time.

## Artifact contract

- `public/data/catalog.json`: title and chapter navigation metadata.
- `public/data/chapters/<chapter>.json`: canonical chapter content; this is the primary durable unit.
- `public/data/search/manifest.json`: discoverable search-shard metadata.
- `public/data/search/title-<title>.json`: compact title-level full-text search documents.
- `public/data/manifest.json`: corpus counts plus SHA-256 and byte size for every generated artifact.
- `public/data/supplements/<year>/manifest.json`: an optional, immutable annual-overlay manifest bound to one reviewed base corpus.
- `public/data/supplements/<year>/chapters/<chapter>.json`: only the provisions published in that supplement.
- `public/data/secondary/infractions/`: optional title-sharded Judicial Branch Chart A entries and Chart B fee rules.
- `public/data/secondary/statutes-index/`: optional size-bounded LCO subject-index shards.
- `public/data/secondary/links/`: derived statute-to-infraction and statute-to-index reverse links.
- `schemas/*.schema.json`: the canonical JSON Schema contracts.

The checked-in `public/data/` is the complete production baseline: 81 titles, 1,141 chapters, and 33,013 provisions, regenerated from the reviewed replacement crawler on July 14, 2026. The much smaller `fixtures/legacy/` corpus remains available for isolated importer tests and local pipeline experiments.

See [ARCHITECTURE.md](ARCHITECTURE.md) for design constraints, invariants, and the migration path.

## Reader routes

The static client uses stable hash routes so deep links work on GitHub Pages without server-side rewrites:

- `#/t/01` opens Title 1.
- `#/t/01/c/001` opens Chapter 1.
- `#/t/01/c/001/s/1-1` opens Section 1-1.
- `#/t/01/c/001/s/1-1/p/a` focuses subsection (a).

Older `?chapter=001&section=section-1-1` links are translated to the canonical route in the browser. Search results, adjacent-section navigation, breadcrumbs, and recognized section or chapter references all use the same route contract.

## Search execution

Title-scoped and all-title searches use the same static search shards. The client loads up to six title shards concurrently and sends each completed shard to a Web Worker, which continuously merges a deterministic top-result set. The interface displays results and progress as shards arrive, cancels stale work when a new search or route begins, and falls back to incremental main-thread ranking when workers are unavailable.

The global omnibar debounces input and displays mixed quick results while the user types. Title and chapter matches come from the already-loaded catalog, statute sections stream from the progressive worker search, infractions use the cached schedule shards, and index suggestions load only the relevant initial-letter shard. Arrow keys choose a result, Escape closes the panel, Enter opens the selected result or the complete statute-results page, and `/` focuses the omnibar outside another form field.

## Static discovery pages

`npm run build` generates a script-free discovery hierarchy at `dist/discover/`: one all-title index, one page per title, and one page per chapter. Chapter pages expose every provision heading, link to the official CGA text, and link into the interactive hash reader. The same build writes `sitemap.xml` and `robots.txt`; these outputs are derived from the canonical catalog and chapter artifacts and are not checked in.

The sitemap defaults to `https://uconn-law-library.github.io/CGS/`. Set `CGS_SITE_URL` when building for another production origin or base path.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run import:fixture` | Rebuild `public/data/` from the checked-in fixture |
| `npm run import:legacy -- --input <dir>` | Import a legacy title-JSON directory |
| `npm run import:supplement -- --input <dir> --base public/data --output <dir> --year <yyyy>` | Import an annual supplement as a reviewed, year-scoped overlay |
| `npm run secondary:acquire -- --output <dir>` | Capture the three LCO index PDFs and Judicial Branch infractions PDF by content hash; use `--no-cga-ssl-verify` only for the documented CGA chain issue |
| `npm run secondary:import -- --sources <manifest> --base public/data --output <dir>` | Parse, resolve, shard, and bind the secondary datasets to the canonical corpus |
| `npm run diff:secondary -- --before <dir> --after <dir> --json <file> --markdown <file>` | Produce bounded, deterministic secondary-source change reports |
| `npm run review:secondary -- --report <file> --policy config/secondary-refresh-policy.json` | Enforce count, removal, and citation-resolution safety thresholds |
| `npm run diff:corpus -- --before <dir> --after <dir> [--titles 1,42a]` | Report corpus additions, removals, edits, moves, and status transitions |
| `npm run review:refresh -- --report <diff.json> --policy config/corpus-refresh-policy.json` | Apply the versioned production-refresh safety policy |
| `npm run crawl -- --titles 1 --output .crawl/legacy --snapshots .crawl/snapshots` | Crawl current CGA source into an isolated legacy-adapter directory |
| `npm run validate` | Validate schemas, references, counts, and content hashes |
| `npm run validate:supplement -- --data <dir> --base public/data` | Validate one supplement and its base-corpus binding |
| `npm run validate:secondary -- --data <dir> --base public/data` | Validate secondary-source schemas, links, counts, hashes, and base binding |
| `npm test` | Run importer, validator, and client search tests |
| `npm run build` | Assemble the GitHub Pages artifact in `dist/` |
| `npm run dev` | Serve `dist/` locally at `http://localhost:4173` |
| `npm run check` | Run the complete CI verification sequence |
| `npm run check:fixture` | Rebuild fixture data, then run the complete verification sequence |

## Review a data refresh

Keep the previously published `public/data/` directory available, import the new snapshot into a separate directory, and generate both human- and machine-readable reports:

```sh
npm run import:legacy -- --input <legacy-data> --output .refresh/data
npm run validate -- --data .refresh/data
npm run diff:corpus -- --before public/data --after .refresh/data --markdown .refresh/corpus-diff.md --json .refresh/corpus-diff.json
```

The diff uses citations as stable identities, so a provision moved to another chapter is reported as a location change instead of a removal and addition.

Production refreshes use the weekly and manually dispatchable `Review corpus refresh` GitHub Actions workflow. It performs a complete crawl, retains replayable raw snapshots as temporary artifacts, validates a staged canonical corpus, enforces the committed safety policy, and opens a draft data pull request only when meaningful changes exist. See [docs/corpus-refresh.md](docs/corpus-refresh.md) for the three-run reliability record, prerequisites, and review runbook.

## Crawler

The replacement crawler lives in [`crawler/`](crawler/README.md). It separates network acquisition, content-addressed raw snapshots, offline replay, HTML parsing, transactional publication, and canonical import. Current statutes and supplements share one CLI; the crawler remains a build-time tool and is not included in the Pages runtime.

## Annual supplements

Supplements are opt-in, immutable overlays rather than destructive edits to the current-statutes corpus. A provision with the same complete citation set replaces that base provision for the selected edition; a new citation is added. A missing citation never deletes current law, and a partial match against a grouped provision fails validation instead of guessing.

Each edition records the exact base schema version and generation timestamp it was reviewed against. A later base refresh therefore requires the overlay to be re-imported and reviewed before publication. The build derives `data/supplements/manifest.json` so the client can discover available editions without a server or database. See [docs/supplements.md](docs/supplements.md) for the artifact contract and review workflow.

## Infractions and General Statutes index

The Phase 7 pipeline migrates the legacy PDF geometry parsers into deterministic, content-addressed ingestion for the official Judicial Branch infractions schedule (Charts A and B) and the three-volume LCO subject index. The reviewed artifacts are published under `public/data/secondary`. Statute pages lazily display linked schedule entries, fee-rule roles, and subject-index records; `#/index` provides alphabetical browsing and letter-scoped client search without a database. Phase 9 adds a weekly, manually dispatchable `Review secondary sources refresh` workflow that retains source PDFs and opens a draft PR only after validation, a bounded diff, and the committed safety policy pass. See [docs/secondary-sources.md](docs/secondary-sources.md) for commands, provenance, artifact contracts, and the refresh runbook.

## Mobile application interface

The interactive client uses a mobile-first application shell modeled on the established CT Statutes navigation: **Statutes**, **Index**, **Infractions**, **Bookmarks**, and **Settings**. Phones keep these destinations in a persistent bottom navigation bar; larger screens place the same navigation in the header. Infractions can be browsed independently by schedule category, while statute sections and individual infractions can be bookmarked locally on the device. Theme, text-size, and list-density preferences are also device-local and require no account or database.

The same static client is installable as a PWA. Its service worker caches the application shell and recently viewed data automatically. Settings exposes an explicit download for the complete published statutes, search, index, and infractions dataset, along with refresh and removal controls. Full downloads are staged in a separate cache and promoted only after every published artifact succeeds, so an interrupted refresh preserves the previous complete copy and can be retried. The production build fingerprints the complete shell and install icons so installed clients can offer a reload when a new version takes control, and Settings reports browser-provided storage usage and quota when available. All offline data stays in the browser cache; it is derived from the published JSON artifacts and does not introduce a database or hosting service.

## Data authority

This project is an access layer, not the official legal source. Canonical artifacts retain source URLs so the interface can link back to the Connecticut General Assembly publication.
