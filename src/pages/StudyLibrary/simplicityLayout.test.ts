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

it("PACKS-07 separates content search results by the normal spacing token", () => {
  expect(css).toMatch(/\.material-grid ~ \.document-search-results\s*\{[^}]*margin-top:\s*var\(--space-5\);/);
});

it("PACKS-08 wraps bookmark rows so title stays full width and buttons sit below when space is short", () => {
  expect(css).toMatch(/\.bookmark-row\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  expect(css).toMatch(/\.bookmark-row__title\s*\{[^}]*flex:\s*1\s+1\s+16rem;[^}]*min-width:\s*0;/);
  expect(css).toMatch(/\.bookmark-row__actions\s*\{[^}]*flex:\s*0\s+1\s+auto;[^}]*flex-wrap:\s*wrap;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  expect(css).toMatch(/\.bookmark-row__actions \.destructive-action\s*\{[^}]*margin-inline-start:/);
});
