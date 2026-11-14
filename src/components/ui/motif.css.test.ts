import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("motif tokens: flat meter fill and brand mark, ledger rule, hit-min pager", () => {
  const ui = read("./ui.css");
  expect(read("../../styles/tokens.css")).toMatch(/--rule-ledger-width:\s*1px/);
  expect(ui.match(/\.meter__fill\s*\{([^}]*)\}/)?.[1]).not.toMatch(/gradient/);
  expect(ui).toMatch(/\.ledger-rule\s*\{[^}]*var\(--border-subtle\)/);
  expect(ui).toMatch(/prefers-reduced-motion[^{]*\{\s*\.meter__fill\s*\{\s*transition:\s*none/);
  expect(read("../layout/shell.css").match(/\.brand__mark\s*\{([^}]*)\}/)?.[1]).not.toMatch(/gradient|brand-mark-fill/);
  expect(read("../../pages/FlightJournal/journal.css")).toMatch(/\.ledger-pager \.button\s*\{[^}]*min-height:\s*var\(--hit-min\)/);
});
