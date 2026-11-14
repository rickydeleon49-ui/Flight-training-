import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("polish-r15c target size and overlap", () => {
  const study = read("src/pages/StudyLibrary/studyLibrary.css");
  it("closed disclosures do not lay out their contents", () => {
    expect(study).toMatch(/details:not\(\[open\]\) > :not\(summary\)[^{]*\{\s*display:\s*none/);
    expect(study).toMatch(/\.library__actions-more:not\(\[open\]\) > :not\(summary\)/);
  });
  it("video link fields are 44px tall", () => {
    expect(study).toMatch(/\.material-detail \.field input[^{]*\{\s*min-height:\s*var\(--hit-min\)/);
  });
  it("Flight Path checklist and skill links have a 44px hit area", () => {
    expect(read("src/pages/FlightPath/flightPath.css")).toMatch(/\.enroll-checklist li > a\.small\s*\{[^}]*min-height:\s*var\(--hit-min\)/);
    expect(read("src/pages/FlightPath/skills/skills.css")).toMatch(/\.skills-topic__item \.stack > a\s*\{[^}]*min-height:\s*var\(--hit-min\)/);
  });
});

describe("BL-01 jump targets clear the sticky top bar", () => {
  it("desktop scroll-margin-top is the 44px bar plus a gap, practice test included", () => {
    const ui = read("src/components/ui/ui.css");
    expect(ui).toMatch(/\.section-jump-target,[^{]*#material-practice-test\s*\{\s*scroll-margin-top:\s*calc\(44px \+ var\(--space-5\)\)/);
    expect(read("src/components/layout/shell.css")).toMatch(/\.shell #material-practice-test\s*\{\s*scroll-margin-top:\s*calc\(var\(--narrow-header-height, 0px\) \+ var\(--space-5\)\)/);
  });
});
