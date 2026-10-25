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

  it("announces lookup summary politely to assistive technology on submission and on clear", () => {
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

    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toBeTruthy();
    expect(statusRegion.getAttribute("aria-live")).toBe("polite");
    expect(statusRegion.getAttribute("aria-atomic")).toBe("true");
    expect(statusRegion.textContent).toBe("");

    const textarea = screen.getByLabelText(/missed topic codes/i);
    fireEvent.change(textarea, {
      target: { value: "PA.III.A.K1, PA.III.A.R3, UNKNOWN.999" },
    });

    const submitBtn = screen.getByRole("button", { name: /find study materials/i });
    fireEvent.click(submitBtn);

    expect(statusRegion.textContent).toBe(
      "3 codes checked. 1 current, 1 archived, 1 not found."
    );

    // Empty input should announce that results were cleared
    fireEvent.change(textarea, { target: { value: "" } });
    expect(statusRegion.textContent).toBe("Lookup results cleared.");
  });

  it("announces when submitted with no codes entered", () => {
    render(
      <MemoryRouter>
        <AcsCodeLookupPanel
          materials={[]}
          aiStudySets={[]}
          practiceTests={[]}
          questions={[]}
        />
      </MemoryRouter>
    );

    const statusRegion = screen.getByRole("status");
    const submitBtn = screen.getByRole("button", { name: /find study materials/i });
    fireEvent.click(submitBtn);

    expect(statusRegion.textContent).toBe("No codes entered.");
  });

  describe("live lookup updates and rerender regressions", () => {
    it("updates displayed material link when tagged material is added after submission without resubmitting", () => {
      const { rerender } = render(
        <MemoryRouter>
          <AcsCodeLookupPanel
            materials={[]}
            aiStudySets={[]}
            practiceTests={[]}
            questions={[]}
          />
        </MemoryRouter>
      );

      const textarea = screen.getByLabelText(/missed topic codes/i);
      fireEvent.change(textarea, { target: { value: "PA.I.A.K1" } });
      fireEvent.click(screen.getByRole("button", { name: /find study materials/i }));

      const resultItem = screen.getByTestId("acs-code-result-PA.I.A.K1");
      expect(resultItem.textContent).toMatch(/no tagged study materials exist/i);
      expect(resultItem.querySelector("a")).toBeNull();

      // Add material with matching tag and rerender
      const newMaterial: StudyMaterial = {
        ...mockMaterial,
        id: "mat-new-1",
        title: "Aerodynamics Fundamentals",
        tags: ["PA.I.A.K1"],
      };

      rerender(
        <MemoryRouter>
          <AcsCodeLookupPanel
            materials={[newMaterial]}
            aiStudySets={[]}
            practiceTests={[]}
            questions={[]}
          />
        </MemoryRouter>
      );

      // Link should now appear live without resubmitting
      const link = screen.getByRole("link", { name: /aerodynamics fundamentals/i });
      expect(link.getAttribute("href")).toBe("/study/mat-new-1");
      expect(resultItem.textContent).not.toMatch(/no tagged study materials exist/i);
    });

    it("updates dynamically when a material is renamed or removed", () => {
      const initialMaterial: StudyMaterial = {
        ...mockMaterial,
        id: "mat-rename",
        title: "Initial Title",
        tags: ["PA.I.A.K1"],
      };

      const { rerender } = render(
        <MemoryRouter>
          <AcsCodeLookupPanel
            materials={[initialMaterial]}
            aiStudySets={[]}
            practiceTests={[]}
            questions={[]}
          />
        </MemoryRouter>
      );

      const textarea = screen.getByLabelText(/missed topic codes/i);
      fireEvent.change(textarea, { target: { value: "PA.I.A.K1" } });
      fireEvent.click(screen.getByRole("button", { name: /find study materials/i }));

      expect(screen.getByRole("link", { name: /initial title/i })).toBeTruthy();

      // Renamed material
      const renamedMaterial: StudyMaterial = {
        ...initialMaterial,
        title: "Updated Title",
      };

      rerender(
        <MemoryRouter>
          <AcsCodeLookupPanel
            materials={[renamedMaterial]}
            aiStudySets={[]}
            practiceTests={[]}
            questions={[]}
          />
        </MemoryRouter>
      );

      expect(screen.queryByRole("link", { name: /initial title/i })).toBeNull();
      expect(screen.getByRole("link", { name: /updated title/i })).toBeTruthy();

      // Removed material
      rerender(
        <MemoryRouter>
          <AcsCodeLookupPanel
            materials={[]}
            aiStudySets={[]}
            practiceTests={[]}
            questions={[]}
          />
        </MemoryRouter>
      );

      expect(screen.queryByRole("link", { name: /updated title/i })).toBeNull();
      const resultItem = screen.getByTestId("acs-code-result-PA.I.A.K1");
      expect(resultItem.textContent).toMatch(/no tagged study materials exist/i);
    });

    it("updates sub-content counts dynamically when study sets, practice tests, or questions change", () => {
      const { rerender } = render(
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
      expect(screen.queryByText(/study guide/i)).toBeNull();

      // Add study sets, practice tests, and questions
      rerender(
        <MemoryRouter>
          <AcsCodeLookupPanel
            materials={[mockMaterial]}
            aiStudySets={[mockStudySet]}
            practiceTests={[mockPracticeTest]}
            questions={[mockQuestion]}
          />
        </MemoryRouter>
      );

      expect(screen.getByText(/1 study guide\/set/i)).toBeTruthy();
      expect(screen.getByText(/1 practice test/i)).toBeTruthy();
      expect(screen.getByText(/1 instructor question/i)).toBeTruthy();
    });

    it("editing the input without submitting keeps previous query results", () => {
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

      expect(screen.getByTestId("acs-code-result-PA.III.A.K1")).toBeTruthy();
      expect(screen.getByRole("link", { name: /radio communications guide/i })).toBeTruthy();

      // Type something else into textarea without submitting
      fireEvent.change(textarea, { target: { value: "PA.I.A.K1, PA.I.B.K2" } });

      // Previous submitted query results should still be displayed
      expect(screen.getByTestId("acs-code-result-PA.III.A.K1")).toBeTruthy();
      expect(screen.getByRole("link", { name: /radio communications guide/i })).toBeTruthy();
      expect(screen.queryByTestId("acs-code-result-PA.I.A.K1")).toBeNull();
    });

    it("clearing input with whitespace still removes results and announces clearing", () => {
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

      expect(screen.getByTestId("acs-code-result-PA.III.A.K1")).toBeTruthy();

      // Clear input with spaces/whitespace
      fireEvent.change(textarea, { target: { value: "   \n\t  " } });

      expect(screen.queryByTestId("acs-code-result-PA.III.A.K1")).toBeNull();
      const statusRegion = screen.getByRole("status");
      expect(statusRegion.textContent).toBe("Lookup results cleared.");
    });
  });
});
