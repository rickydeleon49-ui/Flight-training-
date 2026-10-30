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
