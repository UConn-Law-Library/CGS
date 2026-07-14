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

Search data is derived, never authoritative. It is sharded by title: 81 requests are a tractable upper bound for an eventual progressive global search, while title-scoped search normally fetches one shard. Search results point back to chapter artifacts.

## Validation layers

Validation deliberately has four layers:

1. JSON Schema validates artifact shape and primitive constraints.
2. Referential checks connect catalog entries, chapters, search documents, and paths.
3. Aggregate checks compare title, chapter, and section totals.
4. Integrity checks recompute each artifact's byte length and SHA-256 digest.

`scripts/diff-corpus.mjs` adds a review layer between validated snapshots. It identifies provisions by citation rather than file path, then reports additions, removals, content and metadata changes, chapter moves, and status transitions.

The in-repository schema engine implements the JSON Schema keywords used by these contracts. This avoids a dependency supply chain while keeping the schemas consumable by standard Draft 2020-12 tooling.

## Deployment

`ci.yml` verifies pull requests and pushes. `deploy-pages.yml` performs the same checks, uploads only `dist/`, and deploys through GitHub's official Pages Actions. No secret, database, server, or scheduled process is required.

## Next increments

- Move global search into a Web Worker and stream title shard results progressively.
- Add generated title/chapter route pages for stronger no-JavaScript navigation and indexing.
- Automate reviewed crawler refresh pull requests with attached corpus-diff summaries.
- Decide how annual supplements should merge with or overlay the canonical current-statutes contract.
- Publish corpus diffs automatically as data-refresh pull request summaries.
