# Edition rollover and archives

CGA publishes a full revision of the General Statutes in odd-numbered years and a Supplement in even-numbered years. A supplement is read with the revision published the year before it, and the next revision contains everything the supplement changed. This runbook covers what happens when the next revision replaces the current one, and how earlier editions stay available.

The first real rollover is expected when CGA publishes the **2027 revision**: the app then archives the **2025 revision with the 2026 Supplement** and switches the current reader to 2027.

## What is kept, and where

```text
public/data/
  catalog.json, manifest.json, chapters/, search/   the active revision
  supplements/<year>/                               the supplement read with it, when published
  acts/                                             every published session, never removed
  editions/
    statutes/<revision year>/                       one archived edition per superseded revision
      edition.json                                  the archive record (see below)
      catalog.json, manifest.json, chapters/, search/
      supplements/<year>/                           its supplement, unchanged
    published.json                                  the reviewed list of published editions (the guide reads it)
    secondary/<kind>/<edition id>/                  superseded subject-index and infractions editions
    secondary/sources/<sha256>.pdf                  source PDFs kept by digest
```

An archived edition is the published files, byte for byte. Nothing is re-imported or rewritten. `edition.json` records:

- the label, revision year, supplement years, and the last year of legislation the pair covers (`legislationThrough`);
- the base's `generatedAt`, capture time, source URL, and the SHA-256 of its `catalog.json` and `manifest.json` (which in turn hash every chapter and search shard);
- each supplement's `generatedAt`, capture time, source URL, counts, and manifest SHA-256 (which hashes its overlay chapters and search patches, and binds them to the archived base);
- the revision that superseded it (`supersededBy`: year, `generatedAt`, manifest SHA-256);
- `officialSources`, which maps CGA's `/current/pub/` URLs in the archived chapters to that edition's own `/<year>/pub/` pages. The archived bytes keep the URL they were captured from; the reader applies the mapping.

`npm run validate` checks every archive: the record's schema (`schemas/statute-edition.schema.json`) and hashes, the full base validator and the supplement validator run against the archive itself, that each archived supplement is the one read with that revision, and that an archive is older than the active revision.

### Storage and size

Archives live in the repository under `public/data/editions` and are published with the site, so they never depend on Actions artifacts. Because an archive copies files that are already in Git history, it adds no new Git objects.

