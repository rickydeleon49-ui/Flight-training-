import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOPIC_LABELS } from "@/domain/types";
import { AI_ILLUSTRATION_LABEL, DIAGRAMS, diagramPhotoAlt, diagramSourceLine, diagramsByTopic, diagramsForTopic, scopeDiagramSvg } from "./diagrams";

const ROOT = join(__dirname, "..", "assets", "diagrams");
const read = (diagram: { set: string; file: string }) => readFileSync(join(ROOT, diagram.set, diagram.file), "utf8");
const shipped = readdirSync(ROOT).flatMap((set) =>
  readdirSync(join(ROOT, set)).filter((f) => f.endsWith(".svg") || f.endsWith(".jpg")).map((file) => `${set}/${file}`));
const SVGS = DIAGRAMS.filter((d) => d.kind !== "photo");

describe("diagram manifest", () => {
  it("resolves every entry to a file, with a unique id", () => {
    for (const diagram of DIAGRAMS) expect(existsSync(join(ROOT, diagram.set, diagram.file)), diagram.id).toBe(true);
    expect(new Set(DIAGRAMS.map((d) => d.id)).size).toBe(DIAGRAMS.length);
  });

  it("lists every shipped SVG and picture, and nothing else", () => {
    expect(DIAGRAMS.map((d) => `${d.set}/${d.file}`).sort()).toEqual([...shipped].sort());
  });

  it("uses valid topics and a source on every entry", () => {
    for (const diagram of DIAGRAMS) {
      expect(Object.keys(TOPIC_LABELS), diagram.id).toContain(diagram.topic);
      expect(diagram.title.length, diagram.id).toBeGreaterThan(3);
      expect(diagram.source, diagram.id).toMatch(/^(PHAK ch\. \d+|AI-made illustration|[A-Z][\w' ]+)$/);
    }
  });

  it("looks diagrams up by topic, in the app's topic order", () => {
    expect(diagramsForTopic("weather").every((d) => d.topic === "weather")).toBe(true);
    expect(diagramsForTopic("weather").length).toBeGreaterThan(0);
    expect(diagramsForTopic("landings").length).toBe(5);
    const groups = diagramsByTopic();
    expect(groups.reduce((n, g) => n + g.diagrams.length, 0)).toBe(DIAGRAMS.length);
    const order = Object.keys(TOPIC_LABELS);
    expect(groups.map((g) => order.indexOf(g.topic))).toEqual(groups.map((g) => order.indexOf(g.topic)).sort((a, b) => a - b));
    expect(groups.every((g) => g.label === TOPIC_LABELS[g.topic])).toBe(true);
  });

  it("words the source line plainly", () => {
    const phak = DIAGRAMS.find((d) => d.source === "PHAK ch. 5")!;
    expect(diagramSourceLine(phak)).toBe("Drawn from the FAA Pilot's Handbook (PHAK), ch. 5. Study aid: check with your instructor.");
    const guide = SVGS.find((d) => !d.source.startsWith("PHAK"))!;
    expect(diagramSourceLine(guide)).toBe(`Drawn from the FAA ${guide.source}. Study aid: check with your instructor.`);
  });
});

describe("AI-made pictures", () => {
  const photos = DIAGRAMS.filter((d) => d.kind === "photo");
  it("are flagged, labelled in the alt text (not repeated in the source line), and small", () => {
    expect(photos.map((d) => d.id).sort()).toEqual(["photos/aileron", "photos/airport-beacon", "photos/fuel-sump", "photos/main-wheel", "photos/oil-dipstick", "photos/pitot-tube", "photos/propeller", "photos/stall-warning", "photos/static-port", "photos/tie-down", "photos/windsock", "photos/wing-frost"]);
    for (const p of photos) {
      expect(p.aiIllustration).toBe(true);
      expect(diagramPhotoAlt(p)).toContain(AI_ILLUSTRATION_LABEL);
      expect(diagramSourceLine(p)).toBe("Made with AI as a study aid for this app.");
      expect(statSync(join(ROOT, p.set, p.file)).size).toBeLessThan(200 * 1024);
    }
    expect(SVGS.every((d) => !d.aiIllustration && !d.kind)).toBe(true);
  });
});

describe("shipped SVG files", () => {
  it("each has a title, a description and real text, with no images or scripts", () => {
    for (const diagram of SVGS) {
      const svg = read(diagram);
      expect(svg, diagram.id).toMatch(/<title[^>]*>[^<]+<\/title>/);
      expect(svg, diagram.id).toMatch(/<desc[^>]*>[^<]+<\/desc>/);
      expect(svg, diagram.id).toMatch(/<text[\s>]/);
      expect(svg, diagram.id).not.toMatch(/<image|base64|<script|<foreignObject|\son[a-z]+=/i);
    }
  });

  it("stay under 3 MB in total", () => {
    const bytes = DIAGRAMS.reduce((n, d) => n + statSync(join(ROOT, d.set, d.file)).size, 0);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it("are already minified (run node scripts/minify-diagrams.mjs)", () => {
    for (const diagram of SVGS) {
      const svg = read(diagram);
      expect(svg, diagram.id).not.toContain("<!--");
      expect(svg, diagram.id).not.toMatch(/>\s*\n\s+<(?!\/?(?:tspan|text)\b)/);
    }
  });

  it("only use colour variables that every theme defines", () => {
    const tokens = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const own = readFileSync(join(__dirname, "..", "pages", "StudyLibrary", "diagrams.css"), "utf8");
    const names = (selector: string): Set<string> => {
      const out = new Set<string>();
      for (const rule of tokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (rule[1]!.trim() !== selector) continue;
        for (const m of rule[2]!.matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]!);
      }
      return out;
    };
    // Light grey and the accents only override a few surfaces, so Light, Dark and Auto-dark are the three that matter.
    const themes = [":root", ':root[data-theme="dark"]', ':root:not([data-theme="light"]):not([data-theme="light-grey"])'].map(names);
    const used = new Set<string>();
    for (const diagram of SVGS) for (const m of read(diagram).matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      if (name === "--bg") expect(own, name).toMatch(/--bg\s*:/); // set by diagrams.css on every diagram
      else for (const theme of themes) expect(theme.has(name), name).toBe(true);
    }
  });
});

describe("scopeDiagramSvg", () => {
  const text = (svg: string) => [...svg.replace(/<style[\s\S]*?<\/style>/g, "").matchAll(/>([^<]+)</g)].map((m) => m[1]);

  it("keeps the visible text the same and prefixes every id and reference", () => {
    for (const diagram of SVGS) {
      const svg = read(diagram);
      const scoped = scopeDiagramSvg(svg, "dgx1-");
      expect(text(scoped), diagram.id).toEqual(text(svg));
      for (const m of scoped.matchAll(/\bid="([^"]+)"/g)) expect(m[1], diagram.id).toMatch(/^dgx1-/);
      for (const m of scoped.matchAll(/url\(#([^)]+)\)/g)) expect(m[1], diagram.id).toMatch(/^dgx1-/);
      for (const m of scoped.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
        for (const id of m[1]!.split(" ")) expect(scoped, diagram.id).toContain(`id="${id}"`);
      }
    }
  });

  it("scopes style rules to the copy, so sets cannot restyle each other", () => {
    const scoped = scopeDiagramSvg('<svg><style>.t{fill:red}.a,.b{x:1}</style><text class="t">Hi</text></svg>', "dgx2-");
    expect(scoped).toContain(".dgx2 .t{fill:red}");
    expect(scoped).toContain(".dgx2 .a,.dgx2 .b{x:1}");
  });
});
