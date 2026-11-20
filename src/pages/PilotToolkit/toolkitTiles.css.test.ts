import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");


it("toolkit home is three short lists with hairline-separated rows", () => {
  const css = read("./pilotToolkit.css");
  expect(css).toMatch(/\.toolkit-links > li \+ li\s*\{[^}]*border-top:\s*1px solid var\(--border-subtle\)/);
  expect(css).not.toMatch(/\.toolkit-tile\b/);
});

it("checklist rows use a 1px hairline with no top border on the first row", () => {
  const css = read("../../styles/layout.css");
  expect(css).toMatch(/\.checklist-row \+ \.checklist-row\s*\{[^}]*border-top:\s*1px solid var\(--border-subtle\)/);
  expect(css).not.toMatch(/(?<!\+ )\.checklist-row\s*\{[^}]*border-top/);
});

it("list source drops the count badge and category badge", () => {
  const src = read("./PilotToolkit.tsx");
  expect(src).not.toMatch(/<Badge>\{entry\.tools\.length/);
  expect(src).not.toMatch(/<Badge>\{group\.label\}/);
});
