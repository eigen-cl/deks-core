import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  WORKSPACES,
  npmPublish,
  packageVersionStatus,
  publishMissingWorkspaces,
  supportsTrustedPublishing,
} from "../scripts/publish-workspaces.mjs";

test("declares the dependency-safe publication order", () => {
  assert.deepEqual(
    WORKSPACES.map(({ name }) => name),
    ["@deks-js/document", "@deks-js/renderer-core", "@deks-js/react", "@deks-js/render-preview"],
  );
});

test("ships the preview worker through npm's canonical bin path", async () => {
  const manifest = JSON.parse(await readFile(resolve(process.cwd(), "packages/render-preview/package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { "deks-render-preview-worker": "dist/worker.js" });
});

test("declares the release versions and exact internal dependency closure", async () => {
  const readManifest = async (path) => JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
  const [root, document, renderer, react, preview, lock] = await Promise.all([
    readManifest("package.json"),
    readManifest("packages/document/package.json"),
    readManifest("packages/renderer-core/package.json"),
    readManifest("packages/react/package.json"),
    readManifest("packages/render-preview/package.json"),
    readManifest("package-lock.json"),
  ]);

  // El modelo de movimiento cambia el documento canónico: los cuatro paquetes
  // avanzan juntos a una mayor porque ninguno puede leer el contrato anterior.
  assert.equal(root.version, "4.0.0");
  assert.equal(document.version, "4.0.0");
  assert.equal(renderer.version, "4.0.0");
  assert.equal(react.version, "4.0.0");
  assert.equal(preview.version, "4.0.0");
  assert.equal(renderer.dependencies["@deks-js/document"], "4.0.0");
  assert.deepEqual(react.dependencies, {
    "@deks-js/document": "4.0.0",
    "@deks-js/renderer-core": "4.0.0",
  });
  assert.equal(preview.dependencies["@deks-js/document"], "4.0.0");
  assert.equal(preview.dependencies["@deks-js/renderer-core"], "4.0.0");
  assert.equal(preview.dependencies.playwright, "1.62.1");

  for (const [path, version] of [
    ["", "4.0.0"],
    ["packages/document", "4.0.0"],
    ["packages/renderer-core", "4.0.0"],
    ["packages/react", "4.0.0"],
    ["packages/render-preview", "4.0.0"],
  ]) assert.equal(lock.packages[path].version, version);
  assert.equal(lock.packages["packages/react"].dependencies["@deks-js/renderer-core"], "4.0.0");
  assert.equal(lock.packages["packages/render-preview"].dependencies["@deks-js/renderer-core"], "4.0.0");
});

test("requires an npm CLI with Trusted Publishing support", () => {
  assert.equal(supportsTrustedPublishing("11.5.1"), true);
  assert.equal(supportsTrustedPublishing("12.0.0"), true);
  assert.equal(supportsTrustedPublishing("11.5.0"), false);
  assert.equal(supportsTrustedPublishing("10.9.9"), false);
  assert.equal(supportsTrustedPublishing("invalid"), false);
});

test("distinguishes an existing version from an absent one using exact registry statuses", async () => {
  const requests = [];
  const existing = await packageVersionStatus("@deks-js/document", "0.1.0", async (...request) => {
    requests.push(request);
    return new Response(JSON.stringify({ name: "@deks-js/document", version: "0.1.0" }), { status: 200 });
  });
  const absent = await packageVersionStatus("@deks-js/document", "0.2.0", async () =>
    new Response("not found", { status: 404 }),
  );

  assert.equal(existing, "exists");
  assert.equal(absent, "missing");
  assert.deepEqual(requests, [[
    "https://registry.npmjs.org/%40deks-js%2Fdocument/0.1.0",
    { headers: { accept: "application/json" }, redirect: "error" },
  ]]);
});

test("fails closed for registry errors and malformed successful responses", async () => {
  await assert.rejects(
    packageVersionStatus("@deks-js/document", "0.1.0", async () => new Response("unavailable", { status: 503 })),
    /503/,
  );
  await assert.rejects(
    packageVersionStatus("@deks-js/document", "0.1.0", async () => new Response("{}", { status: 200 })),
    /respuesta inválida/i,
  );
});

test("skips existing versions and publishes missing versions sequentially", async () => {
  const root = await fixture();
  const calls = [];
  const statuses = new Map([
    ["@deks-js/document", "exists"],
    ["@deks-js/renderer-core", "missing"],
    ["@deks-js/react", "missing"],
    ["@deks-js/render-preview", "missing"],
  ]);

  const result = await publishMissingWorkspaces({
    root,
    status: async (name) => statuses.get(name),
    publish: async (workspace) => calls.push(workspace),
    log: () => undefined,
  });

  assert.deepEqual(calls, ["@deks-js/renderer-core", "@deks-js/react", "@deks-js/render-preview"]);
  assert.deepEqual(result, {
    skipped: ["@deks-js/document@0.1.0"],
    published: ["@deks-js/renderer-core@0.1.0", "@deks-js/react@0.1.0", "@deks-js/render-preview@0.1.0"],
  });
});

test("stops immediately when a real publish fails", async () => {
  const root = await fixture();
  const calls = [];

  await assert.rejects(
    publishMissingWorkspaces({
      root,
      status: async () => "missing",
      publish: async (workspace) => {
        calls.push(workspace);
        if (workspace === "@deks-js/renderer-core") throw new Error("npm publish failed");
      },
      log: () => undefined,
    }),
    /npm publish failed/,
  );

  assert.deepEqual(calls, ["@deks-js/document", "@deks-js/renderer-core"]);
});

test("refuses to publish when the validated dist artifact is absent", async () => {
  const root = await fixture();
  await writeFile(join(root, "packages/document/dist/index.js"), "");
  const { rm } = await import("node:fs/promises");
  await rm(join(root, "packages/document/dist/index.d.ts"));

  await assert.rejects(
    publishMissingWorkspaces({
      root,
      status: async () => "missing",
      publish: async () => assert.fail("publish must not run"),
      log: () => undefined,
    }),
    /artifact validado.*document\/dist\/index\.d\.ts/i,
  );
});

test("invokes npm publish with public access and provenance without a shell or token", async () => {
  const calls = [];
  await npmPublish("@deks-js/document", async (command, args, options) => {
    calls.push({ command, args, options });
    return 0;
  });

  assert.deepEqual(calls, [{
    command: "npm",
    args: [
      "publish",
      "--workspace",
      "@deks-js/document",
      "--access",
      "public",
      "--provenance",
      "--registry",
      "https://registry.npmjs.org/",
    ],
    options: { shell: false, stdio: "inherit" },
  }]);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deks-publish-test-"));
  for (const { name, directory } of WORKSPACES) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(
      join(root, directory, "package.json"),
      JSON.stringify({ name, version: "0.1.0", publishConfig: { access: "public" } }),
    );
    await mkdir(join(root, directory, "dist"), { recursive: true });
    await writeFile(join(root, directory, "dist/index.js"), "export {};\n");
    await writeFile(join(root, directory, "dist/index.d.ts"), "export {};\n");
    if (directory === "packages/react") await writeFile(join(root, directory, "dist/styles.css"), "");
    if (directory === "packages/render-preview") {
      await writeFile(join(root, directory, "dist/browser-entry.js"), "");
      await writeFile(join(root, directory, "dist/worker.js"), "");
    }
  }
  return root;
}
