# Architecture

## Constraints

1. GitHub Pages is the only production host.
2. All application and corpus state is immutable static content.
3. The legacy repository is read-only migration input.
4. Every build is independently verifiable without a database or network service.
5. Large content is fetched incrementally by title or chapter.

## Data flow

```text
legacy title_*.json
        |
        v
scripts/import-legacy.mjs
        |
        +--> catalog.json
        +--> chapters/*.json
        +--> search/manifest.json
        +--> search/title-*.json
        +--> manifest.json (counts + SHA-256)
                    |
                    v
             scripts/validate.mjs
                    |
                    v
              static dist/ site
                    |
                    v
                GitHub Pages
```

New source refreshes begin one layer earlier: the modular Python crawler captures content-addressed CGA HTML snapshots, parses them into the legacy adapter format shown above, and supports deterministic offline replay. The legacy JSON boundary is retained temporarily as an explicit migration seam, not as the public contract.

## Canonical identifiers

- A title ID is `title-` plus the lower-case legacy title key, for example `title-10a`.
- A chapter ID is `chapter-` plus the lower-case chapter key, for example `chapter-185`.
- An ordinary section ID is `section-` plus a URL-safe citation.
- A grouped range ID is derived from every citation in the group. If legacy input has no usable citation, a stable hash of its label and source URL is used.

Identifiers are deterministic. The importer fails on duplicate title, chapter, or section IDs rather than silently overwriting data.

## Artifact boundaries

Chapter files are the authoritative content boundary. They are small enough to cache and update independently while preserving the legal hierarchy and annotations. Catalog entries contain navigation metadata only.

Search data is derived, never authoritative. It is sharded by title: title-scoped search fetches one shard, while global search loads a bounded number of shards concurrently and streams each completed shard to a Web Worker. The worker ranks off the UI thread and publishes a deterministic top-result set after every shard. New searches cancel stale processing, previously fetched shards remain cached, and an incremental inline path preserves search when workers are unavailable. Search results point back to chapter artifacts.

## Client routing and reading

The Pages client uses hash routes because GitHub Pages cannot rewrite arbitrary paths to the application shell. Routes identify a title, chapter, section, and optional subsection independently of generated filenames. Direct links therefore survive refreshes and can be shared without adding a hosting service.

The catalog resolves title and chapter navigation. A reader fetches only the selected chapter artifact, then builds its section index, breadcrumbs, adjacent-section links, internal legal-reference links, and subsection anchors in the browser. Legacy query-string reader links are accepted as an input compatibility layer and immediately canonicalized to the hash route.

The build also derives a script-free discovery hierarchy from the same catalog and chapter artifacts. Static title pages link to static chapter pages; chapter pages expose provision headings, official-source links, and handoff links to the interactive reader. These generated pages plus `sitemap.xml` make the corpus discoverable without treating HTML as another authoritative data source.

## Validation layers

Validation deliberately has four layers:

1. JSON Schema validates artifact shape and primitive constraints.
2. Referential checks connect catalog entries, chapters, search documents, and paths.
3. Aggregate checks compare title, chapter, and section totals.
4. Integrity checks recompute each artifact's byte length and SHA-256 digest.

`scripts/diff-corpus.mjs` adds a review layer between validated snapshots. It identifies provisions by citation rather than file path, then reports additions, removals, content and metadata changes, chapter moves, and status transitions.

The in-repository schema engine implements the JSON Schema keywords used by these contracts. This avoids a dependency supply chain while keeping the schemas consumable by standard Draft 2020-12 tooling.

## Deployment

`ci.yml` verifies pull requests, pushes, and explicitly dispatched checks for automation-created branches. `deploy-pages.yml` performs the same checks, generates the interactive client, discovery pages, sitemap, and robots metadata into `dist/`, then deploys that directory through GitHub's official Pages Actions. `refresh-corpus.yml` is a manually dispatched build-time workflow that crawls into staging, retains snapshots as temporary artifacts, validates and diffs the candidate, applies a versioned safety policy, and creates a draft data pull request. It never writes directly to `main`.

## Next increments

- Complete three reviewed manual crawler refreshes, then consider a weekly schedule.
- Decide how annual supplements should merge with or overlay the canonical current-statutes contract.
- Publish corpus diffs automatically as data-refresh pull request summaries.
