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

it("gives the back button a 44px target and keeps it inside the content's side insets", () => {
  const css = readFileSync(new URL("./iosTabBar.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/html\.is-ios \.ios-back\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/min-height:\s*44px/);
  expect(rule).toMatch(/min-width:\s*44px/);
  // It sits inside .content, whose left padding already clears the landscape notch.
  const content = css.match(/html\.is-ios \.shell--tabs \.content\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(content).toMatch(/padding-left:\s*max\([^;]*safe-area-inset-left/);
});

it("hides the material page's own Study Library link where the back button shows", () => {
  const css = readFileSync(new URL("./iosTabBar.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/html\.is-ios \.shell--tabs \.material-breadcrumb\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/display:\s*none/);
});

it("the compact tab bar rules change only transform and opacity", () => {
  const css = readFileSync(new URL("./iosTabBar.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]*\.is-compact[^{}]*)\{([^}]*)\}/g)];
  expect(rules.length).toBeGreaterThanOrEqual(3);
  for (const [, , body] of rules) {
    const props = body!.split(";").map((d) => d.split(":")[0]!.trim()).filter(Boolean);
    for (const prop of props) expect(["transform", "opacity"]).toContain(prop);
  }
});

it("tab labels are at least 11px and every tab is at least 44px tall", () => {
  const css = readFileSync(new URL("./iosTabBar.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const label = css.match(/html\.is-ios \.ios-tab-bar__label\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(label).toMatch(/font-size:\s*max\(11px,/);
  const bar = css.match(/html\.is-ios \.ios-tab-bar\s*\{([^}]*min-height[^}]*)\}/)?.[1] ?? "";
  expect(bar).toMatch(/min-height:\s*49px/);
});

it("the phone icon button gets a 44px hit area (32px + 6px each side)", () => {
  const ui = readFileSync(new URL("../ui/ui.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const phone = ui.slice(ui.indexOf("@media (pointer: coarse), (max-width: 700px)"));
  expect(phone).toMatch(/\.icon-button::after\s*\{[^}]*inset:\s*-6px/);
  expect(ui).toMatch(/\.icon-button\s*\{[^}]*width:\s*2rem;[^}]*height:\s*2rem/);
});
