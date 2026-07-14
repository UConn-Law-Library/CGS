# Reviewed corpus refreshes

The `Review corpus refresh` GitHub Actions workflow refreshes the complete current-statutes corpus without a database, server, or direct write to `main`. It is intentionally manual during the first operational cycles.

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

- `corpus-refresh-review-*` for 30 days, containing the crawler log, full JSON and Markdown corpus diffs, concise review summary, and safety state;
- `corpus-refresh-snapshots-*` for 14 days, containing the content-addressed HTML and URL manifest required for offline replay.

Snapshots and staging data stay beneath `.crawl/` and are never committed.

## Safety policy

[`config/corpus-refresh-policy.json`](../config/corpus-refresh-policy.json) is the reviewed, versioned policy. It limits title membership changes, structural churn, provision count drift, additions, removals, and content changes. A legitimate publication outside those bounds requires a separate policy pull request before rerunning the refresh; workflow inputs cannot bypass the gate.

The crawler's own plausible-count checks and the canonical validator run before the policy gate. After the candidate replaces the working copy, the complete `npm run check` sequence runs again before any branch is pushed.

## Review and rollback

Refresh pull requests contain only `public/data` changes. Review the corpus summary, full diff artifact, status transitions, representative legal text, and official source links. Merging the pull request invokes the normal Pages deployment.

To roll back a bad refresh, revert its merge commit through a pull request. The previous immutable chapter artifacts remain in Git history; no database restoration is involved.

## Scheduling gate

Keep the workflow manual for at least three clean full-corpus refreshes. After those runs demonstrate stable source acquisition and review volume, add a weekly schedule that retains the same safety checks and draft-PR-only publication behavior.
