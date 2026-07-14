import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/refresh-secondary.yml", import.meta.url), "utf8");

test("secondary-source refreshes remain review-gated and database-free", () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: "43 11 \* \* 3"/);
  assert.match(workflow, /concurrency:\s*\n\s*group: secondary-sources-refresh\s*\n\s*cancel-in-progress: false/);
  assert.match(workflow, /--before public\/data\/secondary[\s\S]*?--after "\$CANDIDATE_DIR"/);
  assert.match(workflow, /--policy config\/secondary-refresh-policy\.json/);
  assert.match(workflow, /--no-cga-ssl-verify/);
  assert.doesNotMatch(workflow, /\s--no-ssl-verify/);
  assert.match(workflow, /git add -- public\/data\/secondary/);
  assert.match(workflow, /gh pr create[\s\S]*?--base main[\s\S]*?--draft/);
  assert.match(workflow, /gh workflow run ci\.yml --ref "\$branch"/);
  assert.equal((workflow.match(/env\.CREATE_PULL_REQUEST == 'true'/g) ?? []).length, 2);
  assert.equal((workflow.match(/if: always\(\)/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /git push\s+origin\s+main/);
});
