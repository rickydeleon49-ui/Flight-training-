// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { AiStudySet, PracticeTest } from "@/domain/types";
import { makeMaterial } from "@/testing/factories";

import type { ExportSource } from "./studyExport";
import { buildHandoutHtml, buildMultiMaterialHandoutHtml, escapeHtml } from "./studyHandout";

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
    expect(doc.querySelector(".print-help")?.textContent).toBe("To make a PDF, open this file in a browser, choose Print, then Save as PDF.");
    expect(html).toContain("@page { size: auto; margin: 0.6in; }");
    expect(html).toContain("thead { display: table-header-group; }");
    expect(html).toContain("h2, h3 { break-after: avoid; page-break-after: avoid; }");
    expect(html).toContain(".cards tr, .question, li { break-inside: avoid; page-break-inside: avoid; }");
    expect(html).toContain(".practice-heading-keep { break-inside: avoid; page-break-inside: avoid; }");
    expect(html).toContain("overflow-wrap: anywhere;");
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

describe("a combined printable handout", () => {
  const second = source({
    material: makeMaterial({ title: "Crosswind" }),
    studySet: { ...set, summary: "Second material guide", flashcards: [] },
    practiceTest: { ...test, title: "Crosswind practice", questions: [{ ...test.questions[0]!, question: "Second material question", explanation: "Second material explanation" }] },
  });

  it("keeps material order, headings, and source page labels", () => {
    const html = buildMultiMaterialHandoutHtml([
      { source: source(), selection: ALL },
      { source: second, selection: ALL },
    ], { answerKey: false }, NOW);
    const doc = page(html);
    expect([...doc.querySelectorAll(".material > h2")].map((heading) => heading.textContent)).toEqual(["Aviation Weather", "Crosswind"]);
    expect(doc.body.textContent).toContain("Aviation Weather:");
    expect(doc.body.textContent).toContain("(source p. 12)");
    expect(doc.body.textContent).toContain("Second material guide");
    expect(doc.querySelector(".print-help")?.textContent).toContain("choose Print, then Save as PDF");
  });

  it("filters corrections per material and puts the optional answer key last", () => {
    const corrected = source({
      studySet: { ...set, flashcards: [{ front: "Private CFI card", back: "Private card back", sourcePage: null, origin: "instructor" }] },
      practiceTest: { ...test, questions: [{ ...test.questions[0]!, question: "Private CFI question", options: ["Private CFI answer", "Other"], correctIndex: 0, explanation: "Private CFI explanation", origin: "instructor" }] },
    });
    const doc = page(buildMultiMaterialHandoutHtml([
      { source: corrected, selection: { ...ALL, instructorCorrections: false } },
      { source: second, selection: { ...ALL, instructorCorrections: true } },
    ], { answerKey: true }, NOW));
    expect(doc.body.textContent).not.toContain("Private CFI");
    expect(doc.body.textContent).toContain("Second material explanation");
    const keys = [...doc.querySelectorAll(".answer-key")];
    expect(keys).toHaveLength(1);
    expect(doc.body.lastElementChild).toBe(keys[0]);
    expect(keys[0]?.textContent).toContain("1. B: Broken");
  });

  it("omits all answer and explanation data when the key is off", () => {
    const html = buildMultiMaterialHandoutHtml([
      { source: source(), selection: ALL },
      { source: second, selection: ALL },
    ], { answerKey: false }, NOW);
    expect(html).not.toContain("Broken layers are ceilings.");
    expect(html).not.toContain("Second material explanation");
    expect(page(html).querySelector(".answer-key")).toBeNull();
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

describe("practice questions heading keep group in print", () => {
  const multiQuestionTest: PracticeTest = {
    sourceMaterialId: "m",
    title: "Multi-question practice",
    questions: [
      {
        question: "First question stem?",
        options: ["Option 1A", "Option 1B"],
        correctIndex: 0,
        explanation: "Explanation 1.",
        sourcePage: 10,
      },
      {
        question: "Second question stem?",
        options: ["Option 2A", "Option 2B"],
        correctIndex: 1,
        explanation: "Explanation 2.",
        sourcePage: 11,
      },
      {
        question: "Third question stem?",
        options: ["Option 3A", "Option 3B"],
        correctIndex: 0,
        explanation: "Explanation 3.",
        sourcePage: 12,
      },
    ],
    provider: "gemini",
    model: "gemini-3.5-flash",
    generatedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
  };

  it("encloses Practice questions heading and first question in .practice-heading-keep while keeping remaining questions outside", () => {
    const html = buildHandoutHtml(
      source({ practiceTest: multiQuestionTest }),
      { guide: false, flashcards: false, questions: true },
      { answerKey: true },
      NOW,
    );
    const doc = page(html);

    const keepGroup = doc.querySelector(".practice-heading-keep");
    expect(keepGroup).not.toBeNull();

    // Heading is inside the keep group
    const heading = keepGroup?.querySelector("h2");
    expect(heading?.textContent).toBe("Practice questions");

    // First question is inside the keep group
    const firstQ = keepGroup?.querySelector(".question");
    expect(firstQ).not.toBeNull();
    expect(firstQ?.textContent).toContain("First question stem?");
    expect(firstQ?.textContent).toContain("(source p. 10)");

    // Only one question in the keep group
    expect(keepGroup?.querySelectorAll(".question")).toHaveLength(1);

    // Remaining questions exist outside the keep group under the same section
    const section = keepGroup?.parentElement;
    expect(section?.tagName.toLowerCase()).toBe("section");
    const allQuestions = section?.querySelectorAll(".question");
    expect(allQuestions).toHaveLength(3);

    // Verify ordering
    expect(allQuestions?.[0]?.textContent).toContain("1. First question stem?");
    expect(allQuestions?.[1]?.textContent).toContain("2. Second question stem?");
    expect(allQuestions?.[2]?.textContent).toContain("3. Third question stem?");

    // Second and third questions are not inside the keep group
    expect(allQuestions?.[1]?.parentElement).toBe(section);
    expect(allQuestions?.[2]?.parentElement).toBe(section);

    // Answer key stays separate with page break
    const answerKey = doc.querySelector(".answer-key");
    expect(answerKey).not.toBeNull();
    expect(answerKey?.parentElement).not.toBe(section);
    expect(answerKey?.textContent).toContain("1. A: Option 1A");
    expect(answerKey?.textContent).toContain("2. B: Option 2B");
  });

  it("applies keep group in combined handout as well", () => {
    const firstSource = source({
      material: makeMaterial({ title: "Material 1" }),
      practiceTest: multiQuestionTest,
    });
    const secondSource = source({
      material: makeMaterial({ title: "Material 2" }),
      practiceTest: multiQuestionTest,
    });

    const html = buildMultiMaterialHandoutHtml(
      [
        { source: firstSource, selection: { guide: false, flashcards: false, questions: true } },
        { source: secondSource, selection: { guide: false, flashcards: false, questions: true } },
      ],
      { answerKey: true },
      NOW,
    );
    const doc = page(html);

    const keepGroups = doc.querySelectorAll(".practice-heading-keep");
    expect(keepGroups).toHaveLength(2);

    for (const group of keepGroups) {
      expect(group.querySelector("h2")?.textContent).toBe("Practice questions");
      expect(group.querySelectorAll(".question")).toHaveLength(1);
      expect(group.querySelector(".question")?.textContent).toContain("1. First question stem?");
    }

    const answerKey = doc.querySelector(".answer-key");
    expect(answerKey).not.toBeNull();
    expect(doc.body.lastElementChild).toBe(answerKey);
  });
});
