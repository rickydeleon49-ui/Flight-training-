import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const tokens = read("src/styles/tokens.css");
const base = read("src/styles/base.css");
const ui = read("src/components/ui/ui.css");
const shell = read("src/components/layout/shell.css");
const iosTabBar = read("src/components/layout/iosTabBar.css");
const allCss = [tokens, base, ui, shell, iosTabBar].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** Body of the first `@media (query) { ... }` block, with nested braces balanced. */
function mediaBlock(css: string, query: string): string | null {
  const start = css.indexOf(`@media (${query})`);
  if (start < 0) return null;
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

/** Declarations of a top-level rule whose selector list contains `selector` exactly. */
function ruleBodies(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const sels = (m[1] ?? "").split(",").map((s) => s.trim());
    if (sels.includes(selector)) bodies.push(m[2] ?? "");
  }
  return bodies;
}

function minHeightPx(value: string): number {
  const v = value.trim();
  if (v.startsWith("var(")) {
    const name = v.slice(4, -1).trim();
    const def = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
    return def?.[1] ? minHeightPx(def[1]) : 0;
  }
  if (v.endsWith("rem")) return parseFloat(v) * 16;
  if (v.endsWith("px")) return parseFloat(v);
  return 0;
}

function maxMinHeight(selector: string): number {
  let best = 0;
  for (const body of ruleBodies(allCss, selector)) {
    const m = /(?:^|[;\s])min-height:\s*([^;]+);/.exec(body);
    if (m?.[1]) best = Math.max(best, minHeightPx(m[1]));
  }
  return best;
}

describe("reduced motion", () => {
  it("has one global override with !important durations", () => {
    const block = mediaBlock(tokens, "prefers-reduced-motion: reduce");
    expect(block).not.toBeNull();
    expect(block).toMatch(/animation-duration:\s*[^;]*!important/);
    expect(block).toMatch(/transition-duration:\s*[^;]*!important/);
  });
});

describe("increase contrast", () => {
  const block = mediaBlock(base, "prefers-contrast: more");
  it("exists and makes the top bar and tab bar solid", () => {
    expect(block).not.toBeNull();
    expect(block).toMatch(/\.top-bar[^{]*\{[^}]*background:\s*var\(--surface-card\)/);
    expect(block).toMatch(/\.ios-tab-bar\s*\{[^}]*background:\s*var\(--surface-card\)/);
  });
  it("strengthens separators, secondary text and the focus ring", () => {
    expect(block).toMatch(/--border-subtle:\s*var\(--border-control\)/);
    expect(block).toMatch(/--text-secondary:\s*var\(--text-primary\)/);
    expect(block).toMatch(/--focus-ring:\s*0 0 0 3px/);
  });
});

describe("touch targets", () => {
  // Compact Mac-pointer controls: dense rows keep these small on a pointer.
  const macPointerException = new Set([".button"]);
  const targets: Array<[string, string[]]> = [
    [".button", [".button--primary", ".button--secondary"]],
    [".list-row", [".list-row"]],
    [".ios-tab-bar__tab", ["html.is-ios .ios-tab-bar"]],
    [".nav__link", [".nav__link"]],
    [".segmented__option", [".segmented__option"]],
    [".icon-button", [".icon-button"]],
  ];
  for (const [name, selectors] of targets) {
    it(`${name} is at least 44px or an explicit exception`, () => {
      if (macPointerException.has(name)) {
        // Base .button is sized by its variants; the full-size ones must be 44px.
        for (const s of selectors) expect(maxMinHeight(s)).toBeGreaterThanOrEqual(44);
        return;
      }
      const best = Math.max(...selectors.map(maxMinHeight));
      if (name === ".icon-button") {
        // 2rem on a Mac pointer; 44px on touch screens.
        const coarse = mediaBlock(base, "pointer: coarse") ?? "";
        expect(coarse).toMatch(/\.icon-button\s*\{[^}]*min-height:\s*44px/);
        return;
      }
      expect(best).toBeGreaterThanOrEqual(44);
    });
  }
});

describe("shared filter chip", () => {
  const body = ruleBodies(ui.replace(/\/\*[\s\S]*?\*\//g, ""), ".filter-chip").join("\n");
  it("wraps long labels instead of clipping", () => {
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/overflow-wrap:\s*(?:break-word|anywhere)/);
    expect(body).toMatch(/max-width:\s*100%/);
    expect(body).not.toMatch(/nowrap/);
  });
  it("active chip has a non-colour cue (bold)", () => {
    const active = ruleBodies(ui.replace(/\/\*[\s\S]*?\*\//g, ""), ".filter-chip.is-active").join("\n");
    expect(active).toMatch(/font-weight:\s*600/);
  });
});

describe("large text does not clip", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const daily = strip(read("src/components/dailyPlan/dailyPlan.css"));
  it("buttons wrap long labels", () => {
    const body = ruleBodies(strip(ui), ".button").join("\n");
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/overflow-wrap:\s*break-word/);
    expect(body).not.toMatch(/nowrap/);
  });
  it("daily plan budget buttons wrap long labels", () => {
    const body = ruleBodies(daily, ".daily-plan-budget-btn").join("\n");
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).not.toMatch(/nowrap/);
  });
  it("list row chevron is sized in rem, not px", () => {
    const body = ruleBodies(strip(ui), ".list-row__chevron").join("\n");
    expect(body).toMatch(/font-size:\s*0\.875rem/);
  });
  it("root font scales with system text size", () => {
    expect(base).not.toMatch(/text-size-adjust:\s*none/);
    expect(base).toMatch(/-apple-system-body/);
  });
});

describe("reduced motion and reduced transparency (DESIGN-01 s40)", () => {
  it("one global reduced-motion rule shortens every animation and transition", () => {
    const block = mediaBlock(tokens.replace(/\/\*[\s\S]*?\*\//g, ""), "prefers-reduced-motion: reduce")!;
    expect(block).toContain("--transition: 0ms");
    expect(block).toMatch(/animation-duration:\s*0\.001ms !important/);
    expect(block).toMatch(/transition-duration:\s*0\.001ms !important/);
  });
  it("no stylesheet turns on smooth scrolling", () => {
    expect(allCss).not.toMatch(/scroll-behavior:\s*smooth/);
  });
  it("glass bars turn solid with no blur under reduced transparency", () => {
    const glass = read("src/styles/glass.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = mediaBlock(glass, "prefers-reduced-transparency: reduce")!;
    expect(block).toMatch(/background:\s*var\(--surface-card\)/);
    expect(block).toMatch(/backdrop-filter:\s*none/);
    expect(block).toContain(".ios-tab-bar");
    expect(block).toContain(".top-bar.is-collapsed");
  });
  it("JS smooth scrolls go through scrollBehavior()", () => {
    for (const f of ["src/components/layout/IosTabBar.tsx", "src/components/ui/BackToTop.tsx", "src/components/dailyPlan/startAction.ts"]) {
      const src = read(f);
      expect(src).not.toContain('"smooth"');
      expect(src).toContain("scrollBehavior()");
    }
  });
});