The published site is about 375 MB before any archive. The build leaves archived search shards out of `dist` (they stay in the repository, so the archive's own manifests still verify), which puts one archived edition at roughly 170 MB of chapter and supplement files. GitHub Pages limits a site to 1 GB, so the site holds about three archived editions before the oldest needs another home. Each archive is self-contained under `editions/statutes/<year>/`, and the reader finds it through the derived `data/editions/manifest.json`, so moving an old archive to a second Pages repository on the same origin changes only that index's `path`, not any shared link.

The full offline download in Settings covers only the current edition. Archived pages that a reader has opened stay in the browser's runtime cache.

## Links

| Route | Opens |
| --- | --- |
| `#/editions` | the current edition and every archived edition |
| `#/editions/2025` | the archived 2025 edition's titles |
| `#/editions/2025/t/1/c/001/s/1-1` | an archived section; `/p/a` targets a subsection |
| `#/t/1/c/001/s/1-1` | always the current text |

Current routes do not change at a rollover: a link to `#/t/…` opens the new revision. An archived link always opens the same edition. Bookmarks and History keep archived and current sections apart.

On an archived page, every statute link stays in that edition: breadcrumbs, panes, the chapter sheet, previous and next, and cross-references in the text (resolved against that edition's own citations; one that the edition doesn't contain is plain text, not a link to the current search). The notice at the top names the edition and links to the current text and to all editions. Act notices, statute search, and the subject index and infractions links describe the current statutes, so they are left out.

## How a rollover runs

Nothing is triggered by hand. The weekly `Review corpus refresh` workflow crawls `/current/pub/`, and the crawler reads the edition from the titles page ("Revised to January 1, 2027"). When the candidate is a newer revision than the published one:

1. The usual import, validation, corpus diff, and safety policy run. A revision changes two years of legislation; see [the policy note](corpus-refresh.md#a-new-full-revision).
2. **Carry forward and archive editions** (`scripts/rollover-edition.mjs`) validates the published revision and the supplements the new revision supersedes, exactly as published, and copies them into the candidate under `editions/statutes/<outgoing year>/` with `edition.json`. It also carries every existing archive into the candidate. It runs on every refresh, so an ordinary refresh never drops an archive, and staging refuses a candidate that lost the editions directory.
3. The supplement step retires the superseded supplement from the current statutes (it is now in the archive) and rebinds any newer one.
4. Secondary sources are rebound to the new revision.
5. `npm run check` runs on the staged candidate, including archive validation.
6. The publish job updates the rolling `automation/corpus-refresh` branch and its draft pull request. The description has an **Edition rollover** section with the archived edition, its hashes and counts, and a **Retired supplements** section.

The same pull request therefore archives the outgoing edition and switches the current reader. Acts sessions the new revision covers move to Past sessions on their own (see [docs/acts.md](acts.md#past-sessions)); nothing in `public/data/acts` changes.

### Safe to rerun

- The rollover writes only into the candidate under `.crawl`. If archive or candidate validation fails, the job stops before staging, nothing is pushed, and the published site and data are unchanged.
- The archive record has no wall-clock fields, so two runs on the same inputs write the same bytes. A rerun after an earlier attempt finds an identical archive and leaves it; an archive with different bytes stops the run rather than being replaced.
- Reruns update the same rolling branch and pull request instead of opening another.
- Once the rollover merges, the published revision is the new one, so the next refresh carries the archive forward and archives nothing.

## Rehearse a rollover

Before CGA publishes 2027, rehearse with the checked-in fixture or a real earlier edition pair.

Fixture (seconds; this is what CI's browser tests serve):

```sh
node scripts/build-edition-fixture.mjs --output .crawl/browser-editions
node scripts/build-site.mjs --editions-overlay .crawl/browser-editions/candidate/editions
npm run dev    # then open http://localhost:4173/CGS/#/editions
```

A real earlier pair (the 2023 revision with the 2024 Supplement, rolled over to the published 2025 revision). The crawls take about an hour together:

```sh
python -m crawler.cgs_crawler.tls --output .crawl/ca-bundle.pem
python -m crawler.cgs_crawler.cli --edition revision --revision-year 2023 --output .crawl/rehearsal/legacy-2023 --snapshots .crawl/rehearsal/snapshots-2023 --ca-bundle .crawl/ca-bundle.pem
python -m crawler.cgs_crawler.cli --edition supplement --supplement-year 2024 --output .crawl/rehearsal/legacy-2024 --snapshots .crawl/rehearsal/snapshots-2024 --ca-bundle .crawl/ca-bundle.pem
node scripts/rehearse-rollover.mjs --revision .crawl/rehearsal/legacy-2023 --supplement .crawl/rehearsal/legacy-2024 --output .crawl/rehearsal/run
```

`rehearse-rollover.mjs` imports the older pair as the "published" data, uses `public/data` as the candidate, runs the same `rolloverEdition` the workflow runs (twice, to confirm the rerun is a no-op), validates the result, and writes a site-ready `editions` directory. Serve it with `node scripts/build-site.mjs --editions-overlay .crawl/rehearsal/run/candidate/editions`.

## Review a rollover pull request

1. Read the **Edition rollover** section. The archived year, supplement years, and manifest hashes must match what `main` publishes now (`sha256sum public/data/manifest.json public/data/supplements/*/manifest.json` on `main`).
2. Confirm `public/data/editions/statutes/<year>/` contains only `edition.json` and renamed copies of the published files: `git diff --stat main -- public/data/editions` lists them as additions, and `git diff -M main --summary` shows the old supplement directory as a rename into the archive.
3. Review the corpus diff, the supplement retirement, and the secondary-source rebind as for any refresh.
4. Check the draft's CI run, then on the preview or a local build: open `#/editions`, an archived section with a supplement change (Compare tab), a current section with the same citation, and a statute search.
5. Confirm the new revision's titles page on cga.ct.gov, then mark the pull request ready.

## Publish

Merging into `main` deploys through the normal Pages workflow. No separate step publishes the archive.

## Roll back

Revert the rollover's merge commit in a pull request. That restores the previous revision and its supplement as current and removes the archive in one change. Because each archive is identical to files in Git history, a later rollover recreates the same bytes.

To undo only an archive (for example, one created by mistake) while keeping the current revision, remove `public/data/editions/statutes/<year>` in a reviewed pull request. Shared links to it then show "No archived <year> edition is available."

## What still depends on CGA

- **Timing.** The refresh workflows run only from `main`. Until this work is merged there, the `main` workflow that sees the 2027 revision retires the 2026 Supplement by deleting it, with no archive, and the Acts list still expects sessions to be retired by hand. Merge this before CGA publishes 2027 (normally early in the year), or hold the first 2027 refresh pull request until it is merged.

- The 2027 revision: the workflow detects it from `/current/pub/titles.htm`. Before the first refresh after it appears, settle the chapter-metadata limit in `config/corpus-refresh-policy.json` in its own reviewed pull request, as [docs/corpus-refresh.md](corpus-refresh.md#a-new-full-revision) describes.
- The `/2025/pub/` pages that archived "Official source" links point to. CGA serves `https://www.cga.ct.gov/2025/pub/titles.htm` today; check it still does when reviewing the rollover.
