import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ui = read("src/components/ui/ui.css");
const undo = read("src/components/undo/undoBar.css");
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const phone = ui.slice(ui.indexOf("@media (pointer: coarse), (max-width: 700px)"));

describe("phone hit areas", () => {
  it("small buttons reach 44px on phones", () => {
    expect(phone).toMatch(/\.button--small\s*\{\s*min-height:\s*44px/);
  });
  it("checkbox and radio rows get a transparent 44px hit area", () => {
    expect(phone).toMatch(/\.checkbox::before,\s*\.radio-row__option::before\s*\{[^}]*inset:\s*-12px 0/);
    expect(phone).toMatch(/\.radio-row__option\s*\{\s*min-height:\s*44px/);
  });
  it("undo action is 44px tall", () => {
    expect(undo).toMatch(/\.undo-bar__action\s*\{[^}]*min-height:\s*44px/);
  });
});

describe("safe areas", () => {
  it("viewport covers the notch", () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });
  it("undo bar clears the home indicator", () => {
    expect(undo).toMatch(/\.undo-bar\s*\{[^}]*bottom:\s*calc\([^;]*safe-area-inset-bottom/);
  });
});
