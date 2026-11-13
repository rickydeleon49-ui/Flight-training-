import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("S9 sections and control scale", () => {
  it("Notes composer, Schedule month and Toolkit read-only blocks use Section", () => {
    expect(read("./Notes/Notes.tsx")).toContain('<Section title="Write something down">');
    expect(read("./Schedule/Schedule.tsx")).toContain("<Section\n          title={formatMonthYear(monthAnchor)}");
    const tk = read("./PilotToolkit/PilotToolkit.tsx");
    for (const t of ["Current goals", "Recent instructor feedback", "Discussion notes"]) {
      expect(tk).toContain(`<Section title="${t}">`);
    }
  });
  it("empty states are compact and targets use the tokens", () => {
    expect(read("./Notes/Notes.tsx")).toMatch(/<EmptyState\s+compact/);
    expect(read("./Schedule/Schedule.tsx")).toMatch(/<EmptyState\s+compact/);
    expect(read("./Notes/notes.css")).toContain("var(--hit-min)");
    expect(read("./PilotToolkit/pilotToolkit.css")).toContain("var(--hit-min)");
    expect(read("./Schedule/schedule.css")).toContain("var(--hit-min)");
  });
});
