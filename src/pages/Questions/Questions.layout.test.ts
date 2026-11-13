import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/pages/Questions/questions.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("Questions layout css", () => {
  it("goes two-column in wide content", () => {
    expect(css).toMatch(/@container \(min-width: 960px\)[\s\S]*grid-template-columns:\s*minmax\(300px, 380px\) minmax\(0, 1fr\)/);
  });
  it("keeps the narrow list at a readable width", () => {
    expect(css).toMatch(/\.questions\s*\{[^}]*max-width:\s*720px/);
  });
  it("sections use a 20px/600 title and a hairline", () => {
    expect(css).toMatch(/\.questions__section \.card__title\s*\{[^}]*font-size:\s*var\(--text-title3\);[^}]*font-weight:\s*600/);
    expect(css).toMatch(/border-bottom:\s*1px solid var\(--border-subtle\)/);
  });
  it("row actions are one line with 44px targets, status select on the control scale", () => {
    expect(css).toMatch(/\.question-row__tools\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.question-row__tools \.button\s*\{[^}]*min-height:\s*var\(--hit-min\)/);
    expect(css).toMatch(/select\s*\{[^}]*width:\s*auto;[^}]*min-height:\s*var\(--control-h\)/);
  });
});
