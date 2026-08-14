import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REGISTRY = "https://registry.npmjs.org";

export const WORKSPACES = Object.freeze([
  { name: "@deks-js/document", directory: "packages/document" },
  { name: "@deks-js/renderer-core", directory: "packages/renderer-core" },
  { name: "@deks-js/react", directory: "packages/react" },
  { name: "@deks-js/render-preview", directory: "packages/render-preview" },
]);

export function supportsTrustedPublishing(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
}

export async function packageVersionStatus(name, version, request = fetch) {
  const url = `${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await request(url, {
    headers: { accept: "application/json" },
    redirect: "error",
  });
  if (response.status === 404) return "missing";
  if (response.status !== 200) {
    throw new Error(`El registro npm respondió ${response.status} al consultar ${name}@${version}`);
  }
  let metadata;
  try {
    metadata = await response.json();
  } catch {
    throw new Error(`Respuesta inválida del registro npm para ${name}@${version}`);
  }
  if (metadata?.name !== name || metadata?.version !== version) {
    throw new Error(`Respuesta inválida del registro npm para ${name}@${version}`);
  }
  return "exists";
}

export async function npmPublish(workspace, run = runCommand) {
  const code = await run(
    "npm",
    [
      "publish",
      "--workspace",
      workspace,
      "--access",
      "public",
      "--provenance",
      "--registry",
      `${REGISTRY}/`,
    ],
    { shell: false, stdio: "inherit" },
  );
  if (code !== 0) throw new Error(`npm publish falló para ${workspace} con código ${code}`);
}

export async function publishMissingWorkspaces({
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  status = packageVersionStatus,
  publish = npmPublish,
  log = console.log,
} = {}) {
  const result = { skipped: [], published: [] };
  for (const workspace of WORKSPACES) {
    const manifest = await readManifest(root, workspace);
    const spec = `${manifest.name}@${manifest.version}`;
    const publication = await status(manifest.name, manifest.version);
    if (publication === "exists") {
      log(`Ya existe ${spec}; se omite.`);
      result.skipped.push(spec);
      continue;
    }
    if (publication !== "missing") throw new Error(`Estado de publicación desconocido para ${spec}`);
    log(`Publicando ${spec} mediante npm Trusted Publishing…`);
    await publish(manifest.name);
    result.published.push(spec);
  }
  return result;
}

async function readManifest(root, workspace) {
  const path = resolve(root, workspace.directory, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest.name !== workspace.name) throw new Error(`${path} debe declarar name=${workspace.name}`);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
    throw new Error(`${workspace.name} debe declarar una versión SemVer estable`);
  }
  if (manifest.private === true) throw new Error(`${workspace.name} no puede publicarse con private=true`);
  if (manifest.publishConfig?.access !== "public") throw new Error(`${workspace.name} debe declarar publishConfig.access=public`);
  const requiredBuildFiles = ["dist/index.js", "dist/index.d.ts"];
  if (workspace.directory === "packages/react") requiredBuildFiles.push("dist/styles.css");
  if (workspace.directory === "packages/render-preview") requiredBuildFiles.push("dist/browser-entry.js", "dist/worker.js");
  for (const relative of requiredBuildFiles) {
    try {
      await readFile(resolve(root, workspace.directory, relative));
    } catch {
      throw new Error(`Falta el artifact validado ${workspace.directory}/${relative}`);
    }
  }
  return manifest;
}

function runCommand(command, args, options) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) reject(new Error(`${command} terminó por señal ${signal}`));
      else resolveCode(code ?? 1);
    });
  });
}

async function main() {
  const { stdout } = await execFileAsync("npm", ["--version"], { encoding: "utf8" });
  if (!supportsTrustedPublishing(stdout)) {
    throw new Error(`npm ${stdout.trim()} no soporta Trusted Publishing; se requiere npm >= 11.5.1`);
  }
  await publishMissingWorkspaces();
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
