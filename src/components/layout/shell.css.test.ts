/**
 * Source guard for a compact-window layout fix. jsdom does not lay out CSS,
 * so this only keeps the rule from being removed by accident. The behaviour
 * itself was verified in Chromium: at 470 px wide, a screen-reader-only label
 * inside a nav link widened the page to 824 px; with the compact `.nav` as
 * its containing block the page stays 470 px and the nav scrolls on its own
 * (docs/PERFORMANCE_POLISH_2026-09-27.md).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/components/layout/shell.css"), "utf8").replace(/\r\n/g, "\n");

describe("compact navigation layout", () => {
  it("keeps the compact nav as the containing block for its hidden labels", () => {
    const compact = css.slice(css.indexOf("@media (max-width: 900px)"));
    const navRule = compact.slice(compact.indexOf("  .nav {"), compact.indexOf("}", compact.indexOf("  .nav {")));
    expect(navRule).toContain("overflow-x: auto");
    expect(navRule).toContain("position: relative");
  });
});
