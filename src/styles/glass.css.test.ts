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

  it("provides hover lift only inside prefers-reduced-motion: no-preference", () => {
    expect(glassCss).toContain("@media (prefers-reduced-motion: no-preference)");
    const motionBlock = glassCss.slice(
      glassCss.indexOf("@media (prefers-reduced-motion: no-preference)"),
    );
    expect(motionBlock).toMatch(/translateY\(-3px\)/);
    expect(motionBlock).toMatch(/transition:\s*transform\s+150ms/);

    // Make sure hover lift does not occur outside reduced-motion media query
    const beforeMotionBlock = glassCss.slice(
      0,
      glassCss.indexOf("@media (prefers-reduced-motion: no-preference)"),
    );
    expect(beforeMotionBlock).not.toContain("translateY");
  });

  it("provides @supports not fallback with a near-opaque surface", () => {
    expect(glassCss).toMatch(/--glass-surface-opaque:\s*rgba\(255,\s*255,\s*255,\s*0\.94\)/);
    expect(glassCss).toMatch(/@supports\s+not\s+\(\(backdrop-filter:\s*blur\(1px\)\)\s+or\s+\(-webkit-backdrop-filter:\s*blur\(1px\)\)\)/);
    const supportsBlock = glassCss.slice(glassCss.search(/@supports\s+not/), glassCss.indexOf("@media (prefers-reduced-transparency"));
    expect(supportsBlock).toMatch(/background:\s*var\(--glass-surface-opaque\)/);
  });

  it("provides prefers-reduced-transparency: reduce fallback: near-opaque and no blur", () => {
    expect(glassCss).toContain("@media (prefers-reduced-transparency: reduce)");
    const transparencyBlock = glassCss.slice(glassCss.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(transparencyBlock).toMatch(/background:\s*var\(--glass-surface-opaque\)/);
    expect(transparencyBlock).toMatch(/[^-]backdrop-filter:\s*none/);
    expect(transparencyBlock).toMatch(/-webkit-backdrop-filter:\s*none/);
  });

  it("live blur is only on the sidebar and dialogs, never on cards (8 GB Mac)", () => {
    const blurred = new Set<string>();
    const css = glassCss.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/[^-]backdrop-filter:\s*var\(--glass-blur\)/.test(m[2]!)) {
        m[1]!.split(",").map((sel) => sel.trim()).filter(Boolean).forEach((sel) => blurred.add(sel));
      }
    }
    expect([...blurred].sort()).toEqual([
      ':root[data-appearance="glass"] .dialog',
      ':root[data-appearance="glass"] .modal-fallback',
      ':root[data-appearance="glass"] .sidebar',
    ]);
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

    const ivoryHex = getHexToken("--palette-ivory");
    const navyHex = getHexToken("--palette-navy");
    const navyMutedHex = getHexToken("--palette-navy-muted");
    const overdueHex = getHexToken("--status-overdue");
    const dueTodayHex = getHexToken("--status-due-today");

    expect(ivoryHex).toBe("#faf7f4");

    const ivory = parseHex(ivoryHex);
    // Worst case: the strongest palette tint (32%) behind the page, with the
    // 62% white glass card over it. Secondary text also sits on the bare page.
    const tints = ["--palette-rose", "--palette-lavender", "--palette-sky", "--palette-mint"].map((t) => parseHex(getHexToken(t)));
    // Read the real strengths from glass.css so a stronger look can't skip this check.
    const tintAlpha = Math.max(...[...glassCss.matchAll(/radial-gradient\([^,]+,\s*rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/g)].map((m) => Number(m[1])));
    const cardAlpha = Number(glassCss.match(/--glass-surface:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/)![1]);
    expect(tintAlpha).toBeGreaterThan(0);
    const worst = (text: string, onCard: boolean) =>
      Math.min(...tints.map((tint) => {
        const page = blendOver({ ...tint, a: tintAlpha }, ivory);
        return contrastRatio(parseHex(text), onCard ? blendOver({ r: 255, g: 255, b: 255, a: cardAlpha }, page) : page);
      }));

    const primaryContrast = Math.min(worst(navyHex, true), worst(navyHex, false));
    const secondaryContrast = Math.min(worst(navyMutedHex, true), worst(navyMutedHex, false));
    const overdueContrast = worst(overdueHex, true);
    const dueTodayContrast = worst(dueTodayHex, true);

    // WCAG AA requirement: >= 4.5
    expect(primaryContrast).toBeGreaterThanOrEqual(4.5);
    expect(secondaryContrast).toBeGreaterThanOrEqual(4.5);
    expect(overdueContrast).toBeGreaterThanOrEqual(4.5);
    expect(dueTodayContrast).toBeGreaterThanOrEqual(4.5);
  });

  it("tints the Glass background with the chosen accent's pastel, not a fixed blend", () => {
    const modern = glassCss.match(/background-image:[^;]*color-mix[^;]*;/)![0];
    expect(modern).toContain("var(--accent-secondary)");
    expect(modern).not.toMatch(/--palette-(rose|lavender|sky)\)/);
  });
});
