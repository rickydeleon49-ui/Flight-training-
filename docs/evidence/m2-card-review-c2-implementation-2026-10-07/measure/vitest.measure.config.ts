// Runs only the C2 measurement in this folder, with the app's "@" alias.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../../../src", import.meta.url)) } },
  test: { environment: "node", include: ["docs/evidence/m2-card-review-c2-implementation-2026-10-07/measure/*.measure.ts"], testTimeout: 600_000 },
});
