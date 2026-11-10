import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Custom properties that are set at runtime (JS), not in CSS.
const RUNTIME_VARS = new Set(["--ios-system-font-size"]);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith(".css") ? [p] : [];
  });
}

describe("css custom properties", () => {
  it("every var(--x) used in src CSS is defined somewhere", () => {
    const files = cssFiles(join(__dirname, ".."));
    const sources = files.map((f) => [f, readFileSync(f, "utf8")] as const);
    const defined = new Set<string>(RUNTIME_VARS);
    for (const [, text] of sources) {
      for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]!);
    }
    const missing: string[] = [];
    for (const [file, text] of sources) {
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!defined.has(m[1]!)) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
