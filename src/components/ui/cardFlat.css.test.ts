import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("card--flat drops border and shadow, section has no box", () => {
  const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.card--flat\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;/);
  expect(css).toMatch(/\.section\s*\{[^}]*box-shadow:\s*none;/);
  expect(css).toMatch(/\.section__header\s*\{[^}]*flex-wrap:\s*wrap;/);
  expect(css).toMatch(/\.section__title\s*\{[^}]*--text-title3[^}]*min-width:\s*0;/);
});
