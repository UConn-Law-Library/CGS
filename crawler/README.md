# CGS crawler

This build-time crawler replaces the legacy `ct_CGS_Crawl-v2.py` and `ct_CGS_Supplement_Crawl.py` scripts. It never runs in the GitHub Pages application and never writes to the legacy repository.

## Architecture

1. `fetch.py` applies polite delays, retry/backoff, content checks, and TLS policy.
2. `snapshots.py` stores the exact response bytes by SHA-256 and maps source URLs to captures. Offline mode fails closed if any page is absent.
3. `parsing.py` turns CGA title, chapter/article, and provision markup into the documented legacy adapter shape.
4. `pipeline.py` validates a complete staged crawl and atomically publishes its directory. A failed crawl leaves the last output untouched.
5. `scripts/import-legacy.mjs` converts that adapter output into the canonical chapter contract.

Current statutes and annual supplements use the same implementation. Supplement mode also emits `supplement_index.json` and `supplement_map.json` for compatibility.

## Install

The website and canonical pipeline remain dependency-free. Only crawler development requires Python packages:

```sh
python -m pip install -r crawler/requirements.txt
```

## Current statutes

Start with one title and a dedicated working directory:

```sh
python -m crawler.cgs_crawler.cli --titles 1 --output .crawl/legacy --snapshots .crawl/snapshots
npm run import:legacy -- --input .crawl/legacy --output .crawl/canonical
node scripts/validate.mjs --data .crawl/canonical --schemas schemas
```

After reviewing the partial run, omit `--titles` for a full crawl. The full crawler validates plausible title, chapter, and provision totals before replacing its output.

## Supplement

```sh
python -m crawler.cgs_crawler.cli --edition supplement --supplement-year 2026 --output .crawl/supplement --snapshots .crawl/supplement-snapshots
```

## Offline replay

Every successful network response is captured. Replay the parser without contacting CGA:

```sh
python -m crawler.cgs_crawler.cli --offline --titles 1 --output .crawl/replay --snapshots .crawl/snapshots --generated-at 2026-07-13T13:33:18Z
```

Given identical snapshots and `--generated-at`, adapter and canonical outputs are deterministic.

## Refresh review

Never crawl directly into `public/data`. The review sequence is:

```sh
python -m crawler.cgs_crawler.cli --output .crawl/legacy --snapshots .crawl/snapshots
npm run import:legacy -- --input .crawl/legacy --output .crawl/canonical
node scripts/validate.mjs --data .crawl/canonical --schemas schemas
npm run diff:corpus -- --before public/data --after .crawl/canonical --markdown .crawl/corpus-diff.md --json .crawl/corpus-diff.json
```

Only replace `public/data` after the validation and corpus diff are reviewed.

For production, the manually dispatched `Review corpus refresh` workflow performs this sequence and opens a draft pull request when meaningful changes pass the committed safety policy. Raw snapshots and review reports are retained as temporary Actions artifacts. Operational instructions are in [`docs/corpus-refresh.md`](../docs/corpus-refresh.md).

For a shadow crawl of selected titles, pass the same title list to the diff so unselected titles are not reported as removals:

```sh
npm run diff:corpus -- --before public/data --after .crawl/canonical --titles 1,42a
```
