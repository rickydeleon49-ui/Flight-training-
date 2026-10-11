/**
 * Runs the M3 prototype tests from the repository root, with the app's
 * alias and React plugin. Production `vite.config.ts` is not changed: its
 * `src/**` include never picks these files up.
 *
 *   npx vitest run --config docs/evidence/m3-skills-evidence-scope-2026-10-10/vitest.config.ts
 */
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { "@": `${root}src` } },
  test: {
    environment: "node",
    include: ["docs/evidence/m3-skills-evidence-scope-2026-10-10/tests/**/*.test.{ts,tsx}"],
    testTimeout: 120_000,
  },
});
