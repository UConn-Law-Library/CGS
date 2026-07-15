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

Annual supplements branch from that same adapter boundary. `scripts/import-supplement.mjs` converts an edition into immutable, year-scoped chapter overlays under `data/supplements/<year>/`; it never rewrites the base chapter artifacts. The import also derives title-scoped search patches for affected chapters, and the build derives a small edition index for client discovery.

Official secondary sources enter through a separate PDF boundary. Content-addressed acquisition captures the three LCO subject-index volumes and the Judicial Branch infractions schedule. Geometry parsers produce normalized Chart A entries, Chart B fee rules, and index records; the publication layer binds them to the exact canonical manifest, resolves citations, writes size-bounded shards, and derives reverse links. Canonical chapters remain unchanged.

## Canonical identifiers

- A title ID is `title-` plus the lower-case legacy title key, for example `title-10a`.
- A chapter ID is `chapter-` plus the lower-case chapter key, for example `chapter-185`.
- An ordinary section ID is `section-` plus a URL-safe citation.
- A grouped range ID is derived from every citation in the group. If legacy input has no usable citation, a stable hash of its label and source URL is used.

Identifiers are deterministic. The importer fails on duplicate title, chapter, or section IDs rather than silently overwriting data.

## Artifact boundaries

Chapter files are the authoritative content boundary. They are small enough to cache and update independently while preserving the legal hierarchy and annotations. Catalog entries contain navigation metadata only.

Search data is derived, never authoritative. It is sharded by title: title-scoped search fetches one shard, while global search loads a bounded number of shards concurrently and streams each completed shard to a Web Worker. The worker parses Boolean expressions (`NOT` before `AND` before `OR`, with parentheses and quoted phrases), ranks off the UI thread, tracks the exact number of matches, and publishes a deterministic limited result set after every shard. New searches cancel stale processing, previously fetched shards remain cached, and an incremental inline path preserves search when workers are unavailable. The client increases the limit in 50-result batches rather than imposing a final cap. Search results point back to chapter artifacts.

The application-shell omnibar composes those progressive statute matches with bounded navigation and secondary-source suggestions. Catalog matches require no extra request, the infractions corpus is small and cached after its first load, and index autocomplete consults only the shard for the query's first alphabetic character. This avoids treating the 193,000-entry index as an eager client-side bundle while still exposing mixed results and canonical routes as the user types.

Supplement data is also non-authoritative relative to the current-statutes base. The client automatically applies the latest published edition and overlays only its cited provisions: exact citation-set matches replace and unseen citations add. Absence is not deletion. Partial overlap with a grouped provision is rejected as ambiguous. Each change retains its superseded base provisions for the reader's collapsed reference panel. Derived title search patches remove superseded base document IDs and add only changed/new documents so search and reading share one consolidated view without duplicating unchanged chapters. If a patch is temporarily unavailable, search returns base-revision matches with a visible incompleteness warning. Every edition manifest binds the overlay to the exact reviewed base schema version and generation timestamp, so a base refresh cannot silently change the overlay's meaning.

Infractions and subject-index records preserve their own publisher, revision or effective date, source-file digest, and source-page semantics. Citation resolution is explicit: exact, section-only, unresolved, or not applicable. Reverse links are derived artifacts and never become legal text within a canonical chapter.

## Client routing and reading

The Pages client uses hash routes because GitHub Pages cannot rewrite arbitrary paths to the application shell. Routes identify a title, chapter, section, and optional subsection independently of generated filenames. Direct links therefore survive refreshes and can be shared without adding a hosting service.

The same route layer exposes top-level mobile destinations for statutes, the LCO index, the Judicial Branch infractions schedule, search, and device-local bookmarks. A responsive application shell presents these as persistent bottom navigation on narrow viewports and header navigation on larger screens. Bookmarks and reader preferences use guarded browser storage only; they are never canonical data and never leave the device.

The installable PWA is still entirely static. A service worker precaches the versioned application shell and production install icons, caches visited same-origin data at runtime, and supports an explicit full-corpus download from Settings. The build derives the shell version from its deployed bytes, so every shell change creates a fresh cache generation and an already installed client can offer an explicit reload after the new worker takes control. A full download enumerates only artifacts published by the base, supplement-edition, and secondary manifests, writes them to a new generation, and atomically changes the active-cache pointer only after completion; failed or interrupted refreshes therefore leave the prior complete generation available. Browser caches are disposable delivery copies rather than authoritative storage; users can inspect reported quota, retry downloads, or remove them without affecting bookmarks or canonical JSON.

The catalog resolves title and chapter navigation. A reader fetches only the selected chapter artifact, then builds its section index, breadcrumbs, adjacent-section links, internal legal-reference links, and subsection anchors in the browser. Legacy query-string reader links are accepted as an input compatibility layer and immediately canonicalized to the hash route.

The build also derives a script-free discovery hierarchy from the same catalog and chapter artifacts. Static title pages link to static chapter pages; chapter pages expose provision headings, official-source links, and handoff links to the interactive reader. These generated pages plus `sitemap.xml` make the corpus discoverable without treating HTML as another authoritative data source.

## Validation layers

Base-corpus validation deliberately has four layers:

1. JSON Schema validates artifact shape and primitive constraints.
2. Referential checks connect catalog entries, chapters, search documents, and paths.
3. Aggregate checks compare title, chapter, and section totals.
4. Integrity checks recompute each artifact's byte length and SHA-256 digest.

`scripts/diff-corpus.mjs` adds a review layer between validated snapshots. It identifies provisions by citation rather than file path, then reports additions, removals, content and metadata changes, chapter moves, and status transitions.

Supplement validation applies the same chapter schema and artifact-integrity checks, recomputes replacement/addition classifications and consolidated search documents, rejects ambiguous grouped-provision matches, and verifies the recorded base identity. The importer, validator, and client share the same deterministic citation rule without mutating cached or checked-in base chapters.

Secondary-source validation verifies PDF provenance, canonical base identity, JSON Schemas, aggregate and shard counts, content hashes, resolution links, and both directions of the derived statute relationships. Parser regression tests exercise monetary columns, wrapped rows, two-column ordering, continuation headings, subject references, and content-addressed capture.

The in-repository schema engine implements the JSON Schema keywords used by these contracts. This avoids a dependency supply chain while keeping the schemas consumable by standard Draft 2020-12 tooling.

## Deployment

`ci.yml` verifies pull requests, pushes, and explicitly dispatched checks for automation-created branches. `deploy-pages.yml` performs the same checks, generates the installable application shell, discovery pages, sitemap, robots metadata, service worker, and static data into `dist/`, then deploys that directory through GitHub's official Pages Actions. `refresh-corpus.yml` and `refresh-secondary.yml` are weekly and manually dispatchable build-time workflows. Both acquire into staging, retain replayable source evidence as temporary artifacts, validate and diff candidates, apply versioned safety policies, and create draft data pull requests only for meaningful passing changes. A changed primary corpus includes a coordinated secondary-source re-resolution against the candidate base. Scheduled and manual runs are serialized within each workflow, and neither writes directly to `main`.

## Next increments

- Add bounded supplement-specific diff policy and reporting to the coordinated primary-corpus refresh path.
- Derive supplement-aware static discovery pages and sitemap metadata.
- Add edition-to-edition comparison support when a second annual supplement is published.
