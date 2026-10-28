// The VISUAL-01b proof is developer-only: production code must never import it,
// and a production build must not contain it.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(SRC, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("VISUAL-01b proof boundary", () => {
  it("is referenced only from main.tsx, never by app code", () => {
    const offenders = walk(SRC)
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter((p) => !relative(SRC, p).startsWith("dev/") && relative(SRC, p) !== "main.tsx")
      .filter((p) => /["'](?:@\/dev\/|\.{1,2}\/(?:\.\.\/)*dev\/)/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("is loaded in main.tsx only by a dynamic import inside an import.meta.env.DEV branch", () => {
    const main = readFileSync(join(SRC, "main.tsx"), "utf8");
    expect(main).not.toMatch(/^import[^;]*dev\//m);
    const refs = [...main.matchAll(/dev\/VisualProof/g)];
    expect(refs).toHaveLength(1);
    const guard = main.indexOf("if (import.meta.env.DEV &&");
    const dynamic = main.indexOf('import("./dev/VisualProof")');
    const otherwise = main.indexOf("} else {", guard);
    expect(guard).toBeGreaterThan(-1);
    expect(dynamic).toBeGreaterThan(guard);
    expect(dynamic).toBeLessThan(otherwise);
    // The real app still renders synchronously from a static import.
    expect(main).toMatch(/^import \{ App \} from "\.\/App";$/m);
    expect(main.slice(otherwise)).toContain("<App />");
  });

  it("is absent from a production build", { timeout: 180_000 }, async () => {
    const { build } = await import("vite");
    const outDir = mkdtempSync(join(tmpdir(), "visual-proof-build-"));
    // Vitest sets NODE_ENV=test, which would make Vite keep DEV true; build as `npm run build` does.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), mode: "production", logLevel: "silent", build: { outDir, emptyOutDir: true } });
      const text = walk(outDir).filter((p) => /\.(js|css|html)$/.test(p)).map((p) => readFileSync(p, "utf8")).join("\n");
      expect(text).toContain("Save picture card"); // saved VISUAL-01c cards are production UI
      expect(text).toContain("Flight"); // sanity: the real app was built
      for (const marker of ["Try it — this is not saved", "Try it \\u2014 this is not saved", "visual-proof", "dev/VisualProof", "proof-stage"]) {
        expect(text.includes(marker), marker).toBe(false);
      }
    } finally {
      process.env.NODE_ENV = nodeEnv;
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
