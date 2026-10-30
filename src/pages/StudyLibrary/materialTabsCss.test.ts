import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps tabs reachable at narrow widths and enlarged text", () => {
 const css = readFileSync(new URL("./studyLibrary.css", import.meta.url), "utf8");
 expect(css).toMatch(/\.material-tabs\s*\{[^}]*overflow-x:\s*auto/s);
 expect(css).toMatch(/\.material-tabs \.tab\s*\{[^}]*min-height:\s*44px/s);
 expect(css).toMatch(/\.material-tabs \.tab\s*\{[^}]*white-space:\s*nowrap/s);
});

it("wraps header actions, preserves 44px controls and collapses Notes at enlarged narrow widths", () => {
 const css = readFileSync(new URL("./studyLibrary.css", import.meta.url), "utf8");
 expect(css).toMatch(/\.material-detail-header \.page-header\s*\{[^}]*flex-wrap:\s*wrap/s);
 expect(css).toMatch(/\.material-actions-menu summary\s*\{[^}]*min-height:\s*44px/s);
 expect(css).toMatch(/\.material-actions-menu__items \.button\s*\{[^}]*min-height:\s*44px/s);
 expect(css).toMatch(/@media \(max-width: 1080px\)\s*\{\s*\.material-notes-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});

it("shows a button-style focus ring on the section heading that Enter/Space focuses", () => {
 const css = readFileSync(new URL("./studyLibrary.css", import.meta.url), "utf8");
 const rule = css.match(/\.material-panel-heading:focus-visible\s*\{([^}]*)\}/s)?.[1] ?? "";
 expect(rule).toMatch(/position:\s*static/);
 expect(rule).toMatch(/clip:\s*auto/);
 expect(rule).toMatch(/outline:\s*2px solid var\(--accent-primary\)/);
 expect(rule).toMatch(/outline-offset:\s*2px/);
});

it("draws the underline-tab focus ring inside the tab so the scrolling row cannot clip it", () => {
 const css = readFileSync(new URL("./studyLibrary.css", import.meta.url), "utf8");
 expect(css).toMatch(/\.library-tabs\s*\{[^}]*overflow-x:\s*auto/s);
 expect(css).toMatch(/\.library-tab:focus-visible\s*\{[^}]*outline-offset:\s*-4px/s);
});
