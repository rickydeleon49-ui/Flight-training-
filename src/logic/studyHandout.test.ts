// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { AiStudySet, PracticeTest } from "@/domain/types";
import { makeMaterial } from "@/testing/factories";

import type { ExportSource } from "./studyExport";
import { buildHandoutHtml, escapeHtml } from "./studyHandout";

const NOW = new Date("2026-10-16T18:00:00Z");
const ALL = { guide: true, flashcards: true, questions: true };

const set: AiStudySet = {
  sourceMaterialId: "m",
  title: "Weather",
  summary: "Summary line one\nline two",
  sections: [{ heading: "Reading a METAR", body: "- Station\n- **Wind**\n\n| Code | Meaning |\n| --- | --- |\n| BKN | Broken |" }],
  flashcards: [{ front: "BKN?", back: "Broken", sourcePage: 12 }],
  sourceNotes: "Handbook chapter 24.",
  provider: "gemini",
  model: "gemini-3.5-flash",
  generatedAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};

const test: PracticeTest = {
  sourceMaterialId: "m",
  title: "Weather practice",
  questions: [{ question: "Which is a ceiling?", options: ["Few", "Broken"], correctIndex: 1, explanation: "Broken layers are ceilings.", sourcePage: null }],
  provider: "gemini",
  model: "gemini-3.5-flash",
  generatedAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
};

const source = (overrides: Partial<ExportSource> = {}): ExportSource => ({
  material: makeMaterial({ title: "Aviation Weather", filePath: "documents/secret.pdf", notes: "PRIVATE NOTE" }),
  studySet: set,
  practiceTest: test,
  ...overrides,
});

