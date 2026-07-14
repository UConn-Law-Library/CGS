# Annual supplement overlays

Annual supplements are static, edition-scoped overlays on the reviewed current-statutes corpus. They do not create a second database, rewrite base chapter files, or imply that absence from a supplement repeals current text.

## Merge contract

For each supplement provision:

1. An exact match of the complete citation set replaces the corresponding base provision for that selected edition.
2. A citation not present in the base chapter is added in citation order.
3. A base provision absent from the supplement remains unchanged.
4. A partial overlap with a substantive grouped base provision fails import and validation because the intended replacement is ambiguous. The only narrow exception is a multi-citation placeholder whose legal text is exactly `Reserved for future use.` (optionally followed only by paragraphs labeled `Note:`); when a supplement fills one of those citations, the selected edition preserves the remaining citations as reserved rather than dropping them. An exact standalone match likewise takes precedence over an overlapping reserved placeholder, and the selected edition removes the duplicate citation from that placeholder. A grouped supplement provision may replace multiple base provisions only when its citation set is the exact, disjoint union of those complete provisions.

Applying an overlay is non-mutating in the browser. The client automatically applies the latest published edition; users do not need to choose between base and supplement corpora. Updated provisions receive `YYYY Supp.` labels, supplement text is primary, and superseded base text plus its source notes, history, and annotations remains available in a collapsed reference panel.

## Artifact layout

```text
public/data/
  catalog.json
  chapters/
  supplements/
    2026/
      manifest.json
      chapters/
        001.json
      search/
        title-01.json
```

The edition manifest records source metadata, title and chapter navigation, replacement/addition counts, and a SHA-256 digest and byte length for every overlay chapter and derived search patch. A search patch lists superseded base document IDs plus only the changed, new, or residual-placeholder documents; the browser removes those IDs from the base title shard before adding the patch. It also records the base corpus `schemaVersion`, `generatedAt`, and the SHA-256 digest of its integrity manifest. Validation independently reapplies every overlay and rejects a search patch that differs from the resulting corpus. It also rejects an edition if the base identity differs from the current base, forcing a fresh import and review after any base refresh.

`npm run build` derives `dist/data/supplements/manifest.json`, including an empty edition list when no supplements are checked in. `SupplementRepository` in `src/supplements.js` discovers the latest edition and lazily loads its chapter and search artifacts. The reviewed 2026 edition contains 1,952 overlay records representing 1,967 citations: 1,602 replacements and 350 additions.

## Review workflow

Never crawl directly into `public/data`:

```sh
python -m crawler.cgs_crawler.cli --edition supplement --supplement-year 2026 --output .crawl/supplement --snapshots .crawl/supplement-snapshots
npm run import:supplement -- --input .crawl/supplement --base public/data --output .crawl/supplement-canonical --year 2026
npm run validate:supplement -- --data .crawl/supplement-canonical --base public/data
```

Review the manifest counts and changed chapter files. Once accepted, copy the complete validated output directory to `public/data/supplements/2026`, then run `npm run check`. The ordinary validator discovers every four-digit supplement directory and verifies it during CI and deployment.

For a reviewed edition created before search patches were part of the contract, `npm run rebuild:supplement-search -- --year 2026` rebuilds only those derived shards and the manifest integrity records; it does not modify base chapters or supplement overlay chapters.

Phase 11 publishes the first official edition through this review path and makes primary-corpus refreshes re-crawl, re-import, and validate every published supplement against the candidate base before a refresh PR can be opened. Phase 12 adds the automatic consolidated reader, prior-revision reference panels, supplement-aware search, and complete offline caching.
