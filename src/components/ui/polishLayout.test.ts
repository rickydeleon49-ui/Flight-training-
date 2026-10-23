import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const ui = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
const study = readFileSync(new URL("../../pages/StudyLibrary/studyLibrary.css", import.meta.url), "utf8");
const base = readFileSync(new URL("../../styles/base.css", import.meta.url), "utf8");

// jsdom cannot measure layout or paint focus rings. Keep these CSS contracts
// alongside the rendered-control tests; browser walkthroughs check the result.
it("leaves extra space before destructive actions and separates the review reset", () => {
  expect(ui).toMatch(/\.destructive-action\s*\{[^}]*margin-inline-start:\s*var\(--space-5\)/);
  expect(study).toMatch(/\.card-review__reset\s*\{[^}]*padding-top:\s*var\(--space-4\)[^}]*border-top:\s*1px solid/);
});

it("keeps focus visible on jump controls and the heading they focus", () => {
  expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  expect(ui).toMatch(/\.section-jump-target:focus\s*\{[^}]*outline:\s*2px solid/);
});
