// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PracticeTest } from "@/domain/types";
import { PracticeTestPanel } from "./PracticeTestPanel";

afterEach(cleanup);

describe("PracticeTestPanel", () => {
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

  it("renders the first question with options in radiogroup", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(screen.getByText("Source p. 42")).toBeTruthy();
    expect(screen.getByText(/standard traffic pattern altitude/)).toBeTruthy();

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toContain("800 feet AGL");
    expect(options[1]?.textContent).toContain("1,000 feet AGL");
    expect(options[2]?.textContent).toContain("1,500 feet AGL");
  });

  it("reveals explanation and marks answer as correct when choosing correct option", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[1]!); // 1,000 feet AGL is correct

    expect(screen.getByText("Correct")).toBeTruthy();
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();

    // Radio buttons should be disabled once revealed
    for (const opt of options) {
      expect(opt.hasAttribute("disabled")).toBe(true);
    }
  });

  it("reveals explanation and marks answer as incorrect when choosing wrong option", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!); // 800 feet AGL is wrong

    expect(screen.getByText("Not quite")).toBeTruthy();
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
  });

  it("navigates through questions and calculates final score, allowing retake", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

    // Q1: answer correctly
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Q2: answer incorrectly
    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    expect(screen.getByText("Check source")).toBeTruthy(); // sourcePage is null
    fireEvent.click(screen.getAllByRole("radio")[0]!); // Crosswind is wrong

    expect(screen.getByText("Not quite")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See score" })).toBeTruthy();

    // Finish test
    fireEvent.click(screen.getByRole("button", { name: "See score" }));

    expect(screen.getByText("Practice test complete")).toBeTruthy();
    expect(screen.getByText("1 of 2 correct")).toBeTruthy();

    // Retake
    const retakeButton = screen.getByRole("button", { name: "Retake this test" });
    fireEvent.click(retakeButton);

    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
  });

  it("supports keyboard navigation with arrows, Home, End, Space and Enter", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

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
    expect(screen.getByText("Correct")).toBeTruthy();
    expect(options[1]?.getAttribute("aria-label")).toContain("Correct answer");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);
  });

  it("moves focus to Continue on mouse click, and to first option of next question on Continue", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!);

    expect(screen.getByText("Not quite")).toBeTruthy();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);

    // Click Continue and verify focus moves to first option of Question 2
    fireEvent.click(continueBtn);
    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    const nextOptions = screen.getAllByRole("radio");
    expect(document.activeElement).toBe(nextOptions[0]);
    expect(nextOptions[0]?.getAttribute("tabindex")).toBe("0");
  });

  it("moves focus to Continue on Space, and to See score after final question answer selection", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    // Press Space on option 1 (Question 1)
    fireEvent.keyDown(options[1]!, { key: " " });

    expect(screen.getByText("Correct")).toBeTruthy();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);

    // Advance to Question 2 (final question)
    fireEvent.click(continueBtn);
    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    const q2Options = screen.getAllByRole("radio");
    expect(document.activeElement).toBe(q2Options[0]);

    // Select final question answer with Enter
    fireEvent.keyDown(q2Options[1]!, { key: "Enter" });
    const seeScoreBtn = screen.getByRole("button", { name: "See score" });
    expect(document.activeElement).toBe(seeScoreBtn);
  });

  it("moves focus to See score when final question is selected via mouse click or Space", () => {
    render(h(PracticeTestPanel, { practiceTest: sampleTest }));

    // Advance to final question
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Click final question option
    const finalOptions = screen.getAllByRole("radio");
    fireEvent.click(finalOptions[0]!);

    const seeScoreBtn = screen.getByRole("button", { name: "See score" });
    expect(document.activeElement).toBe(seeScoreBtn);
  });
});
