import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("the Oral questions jump target clears the sticky top bar like the practice test", () => {
  const ui = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../layout/shell.css", import.meta.url), "utf8");
  expect(ui).toMatch(/#material-oral\s*\{\s*scroll-margin-top/);
  expect(shell).toMatch(/\.shell #material-oral\s*\{/);
});
