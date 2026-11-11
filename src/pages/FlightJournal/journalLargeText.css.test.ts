import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./journal.css", import.meta.url), "utf8");

it("lets the journal view switch wrap at the largest text size instead of clipping", () => {
  const rule = css.match(/\.view-tabs\.filter-chips\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/flex-wrap:\s*wrap/);
  expect(rule).not.toMatch(/flex-wrap:\s*nowrap/);
  expect(rule).toMatch(/gap:\s*12px 2px/);
});
