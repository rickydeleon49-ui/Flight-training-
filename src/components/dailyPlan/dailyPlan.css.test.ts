import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./dailyPlan.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string) => css.match(new RegExp(`(^|})\\s*${sel.replace(/[.[\]"=-]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[2] ?? "";

it("budget control wraps and stays inside its card at large text", () => {
  const group = rule(".daily-plan-budget-group");
  expect(group).toContain("flex-wrap: wrap");
  expect(group).toContain("max-width: 100%");
});

it("budget options fill a wrapped row and keep their labels whole", () => {
  const btn = rule(".daily-plan-budget-btn");
  expect(btn).toContain("flex: 1 1 auto");
  expect(btn).toContain("white-space: normal");
  expect(btn).toContain("overflow-wrap: break-word");
});

it("budget options reach 44px only when iPhone text is larger than default", () => {
  const big = rule("html.is-ios .daily-plan-budget-btn");
  expect(big).toContain("--ios-system-font-size, 17px) - 17px");
  expect(big).toContain("44px");
  expect(rule(".daily-plan-budget-btn")).not.toContain("min-height");
});
