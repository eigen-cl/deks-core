import { build } from "esbuild";

await build({
  entryPoints: [new URL("../src/browser-entry.ts", import.meta.url).pathname],
  outfile: new URL("../dist/browser-entry.js", import.meta.url).pathname,
  bundle: true,
  format: "iife",
  globalName: "DeksPreviewBrowser",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: false,
  minify: true,
});
