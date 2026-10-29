/**
 * Source guard for the hidden screen-reader label containment fix. jsdom does
 * not lay out CSS, so this keeps the global `.nav` containing block in place.
 * The vertical disclosure replaced the old horizontal scroll strip, while the
 * containing block is still needed to keep hidden labels inside navigation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/components/layout/shell.css"), "utf8").replace(/\r\n/g, "\n");

describe("navigation layout", () => {
  it("keeps the global nav as the containing block for its hidden labels", () => {
    const navRule = css.slice(css.indexOf(".nav {"), css.indexOf("}", css.indexOf(".nav {")));
    expect(navRule).toContain("position: relative");
  });

  it("narrow layout lets the sticky top bar travel through the whole page", () => {
    const narrow = css.slice(css.indexOf("@media (max-width: 999px)"));
    const shellRule = narrow.slice(narrow.indexOf(".shell {"), narrow.indexOf("}", narrow.indexOf(".shell {")));
    expect(shellRule).toContain("display: block");
  });
});

it("narrow menu keeps a top row and a full-width, independently scrolling list", () => {
  const narrow = css.slice(css.indexOf("@media (max-width: 999px)"));
  const rule = (selector: string) => {
    const start = narrow.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return narrow.slice(start, narrow.indexOf("}", start));
  };
  const sidebar = rule(".sidebar");
  expect(sidebar).toContain("display: grid");
  expect(sidebar).toContain("grid-template-columns: minmax(0, 1fr) auto");
  expect(sidebar).toContain("grid-template-rows: auto;");
  expect(sidebar).toContain("grid-auto-rows: minmax(0, 1fr)");
  expect(sidebar).toContain("position: sticky");
  expect(sidebar).toContain("top: 0");
  expect(sidebar).toContain("max-height: 100vh");
  expect(sidebar).toContain("overflow: hidden");
  const navigation = rule(".sidebar__navigation");
  expect(navigation).toContain("grid-column: 1 / -1");
  expect(navigation).toContain("align-self: stretch");
  expect(navigation).toContain("min-height: 0");
  expect(navigation).toContain("overflow-y: auto");
  expect(rule(".sidebar__menu")).toContain("min-height: 44px");
  expect(css).toContain(".sidebar__menu[hidden] { display: none; }");
});