function page(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("a printable handout", () => {
  it("is one page that can load and run nothing", () => {
    const html = buildHandoutHtml(source(), ALL, { answerKey: true }, NOW);
    const doc = page(html);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(doc.querySelectorAll("script, a, img, iframe, link, object, embed, form")).toHaveLength(0);
  });

  it("shows the guide's formatting, flashcards and questions", () => {
    const doc = page(buildHandoutHtml(source(), ALL, { answerKey: false }, NOW));
    expect(doc.querySelector("h1")?.textContent).toBe("Aviation Weather");
    expect([...doc.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Study guide", "Flashcards", "Practice questions"]);
    expect(doc.querySelector("section strong")?.textContent).toBe("Wind");
    expect([...doc.querySelectorAll("table:not(.cards) td")].map((td) => td.textContent)).toEqual(["BKN", "Broken"]);
    expect(doc.querySelector(".cards tbody td")?.textContent).toBe("BKN?");
    expect(doc.querySelector(".cards tbody")?.textContent).toContain("(source p. 12)");
    expect([...doc.querySelectorAll(".question .choices li")].map((li) => li.textContent)).toEqual(["A. Few", "B. Broken"]);
    expect(doc.querySelector(".notice")?.textContent).toContain("AI-generated study aid (gemini-3.5-flash)");
  });

  it("adds the answer key on its own page only when asked", () => {
    expect(page(buildHandoutHtml(source(), ALL, { answerKey: false }, NOW)).querySelector(".answer-key")).toBeNull();
    const key = page(buildHandoutHtml(source(), ALL, { answerKey: true }, NOW)).querySelector(".answer-key");
    expect(key?.textContent).toContain("1. B: Broken");
    expect(key?.textContent).toContain("Broken layers are ceilings.");
  });

  it("includes only the chosen parts and nothing private", () => {
    const html = buildHandoutHtml(source(), { guide: false, flashcards: true, questions: false }, { answerKey: true }, NOW);
    const doc = page(html);
    expect([...doc.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Flashcards"]);
    expect(doc.querySelector(".answer-key")).toBeNull();
    for (const absent of ["secret.pdf", "PRIVATE NOTE", "Summary line one"]) expect(html).not.toContain(absent);
  });

  it("shows hostile text as text", () => {
    const hostile = '<script>alert(1)</script><img src=x onerror="alert(2)"><a href="https://evil.example">x</a>';
    const html = buildHandoutHtml(
      source({
        material: makeMaterial({ title: `</title><script>alert(0)</script>` }),
        studySet: { ...set, summary: hostile, sections: [{ heading: hostile, body: `${hostile}\n[click](javascript:alert(3))` }] },
        practiceTest: { ...test, questions: [{ ...test.questions[0]!, question: hostile, options: [hostile, "ok"] }] },
      }),
      ALL,
      { answerKey: true },
      NOW,
    );
    const doc = page(html);
    expect(doc.querySelectorAll("script, a, img")).toHaveLength(0);
    expect(doc.title).toBe("</title><script>alert(0)</script>");
    expect(doc.body.textContent).toContain("<script>alert(1)</script>");
    expect(doc.body.textContent).toContain("click (javascript:alert(3))");
  });

  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("authorship in a handout (OFFLINE-03a)", () => {
  const withOrigins: AiStudySet = {
    ...set,
    summaryOrigin: "user",
    flashcards: [
      { ...set.flashcards[0]!, itemId: "c-1", origin: "user" },
      { front: "Corrected?", back: "Yes, by my CFI.", sourcePage: null, itemId: "c-2", origin: "instructor" },
    ],
  };
  const source = { material: { title: "Weather" }, studySet: withOrigins, practiceTest: null };

  it("labels who wrote each item and leaves instructor corrections out by default", () => {
    const html = buildHandoutHtml(source, { guide: true, flashcards: true, questions: false }, { answerKey: false }, new Date("2026-10-19T12:00:00Z"));
    expect(html).toContain("(written by hand)");
    expect(html).not.toContain("by my CFI");
    const included = buildHandoutHtml(source, { guide: true, flashcards: true, questions: false, instructorCorrections: true }, { answerKey: false }, new Date("2026-10-19T12:00:00Z"));
    expect(included).toContain("Yes, by my CFI.");
    expect(included).toContain("(instructor correction)");
  });
});


it("filters and labels authored practice questions without adding answer-key labels or leaking excluded answers", () => {
  const authored = source({ studySet: null, practiceTest: { ...test, questions: [
    { ...test.questions[0]!, origin: "user" },
    { ...test.questions[0]!, question: "Private CFI stem", options: ["Private CFI answer", "Other"], correctIndex: 0, explanation: "Private CFI explanation", origin: "instructor" },
  ] } });
  const html = buildHandoutHtml(authored, ALL, { answerKey: true }, NOW);
  for (const text of ["Private CFI stem", "Private CFI answer", "Private CFI explanation"]) expect(html).not.toContain(text);
  const left = page(html);
  expect(left.querySelectorAll(".question")).toHaveLength(1);
  expect(left.querySelector(".question")?.textContent).toContain("(written by hand)");
  expect(left.querySelectorAll(".answer-key li")).toHaveLength(1);
  const included = page(buildHandoutHtml(authored, { ...ALL, instructorCorrections: true }, { answerKey: true }, NOW));
  expect(included.querySelectorAll(".question")).toHaveLength(2);
  expect(included.querySelectorAll(".question")[1]?.textContent).toContain("(instructor correction)");
  expect(included.querySelector(".answer-key")?.textContent).toContain("Private CFI answer");
  expect(included.querySelector(".answer-key")?.textContent).toContain("Private CFI explanation");
  expect(included.querySelector(".answer-key")?.textContent).not.toMatch(/written by hand|instructor correction/);
  const withoutKey = page(buildHandoutHtml(authored, { ...ALL, instructorCorrections: true }, { answerKey: false }, NOW));
  expect(withoutKey.querySelector(".answer-key")).toBeNull();
  expect(withoutKey.body.textContent).not.toContain("Private CFI explanation");
});
