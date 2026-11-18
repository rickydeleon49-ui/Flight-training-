import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("switch off-state override exists only under dark selectors", () => {
  const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
  const lines = css.split("\n").filter((l) => l.includes("input:not(:checked) + .checkbox__mark"));
  expect(lines.length).toBe(4);
  for (const l of lines) expect(l).toMatch(/data-theme="dark"|:root:not\(\[data-theme="light"\]\)/);
  expect(css).toMatch(/data-theme="dark"\] \.checkbox--switch input:not\(:checked\) \+ \.checkbox__mark::after \{ background: var\(--text-primary\)/);
});
