import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@deks-js/document": fileURLToPath(new URL("../document/src/index.ts", import.meta.url)),
      "@deks-js/renderer-core": fileURLToPath(new URL("../renderer-core/src/index.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["browser-tests/**/*.test.ts"], testTimeout: 20_000 },
});
