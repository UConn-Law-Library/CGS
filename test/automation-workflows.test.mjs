import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

for (const [file, branch] of [
  ["refresh-corpus.yml", "automation/corpus-refresh"],
  ["refresh-acts.yml", "automation/acts-refresh"],
  ["refresh-secondary.yml", "automation/secondary-refresh"]
]) {
  test(`${file} refreshes without write access and publishes one rolling draft`, async () => {
    const workflow = await read(`.github/workflows/${file}`);
    const publishJob = workflow.indexOf("\n  publish:\n");
    assert.ok(publishJob > 0, "has a separate publish job");
    const refresh = workflow.slice(0, publishJob);
    const publish = workflow.slice(publishJob);
    assert.match(refresh, /\npermissions:\s*\n\s*contents: read\s*\n\s*\nconcurrency:/);
    assert.doesNotMatch(refresh, /: write\b/);
    assert.match(refresh, /- uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*persist-credentials: false/);
    assert.doesNotMatch(refresh, /GH_TOKEN|git push|gh pr /);
    assert.match(refresh, /git bundle create \.crawl\/publish\/candidate\.bundle "\$GITHUB_SHA\.\.HEAD"/);
    assert.match(publish, /if: needs\.refresh\.outputs\.publish == 'true'/);
    assert.match(publish, /permissions:\s*\n\s*actions: write\s*\n\s*contents: write\s*\n\s*pull-requests: write/);
    // The publish job runs only the repository's own script: no package installs or parsing.
    assert.doesNotMatch(publish, /npm |pip |python /);
    assert.match(publish, new RegExp(`run: bash scripts/publish-refresh\\.sh ${branch.replace("/", "\\/")} \\.crawl/publish`));
  });
}

test("refresh publication replaces one branch, updates its draft, and refuses a moved main", async () => {
  const script = await read("scripts/publish-refresh.sh");
  assert.match(script, /git fetch --no-tags --quiet origin main/);
  assert.match(script, /if \[ "\$main_sha" != "\$GITHUB_SHA" \]; then[\s\S]*?exit 1/);
  assert.match(script, /git rev-parse refresh-candidate\^\)" != "\$GITHUB_SHA"/);
  assert.match(script, /git push --force --quiet origin "refresh-candidate:refs\/heads\/\$branch"/);
  assert.match(script, /gh pr list --head "\$branch" --base main --state open/);
  assert.match(script, /gh pr edit "\$number" --title "\$title" --body-file "\$body"/);
  assert.match(script, /gh pr create --base main --head "\$branch" --draft/);
  assert.match(script, /gh workflow run ci\.yml --ref "\$branch"/);
  assert.doesNotMatch(script, /git push[^\n]*\bmain\b/);
});

test("CI runs once per change, cancels superseded runs, and has time limits", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- codex\/cgs-reading-room-prototype\s*\n/);
  assert.doesNotMatch(workflow, /branches-ignore/);
  assert.match(workflow, /concurrency:\s*\n\s*group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\s*\n\s*cancel-in-progress: true/);
  assert.equal((workflow.match(/timeout-minutes:/g) ?? []).length, 2);
  assert.match(workflow, /path: ~\\AppData\\Local\\ms-playwright/);
  assert.match(workflow, /cache-dependency-path: crawler\/requirements-lock\.txt/);
});
