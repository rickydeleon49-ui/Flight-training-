import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./studyLibrary.css", import.meta.url), "utf8");
const history = readFileSync(new URL("./PracticeHistory.tsx", import.meta.url), "utf8");

it("PACKS-07 lets the per-material history header and summary wrap within a narrow window", () => {
  expect(history).toMatch(/practice-history-detail">\s*<div className="row row--between row--wrap">/);
  expect(history).toContain('className="stack stack--2 practice-history-detail__summary"');
  expect(css).toMatch(/\.practice-history-detail__summary\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
  expect(css).toMatch(/\.practice-history-detail \.page-header > div\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
});

it("PACKS-07 separates missed-topic panels from search results by the normal spacing token", () => {
  expect(css).toMatch(/\.material-grid ~ \.document-search-results\s*\{[^}]*margin-top:\s*var\(--space-5\);/);
  expect(css).toMatch(/\.library__search-topics\s*\{[^}]*margin-top:\s*var\(--space-5\);/);
});
