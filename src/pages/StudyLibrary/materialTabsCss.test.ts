import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps tabs reachable at narrow widths and enlarged text", () => {
 const css = readFileSync(new URL("./studyLibrary.css", import.meta.url), "utf8");
 expect(css).toMatch(/\.material-tabs\s*\{[^}]*overflow-x:\s*auto/s);
 expect(css).toMatch(/\.material-tabs \.tab\s*\{[^}]*min-height:\s*44px/s);
 expect(css).toMatch(/\.material-tabs \.tab\s*\{[^}]*white-space:\s*nowrap/s);
});
