import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./studyLibrary.css", import.meta.url), "utf8");
const glass = readFileSync(new URL("../../styles/glass.css", import.meta.url), "utf8");

it("keeps the a.material-card rules for the library list", () => {
  expect(css).toMatch(/\.material-card\s*\{/);
  expect(css).toMatch(/\.material-card:hover\s*\{/);
  expect(readFileSync(new URL("./StudyLibrary.tsx", import.meta.url), "utf8")).toContain('className="material-card"');
});

it("puts no box-shadow on material cards outside glass.css", () => {
  const rules = [...css.matchAll(/([^{}]*\.material-card[^{}]*)\{([^}]*)\}/g)];
  expect(rules.length).toBeGreaterThan(0);
  for (const [, , body] of rules) expect(body).not.toMatch(/box-shadow/);
  expect(glass).toMatch(/\.material-card/);
});

it("scrolls the filter chips sideways on one line on the phone", () => {
  expect(css).toMatch(/\.filter-chips\.scroll-x\s*\{[^}]*flex-wrap:\s*nowrap/s);
});
