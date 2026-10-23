// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeTest } from "@/domain/types";
import * as geminiService from "@/services/gemini";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";

describe("PracticeTestPanel", () => {
  let db: TestDatabase;
  let repos: Repositories;

  const sampleTest: PracticeTest = {
    sourceMaterialId: "mat-1",
    title: "Traffic Pattern Operations",
    questions: [
      {
        question: "What is the standard traffic pattern altitude at most non-towered airports?",
        options: ["800 feet AGL", "1,000 feet AGL", "1,500 feet AGL"],
        correctIndex: 1,
        explanation: "Standard pattern altitude is 1,000 feet AGL unless otherwise specified in the Chart Supplement.",
        sourcePage: 42,
      },
      {
        question: "Which leg of the traffic pattern is flown parallel to the runway opposite the direction of landing?",
        options: ["Crosswind", "Downwind", "Base leg"],
        correctIndex: 1,
        explanation: "The downwind leg is parallel to the runway in the opposite direction of landing.",
        sourcePage: null,
      },
    ],
    provider: "gemini",
    model: "gemini-3.5-flash",
    generatedAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    await repos.documents.create({ id: sampleTest.sourceMaterialId, title: sampleTest.title });
    await repos.documents.savePracticeTest(sampleTest);
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db?.close();
  });

  async function renderPanel(ui: React.ReactElement) {
    const value = {
      repositories: repos,
      data: EMPTY_DATA,
      status: "ready",
      error: null,
    } as ContextType<typeof AppDataContext>;
    const view = render(h(AppDataContext.Provider, { value }, ui));
    await screen.findByText("Question 1 of 2");
    return view;
  }

  it.each([false, true])("STUDENT-1: Continue restores the next heading after a long Ask answer (reduced motion %s)", async (reduced) => {
    const scroll = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
    vi.spyOn(geminiService, "watchAskGeminiProgress").mockResolvedValue(() => {});
    const answer = "A long synthetic explanation. ".repeat(200);
    vi.spyOn(geminiService, "askGemini").mockResolvedValue({ answer, sourcePages: [] });
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask a question" }), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(answer.trim());
    scroll.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const heading = await screen.findByRole("heading", { name: "Question 2 of 2" });
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: reduced ? "auto" : "smooth" });
    expect(screen.queryByText(answer.trim())).toBeNull();
    scroll.mockClear();
    // A user can also go back to an answered question without losing the heading.
    fireEvent.click(screen.getByRole("button", { name: "Question 1, not quite" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Question 1 of 2" }));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: reduced ? "auto" : "smooth" });
  });

  it("STUDENT-1: tiles distinguish incorrect, correct, unanswered and current", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));
    expect(screen.getByRole("button", { name: "Question 1, unanswered" }).className).toContain("practice-pill--current");
    expect(screen.getByRole("button", { name: "Question 2, unanswered" }).className).toBe("practice-pill");
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    expect(screen.getByRole("button", { name: "Question 1, not quite" }).className).toContain("practice-pill--incorrect");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Question 2 of 2");
    expect(screen.getByRole("button", { name: "Question 1, not quite" }).className).not.toContain("practice-pill--current");
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    const correct = screen.getByRole("button", { name: "Question 2, correct" });
    expect(correct.className).toContain("practice-pill--correct");
    expect(correct.className).toContain("practice-pill--current");
  });

  it("renders the first question with options in radiogroup", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(screen.getByText("Source p. 42")).toBeTruthy();
    expect(screen.getByText(/standard traffic pattern altitude/)).toBeTruthy();

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toContain("800 feet AGL");
    expect(options[1]?.textContent).toContain("1,000 feet AGL");
    expect(options[2]?.textContent).toContain("1,500 feet AGL");
  });

  it("reveals explanation and marks answer as correct when choosing correct option", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[1]!); // 1,000 feet AGL is correct

    await screen.findByText("Correct");
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));

    // Radio buttons should be disabled once revealed
    for (const opt of screen.getAllByRole("radio")) {
      expect(opt.hasAttribute("disabled")).toBe(true);
    }
  });

  it("reveals explanation and marks answer as incorrect when choosing wrong option", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!); // 800 feet AGL is wrong

    await screen.findByText("Not quite");
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
  });

  it("navigates through questions and calculates final score, allowing retake", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    // Q1: answer correctly
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    const cont1 = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(cont1.hasAttribute("disabled")).toBe(false));
    fireEvent.click(cont1);

    // Q2: answer incorrectly
    await screen.findByText("Question 2 of 2");
    expect(screen.getByText("Check source")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("radio")[0]!); // Crosswind is wrong

    await screen.findByText("Not quite");
    const scoreBtn = screen.getByRole("button", { name: "See score" });
    await waitFor(() => expect(scoreBtn.hasAttribute("disabled")).toBe(false));

    // Finish test
    fireEvent.click(scoreBtn);

    await screen.findByText("Practice test complete");
    expect(screen.getByText("1 of 2 correct")).toBeTruthy();

    // Retake
    const retakeButton = screen.getByRole("button", { name: "Retake this test" });
    await waitFor(() => expect(retakeButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retakeButton);

    await screen.findByText("Question 1 of 2");
  });

  it("supports keyboard navigation with arrows, Home, End, Space and Enter", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    // Only one option in tab order initially
    expect(options[0]?.getAttribute("tabindex")).toBe("0");
    expect(options[1]?.getAttribute("tabindex")).toBe("-1");
    expect(options[2]?.getAttribute("tabindex")).toBe("-1");

    // ArrowDown moves focus to option 1
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("tabindex")).toBe("0");
    expect(options[0]?.getAttribute("tabindex")).toBe("-1");

    // ArrowRight moves focus to option 2
    fireEvent.keyDown(options[1]!, { key: "ArrowRight" });
    expect(options[2]?.getAttribute("tabindex")).toBe("0");

    // ArrowDown wraps to option 0
    fireEvent.keyDown(options[2]!, { key: "ArrowDown" });
    expect(options[0]?.getAttribute("tabindex")).toBe("0");

    // ArrowUp wraps to option 2 (last)
    fireEvent.keyDown(options[0]!, { key: "ArrowUp" });
    expect(options[2]?.getAttribute("tabindex")).toBe("0");

    // Home moves to option 0
    fireEvent.keyDown(options[2]!, { key: "Home" });
    expect(options[0]?.getAttribute("tabindex")).toBe("0");

    // End moves to option 2
    fireEvent.keyDown(options[0]!, { key: "End" });
    expect(options[2]?.getAttribute("tabindex")).toBe("0");

    // Move to option 1 (correct answer) and press Enter to select
    fireEvent.keyDown(options[2]!, { key: "ArrowUp" });
    expect(options[1]?.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(options[1]!, { key: "Enter" });

    // Answer should now be revealed and focus moved to Continue
    await screen.findByText("Correct");
    expect(screen.getAllByRole("radio")[1]?.getAttribute("aria-label")).toContain("Correct answer");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);
  });

  it("moves focus to Continue on mouse click, and to the next heading on Continue", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!);

    await screen.findByText("Not quite");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);

    // Click Continue and verify focus moves to the Question 2 heading
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);
    await screen.findByText("Question 2 of 2");
    const nextOptions = screen.getAllByRole("radio");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Question 2 of 2" }));
    expect(nextOptions[0]?.getAttribute("tabindex")).toBe("0");
  });

  it("moves focus to Continue on Space, and to See score after final question answer selection", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    // Press Space on option 1 (Question 1)
    fireEvent.keyDown(options[1]!, { key: " " });

    await screen.findByText("Correct");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);

    // Advance to Question 2 (final question)
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);
    await screen.findByText("Question 2 of 2");
    const q2Options = screen.getAllByRole("radio");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Question 2 of 2" }));

    // Select final question answer with Enter
    fireEvent.keyDown(q2Options[1]!, { key: "Enter" });
    await screen.findByText("Correct");
    const seeScoreBtn = screen.getByRole("button", { name: "See score" });
    expect(document.activeElement).toBe(seeScoreBtn);
  });

  it("moves focus to See score when final question is selected via mouse click or Space", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    // Advance to final question
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);

    // Click final question option
    await screen.findByText("Question 2 of 2");
    const finalOptions = screen.getAllByRole("radio");
    fireEvent.click(finalOptions[0]!);

    await screen.findByText("Not quite");
    const seeScoreBtn = screen.getByRole("button", { name: "See score" });
    expect(document.activeElement).toBe(seeScoreBtn);
  });
});
