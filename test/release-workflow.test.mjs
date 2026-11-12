import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");

test("main deployments publish a tested patch release", () => {
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /version="v\$\{BASH_REMATCH\[1\]\}\.\$\{BASH_REMATCH\[2\]\}\.\$\(\(BASH_REMATCH\[3\] \+ 1\)\)"/);
  assert.match(workflow, /CGS_APP_VERSION: \$\{\{ needs\.version\.outputs\.version \}\}/);
  assert.match(workflow, /\n  deploy:[\s\S]*?needs:\s*\n\s*- build\s*\n\s*- browser\s*\n/);
  assert.match(workflow, /gh release create "\$RELEASE_VERSION" --verify-tag --latest --generate-notes/);
  // The release is tagged only after the site deploys.
  assert.match(workflow, /\n  publish-release:[\s\S]*?needs:\s*\n\s*- version\s*\n\s*- deploy\s*\n/);
});

test("production deploys only the newest main commit", () => {
  const guard = workflow.indexOf("Require the newest main commit");
  assert.ok(guard > 0 && guard < workflow.indexOf("Determine application version"));
  assert.match(workflow, /if \[\[ "\$GITHUB_REF" != "refs\/heads\/main" \]\]; then/);
  assert.match(workflow, /main_sha="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /if \[\[ "\$main_sha" != "\$GITHUB_SHA" \]\]; then/);
});

test("manual deployments reuse the current release", () => {
  assert.match(workflow, /GITHUB_EVENT_NAME" == "workflow_dispatch"/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /without creating a new release/);
});
