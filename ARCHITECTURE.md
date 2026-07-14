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

Annual supplements branch from that same adapter boundary. `scripts/import-supplement.mjs` converts an edition into immutable, year-scoped chapter overlays under `data/supplements/<year>/`; it never rewrites the base chapter artifacts. The build derives a small edition index for client discovery.

Official secondary sources enter through a separate PDF boundary. Content-addressed acquisition captures the three LCO subject-index volumes and the Judicial Branch infractions schedule. Geometry parsers produce normalized Chart A entries, Chart B fee rules, and index records; the publication layer binds them to the exact canonical manifest, resolves citations, writes size-bounded shards, and derives reverse links. Canonical chapters remain unchanged.

## Canonical identifiers

- A title ID is `title-` plus the lower-case legacy title key, for example `title-10a`.
- A chapter ID is `chapter-` plus the lower-case chapter key, for example `chapter-185`.
- An ordinary section ID is `section-` plus a URL-safe citation.
- A grouped range ID is derived from every citation in the group. If legacy input has no usable citation, a stable hash of its label and source URL is used.

Identifiers are deterministic. The importer fails on duplicate title, chapter, or section IDs rather than silently overwriting data.

## Artifact boundaries

Chapter files are the authoritative content boundary. They are small enough to cache and update independently while preserving the legal hierarchy and annotations. Catalog entries contain navigation metadata only.

Search data is derived, never authoritative. It is sharded by title: title-scoped search fetches one shard, while global search loads a bounded number of shards concurrently and streams each completed shard to a Web Worker. The worker ranks off the UI thread and publishes a deterministic top-result set after every shard. New searches cancel stale processing, previously fetched shards remain cached, and an incremental inline path preserves search when workers are unavailable. Search results point back to chapter artifacts.

Supplement data is also non-authoritative relative to the current-statutes base. Selecting an edition overlays only the edition's cited provisions: exact citation-set matches replace and unseen citations add. Absence is not deletion. Partial overlap with a grouped provision is rejected as ambiguous. Every edition manifest binds the overlay to the exact reviewed base schema version and generation timestamp, so a base refresh cannot silently change the overlay's meaning.

Infractions and subject-index records preserve their own publisher, revision or effective date, source-file digest, and source-page semantics. Citation resolution is explicit: exact, section-only, unresolved, or not applicable. Reverse links are derived artifacts and never become legal text within a canonical chapter.

## Client routing and reading

The Pages client uses hash routes because GitHub Pages cannot rewrite arbitrary paths to the application shell. Routes identify a title, chapter, section, and optional subsection independently of generated filenames. Direct links therefore survive refreshes and can be shared without adding a hosting service.

The catalog resolves title and chapter navigation. A reader fetches only the selected chapter artifact, then builds its section index, breadcrumbs, adjacent-section links, internal legal-reference links, and subsection anchors in the browser. Legacy query-string reader links are accepted as an input compatibility layer and immediately canonicalized to the hash route.

The build also derives a script-free discovery hierarchy from the same catalog and chapter artifacts. Static title pages link to static chapter pages; chapter pages expose provision headings, official-source links, and handoff links to the interactive reader. These generated pages plus `sitemap.xml` make the corpus discoverable without treating HTML as another authoritative data source.

## Validation layers

Base-corpus validation deliberately has four layers:

1. JSON Schema validates artifact shape and primitive constraints.
2. Referential checks connect catalog entries, chapters, search documents, and paths.
3. Aggregate checks compare title, chapter, and section totals.
4. Integrity checks recompute each artifact's byte length and SHA-256 digest.

`scripts/diff-corpus.mjs` adds a review layer between validated snapshots. It identifies provisions by citation rather than file path, then reports additions, removals, content and metadata changes, chapter moves, and status transitions.

Supplement validation applies the same chapter schema and artifact-integrity checks, recomputes replacement/addition classifications, rejects ambiguous grouped-provision matches, and verifies the recorded base identity. The client applies the same deterministic citation rule without mutating its cached base chapter.

Secondary-source validation verifies PDF provenance, canonical base identity, JSON Schemas, aggregate and shard counts, content hashes, resolution links, and both directions of the derived statute relationships. Parser regression tests exercise monetary columns, wrapped rows, two-column ordering, continuation headings, subject references, and content-addressed capture.

The in-repository schema engine implements the JSON Schema keywords used by these contracts. This avoids a dependency supply chain while keeping the schemas consumable by standard Draft 2020-12 tooling.

## Deployment

`ci.yml` verifies pull requests, pushes, and explicitly dispatched checks for automation-created branches. `deploy-pages.yml` performs the same checks, generates the interactive client, discovery pages, sitemap, and robots metadata into `dist/`, then deploys that directory through GitHub's official Pages Actions. `refresh-corpus.yml` is a weekly and manually dispatchable build-time workflow that crawls into staging, retains snapshots as temporary artifacts, validates and diffs the candidate, applies a versioned safety policy, and creates a draft data pull request. Scheduled and manual runs are serialized, and the workflow never writes directly to `main`.

## Next increments

- Automate reviewed secondary-source refresh pull requests using the established diff and safety policy.
- Expose reviewed supplement selection and change labels in the reader interface once the first real edition is published.
- Derive edition-aware search artifacts after supplement-selection behavior is accepted in the reader.
- Publish corpus diffs automatically as data-refresh pull request summaries.
