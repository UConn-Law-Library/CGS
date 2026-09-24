# Repository map

This map covers the repository's production data paths, browser behavior, build outputs, automation, and supporting code. Arrows mean "produces," "loads," or "controls" as labeled; they do not imply that a build-time tool runs in the browser. The many chapter, search, and index shards are represented by their directories rather than by individual files.

## 1. Source acquisition and published data

```mermaid
flowchart TD
  subgraph statute_acquisition["Statute acquisition"]
    direction TB
    cga[(CGA statute pages)] -->|current statutes and supplements| crawler["Python crawler<br/>crawler/cgs_crawler/"]
    crawler -->|captures source bytes| html["Replayable HTML snapshots<br/>temporary .crawl/ artifacts"]
    html -.->|offline parser replay| crawler
    crawler -->|parses| adapter["title_*.json and titles_index.json<br/>temporary legacy adapter format"]
  end

  subgraph base_data["Base statute data"]
    direction TB
    base_import["Base importer<br/>scripts/import-legacy.mjs"] --> base["public/data/<br/>catalog, chapters, search, manifest"]
  end

  subgraph annual_supplements["Annual supplements"]
    direction TB
    supp_import["Supplement importer<br/>scripts/import-supplement.mjs"] --> supp["public/data/supplements/YYYY/<br/>manifest, overlay chapters, search patches"]
  end

  subgraph secondary_sources["Secondary sources"]
    direction TB
    official_pdf[(Judicial Branch and LCO PDFs)] --> acquire["PDF acquisition and snapshots<br/>secondary_sources/acquisition.py"]
    acquire --> pdf["Captured PDFs and source manifest<br/>temporary .crawl/ artifacts"]
    pdf --> parsers["Infractions and index parsers<br/>secondary_sources/*_parser.py"]
    parsers --> secondary_pipeline["Secondary publication<br/>secondary_sources/pipeline.py"]
    secondary_pipeline --> secondary["public/data/secondary/<br/>infractions, statutes-index, links, manifest"]
  end

  subgraph historical_inputs["Historical and test inputs"]
    old[(Previous repository's JSON)]
    fixture["fixtures/legacy/<br/>small test input"]
  end

  adapter -->|current statutes| base_import
  adapter -->|annual supplement| supp_import
  base -->|base identity and chapter matches| supp_import
  base -->|resolves citations and binds revision| secondary_pipeline
  old -.->|optional manual migration input only| base_import
  fixture -.->|importer tests and experiments| base_import
```

The old repository is not an input to scheduled refreshes or the website. The current crawler still emits its **JSON shape** as a temporary adapter, which the base and supplement importers consume. The published [base statute data](../public/data/) is checked in; the [2026 supplement](../public/data/supplements/2026/) and [secondary sources](../public/data/secondary/) are separate published artifacts. Source snapshots and candidate directories under `.crawl/` are staging and review evidence, not browser data.

## 2. Browser and offline paths

