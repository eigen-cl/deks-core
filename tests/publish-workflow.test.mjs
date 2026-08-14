import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/publish-npm.yml", import.meta.url), "utf8");
const publishingDocs = await readFile(new URL("../docs/publishing.md", import.meta.url), "utf8");
const verify = workflow.match(/\n  verify:\n([\s\S]*?)\n  publish:/)?.[1] ?? "";
const publish = workflow.match(/\n  publish:\n([\s\S]*)$/)?.[1] ?? "";

test("publishes only after push to main and serializes releases", () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.doesNotMatch(workflow, /pull_request:|workflow_dispatch:|tags:/);
  assert.match(workflow, /group:\s*deks-core-npm-publish/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test("grants OIDC only to the publish job and never references tokens or secrets", () => {
  assert.match(workflow, /publish:[\s\S]*permissions:[\s\S]*id-token:\s*write/);
  assert.match(workflow, /publish:[\s\S]*permissions:[\s\S]*contents:\s*read/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\.|_authToken/);
  assert.doesNotMatch(verify, /id-token:/);
});

test("gates only publish until Trusted Publishing has been bootstrapped", () => {
  assert.match(publish, /if:\s*\$\{\{ vars\.NPM_TRUSTED_PUBLISHING_READY == 'true' \}\}/);
  assert.doesNotMatch(verify, /NPM_TRUSTED_PUBLISHING_READY|\n\s*if:/);
  assert.equal((workflow.match(/NPM_TRUSTED_PUBLISHING_READY/g) ?? []).length, 1);
});

test("verifies before publishing with pinned actions and the supported npm runtime", () => {
  assert.match(workflow, /publish:\s*\n\s*needs:\s*verify/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /node-version:\s*24/);
  for (const command of ["npm ci", "npm test", "npm run typecheck", "node scripts/publish-workspaces.mjs"]) {
    assert.match(workflow, new RegExp(`run: ${escapeRegExp(command)}`));
  }
  assert.equal((workflow.match(/persist-credentials:\s*false/g) ?? []).length, 2);
});

test("uses the audited Node publisher and does not depend on jq", () => {
  assert.match(workflow, /node scripts\/publish-workspaces\.mjs/);
  assert.doesNotMatch(workflow, /\bjq\b/);
});

test("publishes only the immutable dist artifact produced by verify", () => {
  assert.match(verify, /actions\/upload-artifact@[0-9a-f]{40}/);
  for (const path of ["packages/document/dist", "packages/renderer-core/dist", "packages/react/dist"]) {
    assert.match(verify, new RegExp(path));
  }
  assert.match(publish, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(publish, /path:\s*packages/);
  assert.doesNotMatch(publish, /run:\s*npm (?:ci|install|run build)/);
  assert.doesNotMatch(publish, /cache:\s*npm/);
});

test("documents the safe bootstrap sequence before enabling the repository variable", () => {
  assert.match(publishingDocs, /NPM_TRUSTED_PUBLISHING_READY/);
  assert.match(publishingDocs, /push.*main[\s\S]*verify[\s\S]*(?:omitido|skip)/i);
  assert.match(publishingDocs, /staged[\s\S]*2FA/i);
  assert.match(publishingDocs, /Trusted Publisher/);
  assert.match(publishingDocs, /NPM_TRUSTED_PUBLISHING_READY[^\n]*true/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
