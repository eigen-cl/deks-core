import { Worker } from "node:worker_threads";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEasing } from "../src/index.js";

describe("easing validation boundary", () => {
  it.each(["linear", "ease-in", "ease-out", "ease-in-out", "cubic-bezier(.1, -2, 1., .5)", "cubic-bezier( 0 , 0.25 , 1 , 3 )"])("accepts existing easing grammar: %s", (value) => {
    expect(validateEasing(value)).toBe(true);
  });

  it.each(["ease", "cubic-bezier(0,0,1)", "cubic-bezier(0,0,1,1,1)", "cubic-bezier(,0,1,1)", "cubic-bezier(.,0,1,1)", "cubic-bezier(-,0,1,1)", "cubic-bezier(+0,0,1,1)", "cubic-bezier(1e-2,0,1,1)", "cubic-bezier(0.1.2,0,1,1)", "cubic-bezier(0,NaN,1,1)", "cubic-bezier(-.1,0,1,1)", "cubic-bezier(0,0,1.1,1)"])("rejects invalid grammar or control bounds: %s", (value) => {
    expect(validateEasing(value)).toBe(false);
  });

  it("rejects adversarial numeric strings without blocking a renderer worker", async () => {
    // Keep the regression bounded even against the old quadratic regex.
    // The worker uses the built public implementation, not a replacement parser.
    const result = await new Promise<boolean | "deadline-exceeded">((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require("node:worker_threads");
        import(workerData.moduleUrl).then(({ validateEasing }) => {
          parentPort.postMessage(validateEasing(workerData.input));
        });
      `, { eval: true, workerData: {
        moduleUrl: pathToFileURL(resolvePath("dist/validation.js")).href,
        input: `cubic-bezier(${"9".repeat(100_000)}x,0,1,1)`,
      } });
      const deadline = setTimeout(() => {
        void worker.terminate();
        resolve("deadline-exceeded");
      }, 1_000);
      worker.once("message", (value: boolean) => { clearTimeout(deadline); void worker.terminate(); resolve(value); });
      worker.once("error", (error) => { clearTimeout(deadline); void worker.terminate(); reject(error); });
    });
    expect(result).toBe(false);
  });
});
