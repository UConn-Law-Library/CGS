# Repository improvements: implementation and validation

Implemented against `ac9f560`, retaining GitHub Pages, existing hash routes, device-local storage, and reviewed data publication.

## Changes

| Priority | Implementation |
| --- | --- |
| Startup recovery | Shared catalog requests clear on failure; retry sends a new request. |
| Bookmark persistence | Writes report persistence status, failed writes retain a temporary copy, and the UI explains reload/close behavior. |
| Static guide | Correct supplement-year detection; visible one-page link after the interactive introduction and a direct JavaScript-disabled fallback. Both versions report the 2026 Supplement. |
| Offline recovery | Bounded fetches, verified cached fallback, and a release fingerprint covering every JSON dataset and derived index. Tabs pin their requests to their generation. |
| Reader readiness | Chapter and supplement determine initial text; amendment notices, citation destinations, and related records populate independently. Loading/unavailable states remain explicit. |
| Lookup performance | Exact citations use citation maps; suggestions use generated heading shards. Full Boolean/body search stays on the search page. Both worker and inline pagination reuse completed results. |
| Portability and modules | Local JSON bookmark export/import; extracted shell/settings, About and Bookmark route views, and bookmark/autocomplete controllers. |
| Authenticated acquisition | Reviewed intermediate certificate and CA-bundle builder; production workflows verify TLS and reject insecure overrides. |
| Supplement review | Separate citation/content/classification diffs, text previews in PR summaries, full before/after artifacts, and removal/reclassification policy gates. Discovery uses the reader's overlay algorithm. |
| Quality | Complete Python version lock, Firefox/WebKit smoke projects, and accessibility checks for every detected WCAG A/AA violation. |

## Performance comparison

Local Chromium, fresh browser contexts, service workers blocked, identical published data. The baseline served frontend modules from `ac9f560`; the candidate served the current build. Resource Timing measured decoded (uncompressed) response bodies after entering `public records`. These are illustrative local measurements, not production latency guarantees.

| Measurement | Before | After |
| --- | ---: | ---: |
| All autocomplete data requests | 202 | 141 |
| All autocomplete data bytes | 86,987,180 | 9,052,875 |
| Statute-search data bytes | 70,302,165 | 3,816,481 |
| Reader text ready, with amendment request delayed by 2 seconds | 2,534 ms | 335 ms |

The total includes acts, infractions, and index suggestions. Exact statute citations avoid heading and full-body shards. The delayed-reader regression holds the amendment response until after the text is visible, then verifies an explicit unavailable notice on failure.

## Verification

- Canonical corpus validation passes for 81 titles, 1,143 chapters, 33,017 provisions, one supplement, secondary sources, and 185 acts.
- 220 JavaScript tests pass, including catalog retry, temporary bookmarks/import validation, worker and inline pagination, independent dataset fingerprints, HTTP-error/timeout fallback, generation isolation, supplement text/removal/classification gates, and supplement-aware discovery.
- All 84 Python tests pass using the locked dependencies on Python 3.12.14 (53 crawler, 31 secondary-source tests).
- The complete browser suite passes: 220 tests, with 12 intentional project-specific skips, across desktop/mobile Chromium and Firefox/WebKit smoke projects.
- A live request to the official CGA titles page succeeds with certificate verification enabled using the reviewed bundle.
- Desktop/mobile checks cover both guide links, JavaScript disabled, and the `/CGS/` deployment path. Screenshots were inspected; the mobile reader baseline was updated for the provenance and amendment-status text.
- Firefox and WebKit smoke checks cover navigation, search, bookmarks, dialogs, and offline recovery. On Windows, the WebKit offline test stops a dedicated local server because Playwright's offline emulation also blocks worker responses in that engine.

Older complete offline downloads require repair after updating to the new data format. They remain stored until a replacement succeeds; a new shell never combines their artifacts with a different generation. No published corpus files were changed by this implementation.
