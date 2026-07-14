# 2026 supplement validation

## Publication decision

The official 2026 Connecticut General Statutes supplement is accepted as a year-scoped `replace-by-citation` overlay under `public/data/supplements/2026`. It does not modify or replace any file under `public/data/chapters`.

## Provenance

- Official index: `https://www.cga.ct.gov/2026/sup/titles.htm`
- Crawl completed: `2026-07-14T16:20:56Z`
- Raw content-addressed snapshots retained during review: 436
- Published titles: 59
- Published chapters: 376
- Overlay records: 1,952
- Individual citations represented: 1,967
- Replacements: 1,602
- Additions: 350

The crawl used the repository's documented CGA TLS-verification exception. Acquisition remained isolated in `.crawl`; only canonical validated JSON was copied into the public tree.

## Base binding and non-destructive boundary

The overlay manifest binds to base corpus schema `1.0.0`, generated `2026-07-14T00:27:33Z`, with base integrity-manifest SHA-256 `a97c6aaba1cc8c167927fb446ee590b069aea3286ca34ef022fc7b61351dea78`.

The independently recorded aggregate SHA-256 for the sorted base chapter filenames and bytes was `5f860eb060aa68054389d72358e23a25bc853036709790ca68a2e3aa94db8554` both before and after publication. Git also reports an empty diff for `public/data/chapters`.

## Legacy regression comparison

The prior PWA's local 2026 supplement was used only as a regression oracle; the fresh CGA crawl remained authoritative. A complete comparison produced identical results on both sides:

| Measure | Legacy PWA | Fresh official crawl |
| --- | ---: | ---: |
| Title files | 59 | 59 |
| Chapters | 376 | 376 |
| Overlay records | 1,952 | 1,952 |
| Individual citations | 1,967 | 1,967 |
| Duplicate citations | 0 | 0 |

There were no record identities found on only one side, no citations found on only one side, and no parsed provision-text differences. The legacy UI's reported total of 1,967 was therefore a citation count; grouped records explain why it exceeds the 1,952 JSON record count by 15.

## Deterministic merge cases confirmed during import

Real data exercised three bounded transformations in addition to ordinary exact replacement and addition:

1. A supplement may fill one citation from a base range whose legal text is only `Reserved for future use.`; remaining citations stay represented by a residual reserved placeholder.
2. An exact standalone base match takes precedence over an overlapping reserved placeholder caused by an over-broad base citation range; the selected view subtracts the duplicate citation from that placeholder.
3. One grouped supplement record may replace multiple base records only when its citations are the exact, disjoint union of those complete base records.

Substantive partial groups, overlapping non-reserved records, duplicate replacements, and all other ambiguous matches continue to fail import and client application.
