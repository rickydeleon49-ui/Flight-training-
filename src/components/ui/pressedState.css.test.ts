import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const files = [
  read("./ui.css"),
  read("../layout/shell.css"),
  read("../layout/iosTabBar.css"),
  read("../../pages/StudyLibrary/studyLibrary.css"),
].join("\n");

it.each([
  ".button", ".list-row", ".filter-chip", ".badge--button", ".segmented__option", ".checkbox",
  ".radio-row__option", ".library-tab", ".search-field__clear", ".nav__link", ".ios-tab-bar__tab", ".ios-back",
])("%s has a visible :active style", (cls) => {
  expect(files).toMatch(new RegExp(`${cls.replace(/\./g, "\\.")}(?![\\w-])[^{}]*:active`));
});

it("keeps focus-visible rings", () => {
  expect(read("../../styles/base.css")).toContain(":focus-visible");
  expect(read("../layout/iosTabBar.css")).not.toMatch(/focus[^{]*\{[^}]*outline:\s*none/);
});
