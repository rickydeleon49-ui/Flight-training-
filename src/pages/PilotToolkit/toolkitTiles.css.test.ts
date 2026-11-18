import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");


it("toolkit tiles share equal-height rows", () => {
  expect(read("./pilotToolkit.css")).toMatch(/\.toolkit-tiles\s*\{[^}]*grid-auto-rows:\s*1fr/);
});

it("checklist rows use a 1px hairline with no top border on the first row", () => {
  const css = read("../../styles/layout.css");
  expect(css).toMatch(/\.checklist-row \+ \.checklist-row\s*\{[^}]*border-top:\s*1px solid var\(--border-subtle\)/);
  expect(css).not.toMatch(/(?<!\+ )\.checklist-row\s*\{[^}]*border-top/);
});

it("tile source drops the description line, count badge and category badge", () => {
  const src = read("./PilotToolkit.tsx");
  expect(src).not.toMatch(/toolkit-tile__line/);
  expect(src).not.toMatch(/<Badge>\{entry\.tools\.length/);
  expect(src).not.toMatch(/<Badge>\{group\.label\}/);
});
