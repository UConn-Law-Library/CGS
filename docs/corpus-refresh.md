# Reviewed corpus refreshes

The `Review corpus refresh` GitHub Actions workflow refreshes the complete current-statutes corpus without a database, server, or direct write to `main`. It runs weekly after completing the initial manual reliability gate and remains manually dispatchable for supervised refreshes.

## Repository prerequisites

An administrator must configure the repository to:

- allow GitHub Actions to create pull requests;
- allow the workflow `contents: write`, `pull-requests: write`, and `actions: write` permissions;
- require pull requests for `main` and require the `verify` check before merge.

The workflow-created branch receives an explicit `CI` workflow dispatch because GitHub does not recursively trigger ordinary workflow events created with the repository `GITHUB_TOKEN`.

## Run a refresh

1. Open **Actions → Review corpus refresh → Run workflow**.
2. Leave **Create a draft pull request** selected for a normal production review.
3. Wait for acquisition, canonical import, validation, corpus diffing, and the safety gate.
4. Download the report and raw-snapshot artifacts from the run.
5. If changes exist and pass policy, review the generated draft pull request before marking it ready.

No pull request is created when only generation timestamps changed. A failing safety gate uploads the available reports and snapshots but does not publish a branch.

## Review artifacts

Each run retains:

- `corpus-refresh-review-*` for 30 days, containing the crawler log, full JSON and Markdown corpus diffs, concise review summary, safety state, and secondary-link rebinding reports when statutes change;
- `corpus-refresh-snapshots-*` for 14 days, containing the content-addressed HTML and URL manifest required for offline replay.

Snapshots and staging data stay beneath `.crawl/` and are never committed.

## Temporary CGA TLS exception

