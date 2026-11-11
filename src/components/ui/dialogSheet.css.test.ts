import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

it("every iPhone sheet rule is under html.is-ios", () => {
  const start = css.indexOf("@keyframes sheet-up");
  const end = css.indexOf(".quick-find[open]");
  const region = css.slice(start, end).replace(/:has\([^)]*\)/g, ":has()");
  for (const m of region.matchAll(/(^|})\s*([^{}@]+)\{/g)) {
    for (const s of m[2]!.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (s === "from" || s === "to") continue;
      expect(s.startsWith("html.is-ios"), s).toBe(true);
    }
  }
});

it("declares 92vh before 92dvh", () => {
  const vh = css.indexOf("max-height: 92vh");
  expect(vh).toBeGreaterThan(-1);
  expect(css.indexOf("max-height: 92dvh")).toBeGreaterThan(vh);
});

it("does not wrap sheet or menu animations in a reduced-motion query", () => {
  expect(css).not.toContain("prefers-reduced-motion: no-preference");
  for (const m of css.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{([^@]*?\n\})/g)) {
    expect(m[1]).not.toMatch(/sheet-up|popover-in/);
  }
});
