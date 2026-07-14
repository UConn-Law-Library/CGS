import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/refresh-corpus.yml", import.meta.url), "utf8");

test("weekly corpus refreshes retain the reviewed publication safeguards", () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: "17 10 \* \* 1"/);
  assert.match(workflow, /CREATE_PULL_REQUEST: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.create_pull_request \}\}/);
  assert.equal((workflow.match(/env\.CREATE_PULL_REQUEST == 'true'/g) ?? []).length, 2);
  assert.match(workflow, /concurrency:\s*\n\s*group: corpus-refresh\s*\n\s*cancel-in-progress: false/);
  assert.match(workflow, /gh pr create[\s\S]*?--base main[\s\S]*?--draft/);
  assert.match(workflow, /Rebind secondary sources to the candidate corpus[\s\S]*?--base "\$CANONICAL_DIR"[\s\S]*?--output "\$CANONICAL_DIR\/secondary"/);
  assert.match(workflow, /--no-cga-ssl-verify/);
  assert.doesNotMatch(workflow, /git push\s+origin\s+main/);
});
