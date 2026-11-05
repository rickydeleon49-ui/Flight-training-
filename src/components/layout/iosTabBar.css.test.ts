import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("every iOS tab bar rule is scoped to html.is-ios", () => {
  const css = readFileSync(new URL("./iosTabBar.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = css.replace(/\([^)]*\)/g, "").split("}").map((block) => block.split("{")[0]!.trim()).filter(Boolean);
  expect(selectors.length).toBeGreaterThan(5);
  for (const list of selectors) {
    for (const selector of list.split(",")) expect(selector.trim()).toMatch(/^html\.is-ios\b/);
  }
});

it("keeps page content clear of the side notch in landscape", () => {
  const css = readFileSync(new URL("./iosTabBar.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/html\.is-ios \.shell--tabs \.content\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/padding-left:\s*max\([^;]*safe-area-inset-left/);
  expect(rule).toMatch(/padding-right:\s*max\([^;]*safe-area-inset-right/);
});