```mermaid
flowchart TD
  reader((Reader)) --> shell["Application shell<br/>src/app.js"]

  subgraph statutes["Statute reading"]
    direction TB
    routes["Hash routes<br/>src/routes.js"] --> view["Chapter reading and links<br/>src/reader.js"]
    catalog["Base catalog<br/>data/catalog.json"] -->|finds chapter path| chapters["Base chapters<br/>data/chapters/"] --> view
    supp_data["Supplement artifacts<br/>data/supplements/"] --> supp_repo["Supplement loading and overlay<br/>src/supplements.js<br/>src/supplement-overlay.js"] -->|consolidated chapter| view
    supp_repo --> diff["Prior-revision display<br/>src/revision-diff.js"]
  end

  subgraph secondary["Secondary sources"]
    direction TB
    secondary_data["Infractions, index, reverse links<br/>data/secondary/"] --> secondary_repo["Secondary repository<br/>src/secondary-sources.js"] --> secondary_ui["Rendering and lookup<br/>src/secondary-ui.js"]
  end

  subgraph search["Search and suggestions"]
    direction TB
    search_client["Progressive search<br/>src/search-client.js"] --> search_repo["Search loading and ranking<br/>src/search.js"]
    search_client --> worker["Background search<br/>src/search-worker.js"] -->|shared ranking code| search_repo
    search_inputs["Base shards: data/search/<br/>Extended fields: data/search-v2/"] --> search_repo
    search_repo --> highlight["Excerpts and highlighting<br/>src/search-highlight.js"]
    search_repo --> omni["Omnibar suggestions<br/>src/omnisearch.js"]
  end

  local["Local state and interface<br/>src/device-state.js · navigation-history.js<br/>src/dialog.js · context-navigation.js<br/>src/release.js · site-updates.js"]

  subgraph offline["Install and offline access"]
    direction TB
    pwa["Install, download, status controls<br/>src/pwa.js"] --> sw["Service worker<br/>src/service-worker.js"]
    manifests["Published artifact manifests<br/>base, supplements, secondary"] --> sw
    sw --> integrity["SHA-256 and byte checks<br/>src/offline-integrity.js"]
    sw --> cache[(Browser caches)]
  end

  shell --> routes
  shell --> catalog
  shell --> supp_repo
  shell --> secondary_repo
  shell --> search_client
  shell --> omni
  shell --> local
  shell --> pwa
  catalog --> omni
  secondary_repo --> omni
  supp_repo -->|search patch| search_repo

  %% These invisible links stack the groups without asserting data flow.
  routes ~~~ secondary_repo
  secondary_repo ~~~ search_client
  search_client ~~~ local
  local ~~~ pwa
```

The browser loads only the artifacts it needs for a route or search. The latest published supplement overlays base chapters and search results in memory; it does not rewrite the base files. Bookmarks, preferences, and history remain in browser storage. The service worker manages the application shell, visited data, and an explicitly downloaded full set of published data. The separate [commit feed](../public/commit-feed/) is a standalone page that reads the GitHub commits API; it is not the app's embedded, build-time recent-updates list. The app also requests the latest completed refresh-run status from the GitHub Actions API and offers an optional feedback form that submits to FormSubmit; neither service supplies statute content.

## 3. Validation, refresh, build, and deployment

```mermaid
flowchart TD
  subgraph statute_refresh["Statute data refresh"]
    direction TB
    base_refresh["Review workflow<br/>.github/workflows/refresh-corpus.yml"] --> crawl["Crawl and snapshot CGA pages"]
    crawl --> candidate["Import candidate base statute data"]
    candidate --> base_validate["Schema, references, counts, hashes<br/>scripts/validate.mjs"]
    base_validate --> statute_diff["Statute data diff and safety policy<br/>diff-corpus.mjs, check-corpus-refresh.mjs"]
    statute_diff -->|meaningful passing change| rebind["Rebind published secondary links<br/>secondary_sources/cli.py rebind"]
    statute_diff -->|meaningful passing change| recrawl_supp["Recrawl and reimport each published supplement"]
    rebind --> staged_base["Stage complete public/data candidate"]
    recrawl_supp --> staged_base
  end

  subgraph secondary_refresh_group["Secondary-source refresh"]
    direction TB
    secondary_refresh["Review workflow<br/>.github/workflows/refresh-secondary.yml"] --> pdf_acquire["Capture official PDFs"]
    pdf_acquire --> secondary_candidate["Import and validate secondary candidate"]
    secondary_candidate --> secondary_diff["Secondary diff and safety policy<br/>diff-secondary.mjs, check-secondary-refresh.mjs"]
    secondary_diff -->|meaningful passing change| staged_secondary["Stage public/data/secondary candidate"]
  end

  subgraph review_ci["Verification and review"]
    direction TB
    refresh_check["npm run check<br/>validate, Node tests, Python tests, build"] --> draft["Draft data pull request and explicit CI run"]
    draft -->|review and merge| main[(main branch)]
    pr[(Pull request or non-main push)] --> ci["CI workflow<br/>.github/workflows/ci.yml"]
    ci --> ci_check["npm run check"] --> ci_browser["Playwright browser checks"]
  end

  subgraph production["Production build and deployment"]
    direction TB
    deploy["Deploy Pages workflow<br/>.github/workflows/deploy-pages.yml"] --> production_check["Production npm run check"]
    deploy --> browser_tests["Playwright browser checks"]
    production_check --> build["scripts/build-site.mjs"]
    build --> dist["dist/<br/>copied app and public data"]
    build --> derived["Discovery HTML, sitemap, robots,<br/>supplement index, search-v2 shards,<br/>release/update stamp, PWA build ID"]
    derived --> dist
    production_check --> release["Patch tag and GitHub release"]
    browser_tests --> release
    release --> publish["Pages deployment"]
    dist --> publish
    publish --> pages[(GitHub Pages)]
  end

  staged_base --> refresh_check
  staged_secondary --> refresh_check
  main --> deploy
```

