import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");

test("main deployments publish a tested patch release", () => {
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /version="v\$\{BASH_REMATCH\[1\]\}\.\$\{BASH_REMATCH\[2\]\}\.\$\(\(BASH_REMATCH\[3\] \+ 1\)\)"/);
  assert.match(workflow, /CGS_APP_VERSION: \$\{\{ needs\.version\.outputs\.version \}\}/);
  assert.match(workflow, /publish-release:[\s\S]*needs:[\s\S]*- build[\s\S]*- browser/);
  assert.match(workflow, /gh release create "\$RELEASE_VERSION" --verify-tag --latest --generate-notes/);
  assert.match(workflow, /deploy:[\s\S]*- publish-release/);
});

test("manual deployments reuse the current release", () => {
  assert.match(workflow, /GITHUB_EVENT_NAME" == "workflow_dispatch"/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /without creating a new release/);
});
