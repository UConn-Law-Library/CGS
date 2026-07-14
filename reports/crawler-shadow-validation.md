# Replacement crawler cutover validation

Date: 2026-07-14

The modular crawler was run read-only against live `cga.ct.gov` pages and compared, after canonical import and validation, with the initial published corpus baselines.

| Scope | Source pages | Titles | Units | Provisions | Added | Removed | Changed | Status transitions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Current statutes | 1,223 | 81 | 1,141 chapters/articles | 33,013 | 0 | 0 | 0 | 0 |
| 2026 supplement | 436 | 59 | 376 chapters | 1,952 | 0 | 0 | 0 | 0 |

Both complete source sets were replayed with networking disabled and the live generation timestamp fixed:

- All 82 current-statutes adapter files were byte-identical between live acquisition and offline replay.
- All 1,225 current-statutes canonical artifacts were byte-identical between live acquisition and offline replay.
- All 62 supplement adapter files were byte-identical between live acquisition and offline replay.
- All 438 supplement canonical artifacts were byte-identical between live acquisition and offline replay.

Every canonical output passed schema, reference, aggregate, and SHA-256 validation. The complete corpus diffs reported no additions, removals, content or metadata changes, moves, or status transitions. The legacy repository remained clean throughout.

Representative pre-cutover checks additionally covered ordinary chapters, grouped/status fixtures, future-effective text fixtures, fragment mismatch fixtures, multi-letter chapter fixtures, UCC article hierarchy, supplement overlays, retries, offline failure behavior, and transactional rollback.

The full shadow-crawl gate is satisfied. Current `public/data` was regenerated from the reviewed replacement-crawler output; supplement publication remains a separate product decision because the Pages client does not yet expose supplement overlays.
