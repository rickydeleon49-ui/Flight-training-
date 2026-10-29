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

it("keeps narrow navigation sticky and leaves space above section destinations", () => {
  const shell = readFileSync(new URL("../layout/shell.css", import.meta.url), "utf8");
  const narrow = shell.slice(shell.indexOf("@media (max-width: 999px)"));
  expect(narrow).toMatch(/\.shell\s*\{[^}]*display: block;/);
  expect(narrow).toMatch(/\.sidebar\s*\{[^}]*position: sticky;[^}]*top: 0;[^}]*align-self: start;[^}]*z-index: 20;[^}]*max-height: 100vh;[^}]*overflow: hidden;/);
  expect(narrow).toMatch(/\.sidebar__navigation\s*\{[^}]*grid-column: 1 \/ -1;[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  expect(narrow).toMatch(/\.sidebar__menu\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  expect(narrow).toContain("scroll-margin-top: calc(var(--narrow-header-height, 0px) + var(--space-5))");
});

it("styles preparation example copy as a hint", () => {
  const schedule = readFileSync(new URL("../../pages/Schedule/schedule.css", import.meta.url), "utf8");
  expect(schedule).toMatch(/\.inline-add \.input::placeholder\s*\{[^}]*font-style: italic/);
});
