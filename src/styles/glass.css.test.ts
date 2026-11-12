import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const GLASS_CSS_PATH = join(ROOT_DIR, "src/styles/glass.css");
const TOKENS_CSS_PATH = join(ROOT_DIR, "src/styles/tokens.css");
const MAIN_TSX_PATH = join(ROOT_DIR, "src/main.tsx");
const PACKAGE_JSON_PATH = join(ROOT_DIR, "package.json");

function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "").trim();
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number },
): number {
  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function blendOver(
  top: { r: number; g: number; b: number; a: number },
  bottom: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
  };
}

function extractStyleSelectors(css: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  let buffer = "";
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (ch === "{") {
      const header = buffer.trim();
      buffer = "";
      if (!header.startsWith("@media") && !header.startsWith("@supports")) {
        selectors.push(...header.split(",").map((s) => s.trim()).filter(Boolean));
      }
    } else if (ch === "}") {
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  return selectors;
}

describe("Glass appearance styles (glass.css)", () => {
  const glassCss = readFileSync(GLASS_CSS_PATH, "utf8");

  it("every rule selector starts with :root[data-appearance=\"glass\"]", () => {
    const selectors = extractStyleSelectors(glassCss);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(
        selector.startsWith(':root[data-appearance="glass"]'),
        `Selector "${selector}" must start with :root[data-appearance="glass"]`,
      ).toBe(true);
    }
  });

  it("every backdrop-filter declaration is paired with -webkit-backdrop-filter", () => {
    const blocks = glassCss.match(/\{[^}]+\}/g) ?? [];
    let checkedBlocks = 0;
    for (const block of blocks) {
      const hasStd = /(?<!-webkit-)backdrop-filter:\s*([^;]+);/.test(block);
      const hasWebkit = /-webkit-backdrop-filter:\s*([^;]+);/.test(block);
      if (hasStd || hasWebkit) {
        expect(hasStd).toBe(true);
        expect(hasWebkit).toBe(true);
        const stdVal = block.match(/(?<!-webkit-)backdrop-filter:\s*([^;]+);/)?.[1]?.trim();
        const webkitVal = block.match(/-webkit-backdrop-filter:\s*([^;]+);/)?.[1]?.trim();
        expect(webkitVal).toBe(stdVal);
        checkedBlocks++;
      }
    }
    expect(checkedBlocks).toBeGreaterThan(0);
  });

  const code = glassCss.replace(/\/\*[\s\S]*?\*\//g, "");

  it("has no hover lift, page wash or glass on cards, sidebar and dialogs", () => {
    expect(code).not.toContain("translateY");
    expect(code).not.toContain("radial-gradient");
    for (const gone of [".card", ".material-card", ".sidebar", ".dialog", ".modal-fallback", "body", ".shell"]) {
      expect(code).not.toContain(gone);
    }
  });

  it("provides @supports not fallback with an opaque bar", () => {
    expect(glassCss).toMatch(/@supports\s+not\s+\(\(backdrop-filter:\s*blur\(1px\)\)\s+or\s+\(-webkit-backdrop-filter:\s*blur\(1px\)\)\)/);
    const supportsBlock = glassCss.slice(glassCss.search(/@supports\s+not/), glassCss.indexOf("@media (prefers-contrast"));
    expect(supportsBlock).toMatch(/background:\s*var\(--surface-card\)/);
  });

  it("provides prefers-contrast: more fallback: opaque, no blur, 1px edge", () => {
    const start = glassCss.indexOf("@media (prefers-contrast: more)");
    expect(start).toBeGreaterThan(-1);
    const block = glassCss.slice(start, glassCss.indexOf("@media (prefers-reduced-transparency"));
    expect(block).toMatch(/background:\s*var\(--surface-card\)/);
    expect(block).toMatch(/[^-]backdrop-filter:\s*none/);
    expect(block).toMatch(/-webkit-backdrop-filter:\s*none/);
    expect(block).toMatch(/1px solid/);
  });

  it("keeps the reduce-transparency block (dead in WebKit, harmless) opaque with no blur", () => {
    const block = glassCss.slice(glassCss.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(block).toMatch(/background:\s*var\(--surface-card\)/);
    expect(block).toMatch(/[^-]backdrop-filter:\s*none/);
  });

  it("live blur is only on the iOS tab bar and the collapsed top bar", () => {
    const blurred = new Set<string>();
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/[^-]backdrop-filter:\s*var\(--glass-blur\)/.test(m[2]!)) {
        m[1]!.split(",").map((sel) => sel.trim()).filter(Boolean).forEach((sel) => blurred.add(sel));
      }
    }
    expect([...blurred].sort()).toEqual([
      ':root[data-appearance="glass"] .top-bar.is-collapsed',
      ':root[data-appearance="glass"].is-ios .ios-tab-bar',
    ]);
    expect(glassCss).toMatch(/--glass-blur:\s*blur\(20px\)\s+saturate\(180%\)/);
  });

  it("main.tsx imports glass.css after other style imports", () => {
    const mainTsx = readFileSync(MAIN_TSX_PATH, "utf8");
    expect(mainTsx).toContain('import "./styles/glass.css";');

    const uiCssPos = mainTsx.indexOf('import "./components/ui/ui.css";');
    const glassCssPos = mainTsx.indexOf('import "./styles/glass.css";');
    expect(uiCssPos).toBeGreaterThan(-1);
    expect(glassCssPos).toBeGreaterThan(uiCssPos);
  });

  it("package.json has no new dependencies", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    expect(allDeps).not.toHaveProperty("framer-motion");
    expect(allDeps).not.toHaveProperty("tailwindcss");
  });

  it("meets WCAG AA contrast (>= 4.5:1) for text tokens over frosted glass on ivory", () => {
    const tokensCss = readFileSync(TOKENS_CSS_PATH, "utf8");

    const getHexToken = (name: string): string => {
      const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      if (!match || !match[1]) throw new Error(`Missing token ${name} in tokens.css`);
      return match[1];
    };

    expect(getHexToken("--palette-ivory")).toBe("#faf7f4");
    const darkStart = tokensCss.indexOf(':root[data-theme="dark"] {');
    const lightPart = tokensCss.slice(0, darkStart);
    const darkPart = tokensCss.slice(darkStart);
    const hexes = (css: string, name: string) =>
      [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map((m) => parseHex(m[1]!));

    const barOf = (re: RegExp) => {
      const m = glassCss.match(re)!;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) };
    };
    const lightBar = barOf(/\[data-appearance="glass"\]\s*\{[^}]*--glass-bar:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    const darkBar = barOf(/\[data-theme="dark"\]\s*\{[^}]*--glass-bar:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    expect(lightBar.a).toBeGreaterThan(0);
    expect(darkBar.a).toBeGreaterThan(0);

    // The bar can sit over the page, a card or any accent fill; check each.
    const worstOver = (bar: typeof lightBar, css: string, white: string, textToken: string) => {
      const text = hexes(css, textToken)[0]!;
      const under = [
        hexes(css, "--palette-ivory")[0]!,
        parseHex(white),
        ...hexes(css, "--accent-fill"),
      ];
      return Math.min(...under.map((u) => contrastRatio(text, blendOver(bar, u))));
    };
    const lightContrast = worstOver(lightBar, lightPart, "#ffffff", "--palette-navy");
    const darkContrast = worstOver(darkBar, darkPart, "#1d2533", "--text-primary");

    // WCAG AA requirement: >= 4.5
    expect(lightContrast).toBeGreaterThanOrEqual(4.5);
    expect(darkContrast).toBeGreaterThanOrEqual(4.5);
  });
});
