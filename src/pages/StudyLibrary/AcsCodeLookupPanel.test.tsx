// @vitest-environment jsdom
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AiStudySet,
  PracticeTest,
  Question,
  StudyMaterial,
} from "@/domain/types";
import { AcsCodeLookupPanel } from "./AcsCodeLookupPanel";

describe("AcsCodeLookupPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const mockMaterial: StudyMaterial = {
    id: "mat-1",
    title: "Radio Communications Guide",
    materialType: "study_guide",
    topic: "regulations",
    reviewStatus: "studying",
    priority: "next_up",
    goalId: null,
    eventId: null,
    notes: "",
    filePath: null,
    originalFileName: null,
    fileSize: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    lastReviewedAt: null,
    tags: ["PA.III.A.K1"],
  };

  const mockStudySet: AiStudySet = {
    sourceMaterialId: "mat-1",
    title: "Radio Comm Flashcards",
    summary: "Summary",
    sections: [],
    flashcards: [{ itemId: "fc-1", front: "Q", back: "A", sourcePage: null }],
    sourceNotes: "",
    provider: "manual",
    model: "",
    generatedAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };

  const mockPracticeTest: PracticeTest = {
    sourceMaterialId: "mat-1",
    title: "Radio Comm Practice Test",
    questions: [],
    provider: "manual",
    model: "",
    generatedAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };

  const mockQuestion: Question = {
    id: "q-1",
    materialId: "mat-1",
    topic: "regulations",
    eventId: null,
    journalId: null,
    text: "What frequency?",
    answer: "122.8",
    status: "to_ask",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    answeredAt: null,
  };

  it("renders accessible label, hint, and submit button", () => {
    render(
      <MemoryRouter>
        <AcsCodeLookupPanel
          materials={[mockMaterial]}
          aiStudySets={[mockStudySet]}
          practiceTests={[mockPracticeTest]}
          questions={[mockQuestion]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: /find study materials for missed topics/i })).toBeTruthy();
    expect(screen.getByLabelText(/missed topic codes/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /find study materials/i })).toBeTruthy();
  });

  it("matches current ACS code, links to material, and displays sub-content counts without localStorage access", () => {
    render(
      <MemoryRouter>
        <AcsCodeLookupPanel
          materials={[mockMaterial]}
          aiStudySets={[mockStudySet]}
          practiceTests={[mockPracticeTest]}
          questions={[mockQuestion]}
        />
      </MemoryRouter>
    );

    const textarea = screen.getByLabelText(/missed topic codes/i);
    fireEvent.change(textarea, { target: { value: "PA.III.A.K1" } });

    const submitBtn = screen.getByRole("button", { name: /find study materials/i });
    fireEvent.click(submitBtn);

    expect(localStorage.setItem).not.toHaveBeenCalled();

    const link = screen.getByRole("link", { name: /radio communications guide/i });
    expect(link.getAttribute("href")).toBe("/study/mat-1");

    expect(screen.getByText(/1 study guide\/set/i)).toBeTruthy();
    expect(screen.getByText(/1 practice test/i)).toBeTruthy();
    expect(screen.getByText(/1 instructor question/i)).toBeTruthy();

    // Verify description is present
    expect(screen.getByText(/How to obtain appropriate radio frequencies/i)).toBeTruthy();
  });

  it("handles tokenizer multi-code input with spaces, commas, and semicolons and handles current, archived, and unknown codes", () => {
    render(
      <MemoryRouter>
        <AcsCodeLookupPanel
          materials={[mockMaterial]}
          aiStudySets={[]}
          practiceTests={[]}
          questions={[]}
        />
      </MemoryRouter>
    );

    const textarea = screen.getByLabelText(/missed topic codes/i);
    // PA.III.A.K1 (current, has match)
    // PA.III.A.K2 (current, no matching material)
    // PA.III.A.R3 (archived code in the ACS companion guide)
    // UNKNOWN.999 (not found)
    fireEvent.change(textarea, { target: { value: "PA.III.A.K1, PA.III.A.K2; PA.III.A.R3   UNKNOWN.999" } });

    const submitBtn = screen.getByRole("button", { name: /find study materials/i });
    fireEvent.click(submitBtn);

    // Current with material match
    const resultK1 = screen.getByTestId("acs-code-result-PA.III.A.K1");
    expect(resultK1.querySelector("a")).toBe(screen.getByRole("link", { name: /radio communications guide/i }));

    // Current with no material match
    const resultK2 = screen.getByTestId("acs-code-result-PA.III.A.K2");
    expect(resultK2.textContent).toMatch(/no tagged study materials exist for this topic code/i);

    // Archived code
    const resultArchived = screen.getByTestId("acs-code-result-PA.III.A.R3");
    expect(resultArchived.textContent).toMatch(/archived code/i);
    expect(resultArchived.querySelector("a")).toBeNull();

    // Unresolved / unknown code
    const resultUnknown = screen.getByTestId("acs-code-result-UNKNOWN.999");
    expect(resultUnknown.textContent).toMatch(/not found/i);
    expect(resultUnknown.querySelector("a")).toBeNull();
  });

  it("clears stale results when input is emptied", () => {
    render(
      <MemoryRouter>
        <AcsCodeLookupPanel
          materials={[mockMaterial]}
          aiStudySets={[]}
          practiceTests={[]}
          questions={[]}
        />
      </MemoryRouter>
    );

    const textarea = screen.getByLabelText(/missed topic codes/i);
    fireEvent.change(textarea, { target: { value: "PA.III.A.K1" } });

    fireEvent.click(screen.getByRole("button", { name: /find study materials/i }));
    expect(screen.getByRole("link", { name: /radio communications guide/i })).toBeTruthy();

    // Empty input
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(screen.queryByRole("link", { name: /radio communications guide/i })).toBeNull();
    expect(screen.queryByTestId("acs-code-result-PA.III.A.K1")).toBeNull();
  });
});
