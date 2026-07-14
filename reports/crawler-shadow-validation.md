# Replacement crawler shadow validation

Date: 2026-07-13

The modular crawler was run read-only against live `cga.ct.gov` pages and compared, after canonical import and validation, with the initial published corpus baseline.

| Scope | Source pages | Units | Provisions | Added | Removed | Changed | Status transitions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Current Title 1 | 27 | 25 chapters | 344 | 0 | 0 | 0 | 0 |
| Current Title 42a | 14 | 12 articles | 662 | 0 | 0 | 0 | 0 |
| 2026 Supplement Title 1 | 8 | 6 chapters | 8 | 0 | 0 | 0 | 0 |

Title 1 was also replayed entirely from content-addressed snapshots with networking disabled. The live and replayed `title_01.json` and `titles_index.json` files were byte-identical.

All three shadow outputs passed canonical schema, reference, aggregate, and SHA-256 validation. The legacy repository remained clean throughout.

This is a representative shadow validation, not yet a full-corpus crawler cutover. It covers ordinary chapters, grouped/status fixtures, future-effective text fixtures, fragment mismatch fixtures, multi-letter chapter fixtures, UCC article hierarchy, supplement overlays, retries, offline replay, and transactional rollback. A complete 81-title shadow crawl and reviewed corpus diff remain the cutover gate.
