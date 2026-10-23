import { describe, expect, it } from "vitest";
import type { AiStudySet, PracticeTest } from "@/domain/types";
import { makeMaterial } from "@/testing/factories";
import { buildMarkdownBundle } from "./studyMarkdown";
import { hasCredentialLikeText } from "./studyPacket/semantic";

const source = {
  material: makeMaterial({ title: "../Weather / METARs" }),
  studySet: {
    sourceMaterialId: "m", title: "Weather", summary: "Short guide", summaryOrigin: "user",
    summaryPdfProvenance: { status: "valid", label: "Pulled from your PDF on this Mac", sources: [{ page: 3, startOffset: 0, endOffset: 1, quote: "x", itemKind: "summary", logicalId: "s", contentHash: "h", runId: "r" }] },
    sections: [
      { heading: "METARs", body: "## Decode\n\nRead the wind.", pdfProvenance: { status: "valid", label: "Pulled from your PDF on this Mac", sources: [{ page: 8 }], editOrigin: "instructor" }, origin: "instructor" },
      { heading: "METARs", body: "Cloud codes." },
      { heading: "METARs", body: "A second authored section." },
    ],
    flashcards: [{ front: "BKN?", back: "Broken", sourcePage: 12 }], sourceNotes: "Source notes",
    provider: "manual", model: "", generatedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  } as unknown as AiStudySet,
  practiceTest: { sourceMaterialId: "m", title: "Practice", questions: [
    { question: "Ceiling?", options: ["Few", "Broken"], correctIndex: 1, explanation: "Broken is.", sourcePage: 14 },
    { question: "Instructor-only?", options: ["Yes", "No"], correctIndex: 0, explanation: "Private", sourcePage: null, origin: "instructor" },
  ], provider: "manual", model: "", generatedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" } as unknown as PracticeTest,
};
const all = { guide: true, flashcards: true, questions: true };

describe("Obsidian Markdown bundle", () => {
  it("writes index, summary, one note per section, cards and answered practice with page and provenance labels", () => {
    const entries = buildMarkdownBundle(source, { ...all, instructorCorrections: true });
    expect(entries.map((e) => e.name)).toEqual([
      "index.md", "weather-metars-summary.md", "weather-metars-guide-metars.md", "weather-metars-guide-metars-2.md", "weather-metars-guide-metars-3.md", "weather-metars-flashcards.md", "weather-metars-practice-questions.md",
    ]);
    expect(entries[0]!.text).toContain("[\\.\\./Weather / METARs — METARs](./weather-metars-guide-metars.md)");
    expect(entries[1]!.text).toContain("Source pages: p. 3");
    expect(entries[2]!.text).toContain("Instructor correction");
    expect(entries[2]!.text).toContain("Source pages: p. 8");
    expect(entries[3]!.text).toContain("Cloud codes.");
    expect(entries[4]!.text).toContain("A second authored section.");
    expect(entries[5]!.text).toContain("Source pages: p. 12");
    expect(entries[6]!.text).toContain("**Answer:** Broken");
    expect(entries[6]!.text).toContain("Source pages: p. 14");
    expect(entries[0]!.text).toContain("Some items pulled from a PDF");
    expect(entries.map((e) => e.text).join("\n")).not.toContain("PRIVATE NOTE");
    expect(entries.map((e) => e.text).join("\n")).not.toContain("Source notes");
  });

  it("filters instructor corrections until the explicit opt-in is selected", () => {
    const entries = buildMarkdownBundle(source, { ...all, instructorCorrections: false });
    expect(entries.some((e) => e.text.includes("Instructor-only?"))).toBe(false);
    expect(entries.some((e) => e.text.includes("Private"))).toBe(false);
    expect(entries.some((e) => e.text.includes("Instructor correction"))).toBe(false);
    const optedIn = buildMarkdownBundle(source, { ...all, instructorCorrections: true });
    expect(optedIn.some((e) => e.text.includes("Instructor-only?"))).toBe(true);
  });

  it("uses bounded flat filenames and avoids case-insensitive collisions", () => {
    const entries = buildMarkdownBundle({ ...source, material: makeMaterial({ title: "...".repeat(90) }) }, all);
    const names = entries.map((e) => e.name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(80);
      expect(name).toMatch(/^[a-z0-9-]+\.md$/);
      expect(name).not.toMatch(/(?:^|\/)\.\.(?:\/|$)/);
    }
  });

  it("uses the shared credential pattern guard for exported note content", () => {
    expect(hasCredentialLikeText(`AIza${"C".repeat(35)}`)).toBe(true);
    expect(hasCredentialLikeText("METAR KSEA 121753Z" )).toBe(false);
  });

  it("keeps imported HTML and remote image syntax inert in Markdown notes", () => {
    const unsafe = { ...source, studySet: { ...source.studySet!, sections: [{ heading: "<img src=x>", body: '<script>alert(1)</script> ![tracking](https://example.invalid/pixel)' }] } };
    const entry = buildMarkdownBundle(unsafe, { guide: true, flashcards: false, questions: false }).find((item) => item.name.includes("guide"))!;
    expect(entry.text).toContain("\\<img src=x\\>");
    expect(entry.text).toContain("&lt;script>alert(1)&lt;/script>");
    expect(entry.text).toContain("\\![tracking](https://example.invalid/pixel)");
    expect(entry.text).not.toContain("<script>");
  });
});