As of July 14, 2026, `www.cga.ct.gov` serves its leaf certificate without the GoDaddy Secure Certificate Authority G2 intermediate. The Ubuntu Actions runner therefore cannot build the certificate chain and the first production refresh failed with `CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate` ([run 29300224349](https://github.com/UConn-Law-Library/CGS/actions/runs/29300224349)).

The refresh workflow temporarily passes `--no-ssl-verify` only to the CGA crawler. Raw response snapshots, content hashes, canonical validation, corpus safety thresholds, and mandatory pull-request review remain in force, but they do not replace transport authentication. Do not generalize this exception to other hosts or application traffic.

Remove the exception when CGA serves a complete chain or when the crawler has a reviewed CA-bundle mechanism containing the official GoDaddy intermediate. The crawl step enables shell `pipefail` so any future acquisition failure is reported immediately rather than being masked by log capture through `tee`.

## Safety policy

[`config/corpus-refresh-policy.json`](../config/corpus-refresh-policy.json) is the reviewed, versioned policy. It limits title membership changes, structural churn, provision count drift, additions, removals, and content changes. A legitimate publication outside those bounds requires a separate policy pull request before rerunning the refresh; workflow inputs cannot bypass the gate.

The crawler's own plausible-count checks and the canonical validator run before the policy gate. After the candidate replaces the working copy, the complete `npm run check` sequence runs again before any branch is pushed.

## Review

Refresh pull requests contain only `public/data` changes. Review the corpus summary, full diff artifact, status transitions, representative legal text, and official source links. Merging the pull request invokes the normal Pages deployment.

When supplement editions are published under `public/data/supplements/<year>`, a base-corpus refresh recrawls and re-imports every published edition later than the candidate's revision year against the candidate base before staging the pull request (`scripts/plan-supplement-rebind.mjs` decides which). A supplement acquisition, import, or validation failure stops the refresh; the workflow never copies a stale base-bound overlay forward and never silently drops a published edition. An edition the candidate revision supersedes is retired instead, as described below. Replayable supplement snapshots are retained with the workflow artifacts.

Public and Special Acts have their own refresh workflow and are not bound to the base; the refresh copies `public/data/acts` into the candidate unchanged.

## A new full revision

CGA publishes a full revision of the General Statutes in odd-numbered years, and `/current/pub/` switches to it. The crawler reads the edition from the titles page heading ("Revised to January 1, 2027") and fails if the page does not state it; the importer records it in `catalog.json` as `source.revisionYear`. The weekly refresh then:

1. diffs the new revision against the published one and applies the safety policy (see below);
2. retires every published supplement whose year is not later than the new revision year. The 2027 revision supersedes the 2026 Supplement, so the refresh pull request deletes `public/data/supplements/2026` and adds a "Retired supplements" section to its description;
3. rebinds secondary sources, and any newer supplement, to the new revision as usual.

The app judges which Public Acts are pending from the newer of the base revision year and the supplement year, so once the 2027 revision merges, 2026 acts are no longer reported as pending.

Steps that remain manual:

- **Safety policy.** A revision changes two years of legislation at once, and the current policy is not expected to pass one. Diffing the 2023 revision against the published 2025 revision (October 2026, with source URLs normalized to `/current/pub/`) gave 9.10% changed provisions (limit 35%), 2.36% added (5%), 0.31% removed (2%), a 2.05% provision count delta (5%), 1.51% chapter additions (5%), and no title changes, all passing; but 15.10% of chapters changed metadata (limit 10%), 161 of those 170 only because new sections changed their section count. Settle the chapter-metadata limit in a separate, reviewed policy pull request before the first refresh after a revision; workflow inputs cannot bypass the gate.
- **Acts sessions.** After the refresh merges, retire every session the revision codifies (for the 2027 revision, the 2025 and 2026 sessions, special sessions included), as [docs/acts.md](acts.md#retiring-a-session) describes: `python -m crawler.cgs_crawler.acts --retire 2026-regular --output public/data/acts --no-text`.
- **Published editions.** Add the year to `PUBLISHED_EDITIONS` in `src/publications.js` after confirming the edition on cga.ct.gov (`https://www.cga.ct.gov/2027/pub/titles.htm`). The guide's timeline and worked examples follow that list.

## Rollback

To roll back a bad refresh, revert its merge commit through a pull request. The previous immutable chapter artifacts remain in Git history; no database restoration is involved.

## Scheduling gate

The initial gate completed with three clean full-corpus refreshes. Each run acquired all titles, validated the same 81-title, 1,141-chapter, 33,013-provision corpus, passed the versioned safety policy, found no meaningful changes, retained both report and replayable-snapshot artifacts, and created no pull request.

| Run | Completed (UTC) | Result | Changes |
| --- | --- | --- | --- |
| [29300882887](https://github.com/UConn-Law-Library/CGS/actions/runs/29300882887) | 2026-07-14 02:36 | PASS | None |
| [29305321575](https://github.com/UConn-Law-Library/CGS/actions/runs/29305321575) | 2026-07-14 04:24 | PASS | None |
| [29305962351](https://github.com/UConn-Law-Library/CGS/actions/runs/29305962351) | 2026-07-14 04:43 | PASS | None |

The workflow is scheduled for Mondays at 10:17 UTC. Scheduled runs always enable draft-pull-request creation when meaningful changes pass policy; manual dispatches retain the explicit toggle. The existing `corpus-refresh` concurrency group serializes scheduled and manual runs, and `cancel-in-progress: false` prevents a later trigger from discarding an active evidentiary crawl.

When the primary corpus changes, the workflow runs `secondary:rebind` to rebuild statute resolutions and reverse links from the already-published records in `public/data/secondary`. This step runs offline, preserves the reviewed text, fees, IDs, and source provenance, and binds the result to the candidate base. It validates both datasets, retains a `secondary-rebind-diff` and safety review with the corpus reports, and includes those results in the draft PR. A validation or resolution-policy failure stops publication.

The corpus workflow does not download secondary PDFs. New index and infractions editions are acquired only by the independently scheduled and manually dispatchable `Review secondary sources refresh` workflow. A Judicial or LCO PDF outage cannot block the statute refresh, and the published secondary dataset is never silently discarded.
