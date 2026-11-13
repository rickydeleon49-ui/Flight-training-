import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ui = read("./ui.css");
const tokens = read("../../styles/tokens.css");

const rule = (css: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n");
};

it("control ladder tokens exist", () => {
  expect(tokens).toMatch(/--control-h:\s*40px/);
  expect(tokens).toMatch(/--control-h-sm:\s*36px/);
  expect(tokens).toMatch(/--hit-min:\s*44px/);
});

it("buttons and chips use the ladder", () => {
  expect(rule(ui, ".button")).toMatch(/min-height:\s*var\(--control-h\)/);
  expect(rule(ui, ".filter-chip")).toMatch(/min-height:\s*var\(--control-h-sm\)/);
  expect(ui).toMatch(/\.filter-chip::after\s*\{[^}]*inset:\s*-4px/);
  expect(ui).toMatch(/\.button::after[^{]*\{[^}]*inset:\s*-2px 0/);
});

it("small targets reach 44px", () => {
  expect(rule(ui, ".button--ghost")).toMatch(/min-height:\s*var\(--hit-min\)/);
  expect(ui).toMatch(/\.card__header > a\.small\s*\{[^}]*min-height:\s*var\(--hit-min\)/);
  expect(ui).toMatch(/\.acs-area-material-coverage-details > summary\s*\{[^}]*min-height:\s*var\(--hit-min\)/);
  for (const [file, sel] of [
    ["../../pages/FlightPath/flightPath.css", ".enroll-hide"],
    ["../dailyPlan/dailyPlan.css", ".daily-plan-budget-btn"],
    ["../../pages/Settings/settings.css", ".settings-jumps__link"],
  ] as const) {
    expect(rule(read(file), sel), sel).toMatch(/min-height:\s*(?:var\(--hit-min\)|44px)/);
  }
  expect(rule(read("../../pages/FlightJournal/journal.css"), ".ledger-pager .button")).toMatch(/min-height:\s*2\.75rem/);
});
