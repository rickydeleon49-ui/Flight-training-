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

  it("narrow layout gives spare height to the page, not the top bar", () => {
    const narrow = css.slice(css.indexOf("@media (max-width: 999px)"));
    const shellRule = narrow.slice(narrow.indexOf(".shell {"), narrow.indexOf("}", narrow.indexOf(".shell {")));
    expect(shellRule).toContain("grid-template-rows: auto 1fr");
  });
});
