import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function block(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  let found = false;
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // A rule inside @media carries the at-rule text before its own selector.
    const sel = rule[1]!.split("{").pop()!.trim();
    if (sel !== selector) continue;
    found = true;
    for (const m of rule[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  }
  if (!found) throw new Error(`no block ${selector}`);
  return out;
}

// A theme is a list of blocks, later ones overriding earlier ones.
function resolver(blocks: Map<string, string>[]) {
  const get = (name: string, depth = 0): string => {
    if (depth > 10) throw new Error(`var loop at ${name}`);
    let v: string | undefined;
    for (const b of blocks) if (b.has(name)) v = b.get(name);
    if (v === undefined) throw new Error(`undefined token ${name}`);
    const m = v.match(/^var\((--[\w-]+)\)$/);
    return m ? get(m[1]!, depth + 1) : v;
  };
  return get;
}

type Rgb = [number, number, number];
function hex(h: string): Rgb {
  const c = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) as Rgb;
}
// Opaque colour of a hex or rgba() value laid over a solid background.
function flatten(v: string, over: string): string {
  const m = v.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (!m) return v;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const bg = hex(over);
  const mix = [m[1], m[2], m[3]].map((c, i) => Math.round(Number(c) * a + bg[i]! * (1 - a)));
  return "#" + mix.map((n) => n.toString(16).padStart(2, "0")).join("");
}
function lum([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a0: string, b: string): number {
  const a = flatten(a0, b);
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const ACCENTS = ["berry", "lavender", "sky", "mint"] as const;
const DARK_ATTR = ':root[data-theme="dark"]';
const DARK_AUTO = ':root:not([data-theme="light"]):not([data-theme="light-grey"])';
const THEMES = [
  { name: "light", base: [block(":root")], accentSel: (a: string) => `:root[data-accent="${a}"]` },
  {
    name: "light-grey",
    base: [block(":root"), block(':root[data-theme="light-grey"]')],
    accentSel: (a: string) => `:root[data-theme="light-grey"][data-accent="${a}"]`,
  },
  {
    name: "dark",
    base: [block(":root"), block(DARK_ATTR)],
    accentSel: (a: string) => `${DARK_ATTR}[data-accent="${a}"]`,
  },
];

const rows: string[] = [];
function check(label: string, fg: string, bg: string, min: number) {
  const r = ratio(fg, bg);
  rows.push(`${label.padEnd(52)} ${r.toFixed(2).padStart(6)}  (min ${min})`);
  expect(r, `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
}

describe("colour contrast (WCAG 2.x)", () => {
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      it(`${theme.name} / ${accent}`, () => {
        const blocks =
          accent === "berry" ? theme.base : [
                ...theme.base,
                block(`:root[data-accent="${accent}"]`),
                ...(theme.name !== "light" ? [block(theme.accentSel(accent))] : []),
              ];
        const t = resolver(blocks);
        const L = `${theme.name}/${accent}`;
        const surfaces = ["--surface-page", "--surface-card", "--surface-sunken"];
        for (const s of surfaces) {
          check(`${L} text-primary on ${s}`, t("--text-primary"), t(s), 4.5);
          check(`${L} text-secondary on ${s}`, t("--text-secondary"), t(s), 4.5);
        }
        // Light keeps its original tertiary grey; dark and light-grey helper text must reach AA (DESIGN-02).
        const tertiaryMin = theme.name === "light" ? 3 : 4.5;
        check(`${L} text-tertiary on card`, t("--text-tertiary"), t("--surface-card"), tertiaryMin);
        if (theme.name !== "light") {
          check(`${L} text-tertiary on page`, t("--text-tertiary"), t("--surface-page"), 4.5);
          check(`${L} text-tertiary on sunken`, t("--text-tertiary"), t("--surface-sunken"), 4.5);
        }
        for (const s of ["--status-overdue", "--status-due-today", "--status-complete"]) {
          check(`${L} ${s} on card`, t(s), t("--surface-card"), 4.5);
        }
        check(`${L} accent on card`, t("--accent-primary"), t("--surface-card"), 4.5);
        check(`${L} white on accent`, t("--text-on-accent"), t("--accent-primary"), 4.5);
        check(`${L} border-control on card`, t("--border-control"), t("--surface-card"), 3);
        for (const k of ["study", "flight", "complete"]) {
          check(`${L} category-${k}-ink on fill`, t(`--category-${k}-ink`), t(`--category-${k}-fill`), 4.5);
        }
        check(`${L} overdue on overdue-fill`, t("--status-overdue"), t("--status-overdue-fill"), 4.5);
        check(`${L} due-today on due-today-fill`, t("--status-due-today"), t("--status-due-today-fill"), 4.5);
        check(`${L} accent on accent-fill`, t("--accent-primary"), t("--accent-fill"), 3);
        // Filter chips: active chip text on its tint, inactive chip text on the sunken track.
        check(`${L} chip active: accent on accent-fill`, t("--accent-primary"), t("--accent-fill"), 4.5);
        check(`${L} chip inactive: text-secondary on sunken`, t("--text-secondary"), t("--surface-sunken"), 4.5);
        if (theme.name === "dark") {
          check(`${L} journal tab active: on-accent on border-control`, t("--text-on-accent"), t("--border-control"), 4.5);
        }
      });
    }
  }
  it("the two dark blocks declare the same properties and values", () => {
    const pairs: [string, string][] = [[DARK_ATTR, DARK_AUTO]];
    for (const a of ACCENTS.slice(1)) pairs.push([`${DARK_ATTR}[data-accent="${a}"]`, `${DARK_AUTO}[data-accent="${a}"]`]);
    for (const [x, y] of pairs) {
      expect([...block(y)], `${y} drifted from ${x}`).toEqual([...block(x)]);
    }
  });
  it("prints the table", () => {
    // eslint-disable-next-line no-console
    if (process.env.CONTRAST_TABLE) console.log(rows.join("\n"));
    expect(rows.length).toBeGreaterThan(0);
  });
});
