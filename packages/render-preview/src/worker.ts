#!/usr/bin/env node
import { createInterface } from "node:readline";
import { PreviewRenderer, previewSha256, type PreviewRequest } from "./index.js";

interface WorkerRequest extends PreviewRequest { id: string }

const renderer = new PreviewRenderer();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

input.on("line", (line) => {
  queue = queue.then(async () => {
    let request: WorkerRequest;
    try {
      request = JSON.parse(line) as WorkerRequest;
      if (!request || typeof request.id !== "string" || !request.id) throw new Error("Invalid preview request id.");
    } catch {
      write({ id: null, ok: false, error: { code: "invalid_request", message: "Invalid preview worker request." } });
      return;
    }
    try {
      const result = await renderer.render(request);
      write({
        id: request.id,
        ok: true,
        png_base64: result.png.toString("base64"),
        width: result.width,
        height: result.height,
        byte_size: result.png.byteLength,
        sha256: previewSha256(result.png),
      });
    } catch (error) {
      write({
        id: request.id,
        ok: false,
        error: {
          code: "render_failed",
          message: error instanceof Error ? error.message : "Preview rendering failed.",
        },
      });
    }
  });
});

async function shutdown(): Promise<void> {
  input.close();
  await queue;
  await renderer.close();
}

process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.stdin.once("end", () => void shutdown());
