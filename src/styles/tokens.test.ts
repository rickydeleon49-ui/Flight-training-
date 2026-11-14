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

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

// Files allowed to hold raw colour literals. Each needs a reason.
const RAW_COLOUR_ALLOWLIST = new Map<string, string>([
  ["styles/tokens.css", "the token definitions themselves"],
  ["styles/glass.css", "rewritten in DESIGN-01 slice 27"],
]);
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

// Type, space, shape and layout tokens are shared by both themes.
const SHARED = /^--(font-|text-(2xs|xs|sm|base|callout|md|title3|lg|xl|2xl|hero)$|leading-|space-|control-|hit-min|rule-|radius-|sidebar-width|content-max|transition)/;

describe("dark twins", () => {
  const raw = readFileSync(join(__dirname, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const names = (selector: string): string[] => {
    const out: string[] = [];
    for (const rule of raw.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (rule[1]!.split("{").pop()!.trim() !== selector) continue;
      for (const m of rule[2]!.matchAll(/(--[\w-]+)\s*:/g)) out.push(m[1]!);
    }
    return out.sort();
  };
  const DARK = ':root[data-theme="dark"]';
  const AUTO = ':root:not([data-theme="light"]):not([data-theme="light-grey"])';
  const cases: [string, string, string][] = [["base", ":root", ""]];
  for (const a of ["lavender", "sky", "mint"]) cases.push([a, `:root[data-accent="${a}"]`, `[data-accent="${a}"]`]);
  for (const [label, light, suffix] of cases) {
    it(`dark twins cover every ${label} light property, under both selectors`, () => {
      const want = names(light).filter((n) => !SHARED.test(n));
      expect(names(DARK + suffix)).toEqual(want);
      expect(names(AUTO + suffix)).toEqual(want);
    });
  }
});

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

  it("no raw colour literals in src CSS outside the allowlist", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    for (const f of cssFiles(root)) {
      const rel = f.slice(root.length + 1).split("\\").join("/");
      if (RAW_COLOUR_ALLOWLIST.has(rel)) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (RAW_COLOUR.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("every var(--x) in TSX source is defined in CSS", () => {
    const root = join(__dirname, "..");
    const defined = new Set<string>(RUNTIME_VARS);
    for (const f of cssFiles(root)) {
      for (const m of readFileSync(f, "utf8").matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]!);
    }
    const missing: string[] = [];
    for (const f of tsxFiles(root)) {
      for (const m of readFileSync(f, "utf8").matchAll(/var\(\s*(--[\w-]+)/g)) {
        // A name ending in "-" is a template prefix (var(--accent-swatch-${x})).
        if (m[1]!.endsWith("-")) continue;
        if (!defined.has(m[1]!)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
