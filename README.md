# CGS

A database-free, GitHub Pages-only platform for publishing and searching the Connecticut General Statutes.

The repository turns the legacy title-level JSON export into versioned, canonical, chapter-level artifacts. The browser reads those static artifacts directly; there is no API server, database, hosted search service, or runtime build step.

## Quick start

Requirements: Node.js 22 or newer. The static platform has no npm dependencies. Crawler tests additionally require Python 3.12 and the packages in `crawler/requirements.txt`.

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
- `schemas/*.schema.json`: the canonical JSON Schema contracts.

The checked-in `public/data/` is the complete production baseline: 81 titles, 1,141 chapters, and 33,013 provisions, regenerated from the reviewed replacement crawler on July 14, 2026. The much smaller `fixtures/legacy/` corpus remains available for isolated importer tests and local pipeline experiments.

See [ARCHITECTURE.md](ARCHITECTURE.md) for design constraints, invariants, and the migration path.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run import:fixture` | Rebuild `public/data/` from the checked-in fixture |
| `npm run import:legacy -- --input <dir>` | Import a legacy title-JSON directory |
| `npm run diff:corpus -- --before <dir> --after <dir> [--titles 1,42a]` | Report corpus additions, removals, edits, moves, and status transitions |
| `npm run crawl -- --titles 1 --output .crawl/legacy --snapshots .crawl/snapshots` | Crawl current CGA source into an isolated legacy-adapter directory |
| `npm run validate` | Validate schemas, references, counts, and content hashes |
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

## Crawler

The replacement crawler lives in [`crawler/`](crawler/README.md). It separates network acquisition, content-addressed raw snapshots, offline replay, HTML parsing, transactional publication, and canonical import. Current statutes and supplements share one CLI; the crawler remains a build-time tool and is not included in the Pages runtime.

## Data authority

This project is an access layer, not the official legal source. Canonical artifacts retain source URLs so the interface can link back to the Connecticut General Assembly publication.
