import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function block(selector: string): Map<string, string> {
  const start = css.indexOf(selector + " {");
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
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
function lum([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const ACCENTS = ["berry", "lavender", "sky", "mint"] as const;
// Add the dark theme here in slice 5: one more entry with its own blocks.
const THEMES = [{ name: "light", base: [block(":root")] }];

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
          accent === "berry" ? theme.base : [...theme.base, block(`:root[data-accent="${accent}"]`)];
        const t = resolver(blocks);
        const L = `${theme.name}/${accent}`;
        const surfaces = ["--surface-page", "--surface-card", "--surface-sunken"];
        for (const s of surfaces) {
          check(`${L} text-primary on ${s}`, t("--text-primary"), t(s), 4.5);
          check(`${L} text-secondary on ${s}`, t("--text-secondary"), t(s), 4.5);
        }
        check(`${L} text-tertiary on card`, t("--text-tertiary"), t("--surface-card"), 3);
        for (const s of ["--status-overdue", "--status-due-today", "--status-complete"]) {
          check(`${L} ${s} on card`, t(s), t("--surface-card"), 4.5);
        }
        check(`${L} accent on card`, t("--accent-primary"), t("--surface-card"), 4.5);
        check(`${L} white on accent`, t("--text-on-accent"), t("--accent-primary"), 4.5);
        check(`${L} border-control on card`, t("--border-control"), t("--surface-card"), 3);
        check(`${L} accent on accent-fill`, t("--accent-primary"), t("--accent-fill"), 3);
      });
    }
  }
  it("prints the table", () => {
    // eslint-disable-next-line no-console
    if (process.env.CONTRAST_TABLE) console.log(rows.join("\n"));
    expect(rows.length).toBeGreaterThan(0);
  });
});
