import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/refresh-acts.yml", import.meta.url), "utf8");

test("acts refreshes remain review-gated", () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: "29 11 \* \* 2"/);
  assert.match(workflow, /concurrency:\s*\n\s*group: acts-refresh\s*\n\s*cancel-in-progress: false/);
  assert.match(workflow, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \] && \[ "\$CREATE_PULL_REQUEST" = "true" \]; then/);
  assert.match(workflow, /python -m crawler\.cgs_crawler\.acts[\s\S]*?--output public\/data\/acts/);
  assert.doesNotMatch(workflow, /--allow-removals|--retire/);
  assert.match(workflow, /Verify the candidate data\s*\n\s*if: steps\.review\.outputs\.has_changes == 'true'\s*\n\s*run: npm run check/);
  assert.match(workflow, /git add -- public\/data\/acts/);
  assert.match(workflow, /gh pr create[\s\S]*?--base main[\s\S]*?--draft/);
  assert.match(workflow, /gh workflow run ci\.yml --ref "\$branch"/);
  assert.doesNotMatch(workflow, /git push\s+origin\s+main/);
});
