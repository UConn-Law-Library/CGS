import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/refresh-secondary.yml", import.meta.url), "utf8");
const corpusWorkflow = await readFile(new URL("../.github/workflows/refresh-corpus.yml", import.meta.url), "utf8");

test("secondary-source refreshes remain review-gated and database-free", () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: "43 11 \* \* 3"/);
  assert.match(workflow, /concurrency:\s*\n\s*group: secondary-sources-refresh\s*\n\s*cancel-in-progress: false/);
  assert.match(workflow, /--before public\/data\/secondary[\s\S]*?--after "\$CANDIDATE_DIR"/);
  assert.match(workflow, /--policy config\/secondary-refresh-policy\.json/);
  assert.doesNotMatch(workflow, /--no-cga-ssl-verify/);
  assert.match(workflow, /CGS_CA_BUNDLE/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /defaults:\s*\n\s*run:\s*\n\s*shell: bash/);
  assert.match(workflow, /--judicial-client curl/);
  assert.match(workflow, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \] && \[ "\$CREATE_PULL_REQUEST" = "true" \]; then/);
  assert.doesNotMatch(workflow, /\s--no-ssl-verify/);
  assert.match(workflow, /git add -- public\/data\/secondary/);
  assert.match(workflow, /run: bash scripts\/publish-refresh\.sh automation\/secondary-refresh \.crawl\/publish/);
  assert.equal((workflow.match(/env\.CREATE_PULL_REQUEST == 'true'/g) ?? []).length, 2);
  assert.equal((workflow.match(/if: always\(\)/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /git push\s+origin\s+main/);
});

test("a new source publication archives the outgoing edition; a rebind never does", () => {
  const step = workflow.match(/- name: Retain sources and archive replaced editions[\s\S]*?(?=\n {6}- name:)/)?.[0] ?? "";
  assert.match(step, /node scripts\/archive-secondary-editions\.mjs[\s\S]*?--data public\/data[\s\S]*?--candidate "\$CANDIDATE_DIR"[\s\S]*?--sources "\$SOURCE_DIR\/manifest\.json"/);
  assert.ok(workflow.indexOf("Apply secondary-source safety policy") < workflow.indexOf("Retain sources and archive replaced editions"));
  assert.match(workflow, /Stage and verify candidate artifacts\s*\n\s*if: steps\.review\.outputs\.has_changes == 'true' \|\| steps\.editions\.outputs\.changed == 'true'/);
  assert.match(workflow, /Prepare pull request description[\s\S]*?secondary-editions\.md/);
  assert.match(workflow, /git add -- public\/data\/secondary public\/data\/editions\/secondary/);
  // The corpus refresh only rebinds links; it never runs the archive step.
  assert.doesNotMatch(corpusWorkflow, /archive-secondary-editions/);
});