The refresh workflows retain source captures and reports as temporary Actions artifacts. They propose data changes through draft pull requests; deployment happens after a change reaches `main`. The [base validator](../scripts/validate.mjs) also validates published supplements and secondary sources. [JSON Schemas](../schemas/) define artifact shapes, while validators add cross-file and integrity checks. `npm run check` builds the site, and the deployment workflow separately runs browser checks before publication. Existing workflow, command, and file names containing `corpus` still refer to the base statute data.

## 4. Directory and module index

| Area | Ownership and important files |
| --- | --- |
| [crawler/](../crawler/) | CGA acquisition: `config.py`, `fetch.py`, `snapshots.py`, `parsing.py`, `pipeline.py`, and `cli.py`; Python tests and HTML fixtures in `crawler/tests/`. |
| [secondary_sources/](../secondary_sources/) | PDF acquisition, infractions and subject-index parsing, canonical publication, offline rebinding, CLI, and Python tests. |
| [scripts/](../scripts/) | CLIs for importing, validation, diffing, policy review, site building, and local serving. `scripts/lib/` holds their importer, validator, diff, policy, discovery, supplement, search-v2, release, and PWA implementations. |
| [public/data/](../public/data/) | Checked-in base statute artifacts plus supplement editions and secondary-source datasets. Runtime reads these after the build copies them to `dist/data/`. |
| [src/](../src/) | Interactive application, route and reader logic, search and secondary clients, local state, PWA/service worker, HTML, CSS, fonts, and icons. |
| [public/commit-feed/](../public/commit-feed/) | Standalone Confluence-friendly commit feed, copied into `dist/` by the build. |
| [schemas/](../schemas/) | JSON Schemas for base, supplement, secondary, search, and build artifacts. |
| [config/](../config/) | Versioned statute data and secondary-source refresh policies, plus overrides for embedded site-update text. |
| [.github/workflows/](../.github/workflows/) | Pull-request CI, Pages deployment/release, statute data refresh, and secondary-source refresh. |
| [test/](../test/) | Node unit/integration tests and Playwright browser, accessibility, PWA, and visual checks in `test/browser/`. |
| [fixtures/legacy/](../fixtures/legacy/) | Small adapter-format dataset for tests; it is not the production source. |
| [docs/](./) and [reports/](../reports/) | Runbooks, architecture notes, and reviewed validation records. |
| `dist/`, `.crawl/`, `node_modules/`, `playwright-report/`, `test-results/` | Generated build, staging, dependencies, and test outputs; not source-of-truth content. |

### Key contracts

- **Authoritative legal-text unit:** a base chapter file in `public/data/chapters/`. Catalog and search data are navigation and search derivatives.
- **Supplement boundary:** an edition under `public/data/supplements/YYYY/`, bound to a specific version of the base statute data and applied without mutating that base.
- **Secondary boundary:** records under `public/data/secondary/`, with publisher provenance and citation links bound to the base statute data.
- **Offline boundary:** browser caches are replaceable delivery copies. Published JSON and its manifests remain authoritative.
- **Deployment boundary:** `dist/` is assembled from checked-in `src/` and `public/` plus build-derived files, then served by GitHub Pages.

For detail on the contracts and review procedures, see [Architecture](../ARCHITECTURE.md), [statute data refresh](corpus-refresh.md), [supplements](supplements.md), and [secondary sources](secondary-sources.md).
