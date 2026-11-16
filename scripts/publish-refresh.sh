#!/usr/bin/env bash
# Publishes a refresh candidate that a read-only job built and checked.
#
#   scripts/publish-refresh.sh <branch> <candidate directory>
#
# The directory holds candidate.bundle (one commit on the run's main commit), title.txt, and
# pull-request.md. Each source has one rolling branch and one draft pull request: a new run
# replaces the branch and updates the description instead of opening another draft.
#
# The candidate was built and checked against the run's main commit. If main has moved since,
# the checks no longer describe what would merge, so nothing is published.
set -euo pipefail

branch="$1"
candidate="$2"
: "${GITHUB_SHA:?}"

git fetch --no-tags --quiet origin main
main_sha="$(git rev-parse FETCH_HEAD)"
if [ "$main_sha" != "$GITHUB_SHA" ]; then
  echo "main moved from ${GITHUB_SHA::7} to ${main_sha::7} during this refresh, so its checks ran against an older main. Nothing was published. Run the workflow again, or wait for the next scheduled run." >&2
  exit 1
fi

git fetch --no-tags --quiet "$candidate/candidate.bundle" "HEAD:refs/heads/refresh-candidate"
if [ "$(git rev-parse refresh-candidate^)" != "$GITHUB_SHA" ] || [ "$(git rev-list --count "$GITHUB_SHA..refresh-candidate")" != "1" ]; then
  echo "The candidate is not a single commit on ${GITHUB_SHA::7}." >&2
  exit 1
fi

git push --force --quiet origin "refresh-candidate:refs/heads/$branch"

title="$(cat "$candidate/title.txt")"
body="$candidate/pull-request.md"
{
  echo
  echo "---"
  echo
  echo "Each run of this workflow replaces \`$branch\` and this description. Its checks ran on the candidate as one commit on main at ${GITHUB_SHA::7}."
} >> "$body"

number="$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty')"
if [ -n "$number" ]; then
  gh pr edit "$number" --title "$title" --body-file "$body" >/dev/null
  url="$(gh pr view "$number" --json url --jq .url)"
  echo "Updated draft refresh PR: $url" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
else
  url="$(gh pr create --base main --head "$branch" --draft --title "$title" --body-file "$body")"
  echo "Created draft refresh PR: $url" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
fi

# Pull requests opened with the workflow token do not trigger CI on their own.
gh workflow run ci.yml --ref "$branch"
