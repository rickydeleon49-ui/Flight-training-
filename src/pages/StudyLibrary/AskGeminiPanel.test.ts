// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeTest } from "@/domain/types";
import { AppDataContext, AppDataProvider, EMPTY_DATA, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as pdfService from "@/services/pdf";
import * as documentService from "@/services/documents";
import { askGemini } from "@/services/gemini";
import { AskGeminiPanel, GOOGLE_NOTE_STORAGE_KEY } from "./AskGeminiPanel";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
let repos: Repositories;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

vi.mock("@/services/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/gemini")>();
  return {
    ...actual,
    askGemini: vi.fn(),
  };
});

describe("AskGeminiPanel and PracticeTestPanel integration", () => {

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
    ],
    provider: "gemini",
    model: "gemini-3.5-flash",
    generatedAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    await repos.documents.create({ id: sampleTest.sourceMaterialId, title: sampleTest.title });
    await repos.documents.savePracticeTest(sampleTest);
  });

  afterEach(() => {
    cleanup();
    db?.close();
  });

  async function renderPracticePanel() {
    const value = {
      repositories: repos,
      data: {
        ...EMPTY_DATA,
        materials: [
          {
            id: "mat-1",
            title: "Traffic Pattern Operations",
            materialType: "document",
            topic: "general",
            reviewStatus: "not_reviewed",
            priority: "medium",
            goalId: null,
            eventId: null,
            notes: "",
            filePath: "documents/traffic_pattern.pdf",
            originalFileName: "traffic_pattern.pdf",
            fileSize: 1024,
            createdAt: "2026-09-01T12:00:00.000Z",
            updatedAt: "2026-09-01T12:00:00.000Z",
          },
        ],
      },
      status: "ready",
      error: null,
    } as unknown as ContextType<typeof AppDataContext>;

    const view = render(h(AppDataContext.Provider, { value }, h(PracticeTestPanel, { practiceTest: sampleTest })));
    await screen.findByText("Question 1 of 1");
    return view;
  }

  it("the panel is hidden before answering and shown after", async () => {
    await renderPracticePanel();

    // Before answering, the Why? Ask Gemini button is not present
    expect(screen.queryByRole("button", { name: "Why? Ask Gemini" })).toBeNull();

    // Select an answer
    const options = screen.getAllByRole("radio");
    fireEvent.click(options[1]!);

    // Answer is now revealed, so Why? Ask Gemini appears
    await screen.findByText("Correct");
    const askGeminiBtn = screen.getByRole("button", { name: "Why? Ask Gemini" });
    expect(askGeminiBtn.classList.contains("button--secondary")).toBe(true);
  });

  it("Ask calls askGemini with the question's context and her text", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Standard altitude gives adequate terrain clearance.",
      sourcePages: [42],
    });

    await renderPracticePanel();

    // Answer the question
    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!); // chosen 800 feet AGL (incorrect)
    await screen.findByText("Not quite");

    // Open Ask Gemini panel
    const openBtn = screen.getByRole("button", { name: "Why? Ask Gemini" });
    fireEvent.click(openBtn);

    // Type question
    const input = screen.getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "Why isn't 800 feet standard?" } });

    // Submit question
    const askSubmit = screen.getByRole("button", { name: "Ask" });
    fireEvent.click(askSubmit);

    await waitFor(() => {
      expect(mockAsk).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockAsk.mock.calls[0]![0] as import("@/services/gemini").AskGeminiParams;
    expect(callArgs.materialId).toBe("mat-1");
    expect(callArgs.relativePath).toBe("documents/traffic_pattern.pdf");
    expect(callArgs.question).toBe("Why isn't 800 feet standard?");
    expect(callArgs.context).toContain("What is the standard traffic pattern altitude");
    expect(callArgs.context).toContain("800 feet AGL");
    expect(callArgs.context).toContain("1,000 feet AGL");
    expect(callArgs.context).toContain("Standard pattern altitude is 1,000 feet AGL");
  });

  it("answers and page chips render", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Standard pattern altitude is 1,000 ft AGL as stated in AC 90-66B.",
      sourcePages: [42, 45],
    });

    render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        relativePath: "documents/test.pdf",
        context: "Sample context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));

    const input = screen.getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "Tell me more about AC 90-66B." } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText("Standard pattern altitude is 1,000 ft AGL as stated in AC 90-66B.");
    expect(screen.getByText("p. 42")).toBeTruthy();
    expect(screen.getByText("p. 45")).toBeTruthy();
    expect(
      screen.getByText("Study aid — check it against FAA guidance and your instructor."),
    ).toBeTruthy();
  });

  it.each([false, true])("focuses and scrolls to the input after every answer (reduced motion: %s)", async (reducedMotion) => {
    const matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion });
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      vi.mocked(askGemini).mockImplementation(async (params) => ({
        answer: `Answer: ${params && typeof params === "object" ? params.question : ""}`, sourcePages: [],
      }));
      render(h(AskGeminiPanel, { materialId: "mat-1", context: "Synthetic context" }));
      const opener = screen.getByRole("button", { name: "Why? Ask Gemini" });
      opener.focus();
      expect(document.activeElement).toBe(opener);
      fireEvent.click(opener);
      const input = screen.getByRole("textbox", { name: "Ask a question" });
      expect(document.activeElement).toBe(input);
      const scroll = vi.fn();
      input.scrollIntoView = scroll;

      // Four replies also cover new answers after the six-turn history cap.
      for (let i = 1; i <= 4; i++) {
        fireEvent.change(input, { target: { value: `Question ${i}` } });
        const submit = screen.getByRole("button", { name: "Ask" });
        submit.focus();
        fireEvent.click(submit);
        await screen.findByText(`Answer: Question ${i}`);
        expect(document.activeElement).toBe(input);
        expect((input as HTMLInputElement).disabled).toBe(false);
        expect((input as HTMLInputElement).value).toBe("");
        expect(scroll).toHaveBeenCalledTimes(i);
        expect(scroll).toHaveBeenLastCalledWith({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
      }
      expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      const reset = screen.getByRole("button", { name: "Ask another" });
      expect(reset.classList.contains("button--ghost")).toBe(true);
      fireEvent.click(reset);
      expect(scroll).toHaveBeenCalledTimes(4);
      const close = screen.getByRole("button", { name: "Close Ask Gemini" });
      expect(close.classList.contains("button--ghost")).toBe(true);
      fireEvent.click(close);
      fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Ask a question" }));
      expect(scroll).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the Google note shows once", async () => {
    // 1st render: Google note is shown
    const view = render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        relativePath: "documents/test.pdf",
        context: "Context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect(screen.getByText("Your question and this PDF are sent to Google.")).toBeTruthy();
    expect(localStorage.getItem(GOOGLE_NOTE_STORAGE_KEY)).toBe("true");

    view.unmount();

    // 2nd render: Google note is not shown
    render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        relativePath: "documents/test.pdf",
        context: "Context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect(screen.queryByText("Your question and this PDF are sent to Google.")).toBeNull();
  });

  it("errors show plainly", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockRejectedValueOnce(new Error("Gemini is not connected. Connect it in Settings first."));

    render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        relativePath: "documents/test.pdf",
        context: "Context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));

    const input = screen.getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "Test question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByRole("alert");
    expect(screen.getByText("Gemini is not connected. Connect it in Settings first.")).toBeTruthy();
  });

  it("shows 'No internet right now' when offline", async () => {
    render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        relativePath: "documents/test.pdf",
        context: "Context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));

    // Mock navigator.onLine as false
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    try {
      const input = screen.getByLabelText("Ask a question");
      fireEvent.change(input, { target: { value: "Test offline question" } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));

      await screen.findByRole("alert");
      expect(screen.getByText("No internet right now")).toBeTruthy();
    } finally {
      Object.defineProperty(navigator, "onLine", { value: originalOnLine, configurable: true });
    }
  });

  it("keeps at most 6 turns in history", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockImplementation(async (params) => ({
      answer: `Answer to ${params && typeof params === "object" ? params.question : ""}`,
      sourcePages: [],
    }));

    render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        relativePath: "documents/test.pdf",
        context: "Context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));

    // Send 4 questions (each creates 1 user turn + 1 model turn = 2 turns, so 8 total -> capped at 6)
    for (let i = 1; i <= 4; i++) {
      const input = screen.getByLabelText("Ask a question");
      fireEvent.change(input, { target: { value: `Question ${i}` } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
      await screen.findByText(`Answer to Question ${i}`);
    }

    // Question 1 should have rolled off because history is capped at last 6 turns (3 pairs)
    expect(screen.queryByText("Question 1")).toBeNull();
    expect(screen.getByText("Question 2")).toBeTruthy();
    expect(screen.getByText("Question 3")).toBeTruthy();
    expect(screen.getByText("Question 4")).toBeTruthy();
  });
});

describe("AskGeminiPanel answer actions and reset", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    db = await createNodeSqliteDatabase();
  });

  afterEach(() => {
    cleanup();
    db?.close();
  });

  it("shows no unfinished flashcard action after an answer", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Bernoulli's principle explains the pressure difference.",
      sourcePages: [12],
    });

    render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        context: "Sample aerodynamic context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));

    const input = screen.getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "How does lift work?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText("Bernoulli's principle explains the pressure difference.");
    expect(screen.queryByText("Save as flashcard")).toBeNull();
    expect(screen.queryByTitle("Coming in the real version")).toBeNull();
  });

  it("reset clears history", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Answer to be cleared on reset.",
      sourcePages: [],
    });

    render(
      h(AskGeminiPanel, {
        materialId: "mat-1",
        context: "Context",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));

    const input = screen.getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "Initial query" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText("Answer to be cleared on reset.");
    expect(screen.getByText("Initial query")).toBeTruthy();

    const resetBtn = screen.getByRole("button", { name: "Ask another" });
    expect(resetBtn).toBeTruthy();
    fireEvent.click(resetBtn);

    expect(screen.queryByText("Answer to be cleared on reset.")).toBeNull();
    expect(screen.queryByText("Initial query")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask another" })).toBeNull();
  });
});

describe("Flashcards and PDF Ask Gemini integration in MaterialDetail", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);

    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };

    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({
      configured: true,
      model: "gemini-3.5-flash",
      choice: "standard",
    });
    vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
    vi.spyOn(geminiService, "watchGeminiJobs").mockResolvedValue(() => {});
    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([]);
    vi.spyOn(geminiService, "acknowledgeGeminiJob").mockResolvedValue(true);
    vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
    vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
    vi.spyOn(pdfService, "canSplitPdfs").mockReturnValue(true);
    vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({ pages: 50, maxPagesPerSplit: 1000 });
  });

  afterEach(() => {
    cleanup();
    db?.close();
  });

  function RouteWrapper() {
    const { status } = useAppData();
    return status === "ready"
      ? h(
          Routes,
          null,
          h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
        )
      : null;
  }

  async function openMaterial(id: string) {
    render(
      h(
        AppDataProvider,
        null,
        h(MemoryRouter, { initialEntries: [`/study/${id}`] }, h(RouteWrapper)),
      ),
    );
    await screen.findByRole("heading", { name: "Synthetic Handbook" });
  }

  async function seedFlashcardMaterial(fileSize = 1024 * 1024) {
    await repos.documents.create({
      id: "mat-pdf",
      title: "Synthetic Handbook",
      filePath: "documents/handbook.pdf",
      originalFileName: "handbook.pdf",
      fileSize,
    });
    await db.execute(
      `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
       VALUES (?, 'Synthetic guide', 'A synthetic study summary.', '[]', ?, '', 'gemini', 'gemini-3.5-flash', '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z')`,
      [
        "mat-pdf",
        JSON.stringify([
          { front: "What is Vy?", back: "Best rate of climb speed.", sourcePage: 15 },
          { front: "What is Vx?", back: "Best angle of climb speed.", sourcePage: 14 },
        ]),
      ],
    );
  }

  it("Explain this hidden before reveal and shown after in both places (flashcards viewer)", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Vy gives the best climb rate.",
      sourcePages: [15],
    });

    await seedFlashcardMaterial();
    await openMaterial("mat-pdf");

    const flashcardsSection = document.getElementById("material-flashcards")!;

    // 1. Before flipping card, Explain this button is hidden
    expect(within(flashcardsSection).queryByRole("button", { name: "Explain this" })).toBeNull();

    // Flip the card
    const cardBtn = within(flashcardsSection).getByRole("button", { name: "Reveal flashcard answer" });
    fireEvent.click(cardBtn);

    // 2. After flipping card, Explain this button is shown
    const explainBtn = within(flashcardsSection).getByRole("button", { name: "Explain this" });
    expect(explainBtn.classList.contains("button--secondary")).toBe(true);

    // Open and ask
    fireEvent.click(explainBtn);
    const input = within(flashcardsSection).getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "Why is Vy important?" } });
    fireEvent.click(within(flashcardsSection).getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
    const args = mockAsk.mock.calls[0]![0] as any;
    expect(args.materialId).toBe("mat-pdf");
    expect(args.relativePath).toBe("documents/handbook.pdf");
    expect(args.question).toBe("Why is Vy important?");
    expect(args.context).toContain("What is Vy?");
    expect(args.context).toContain("Best rate of climb speed.");
    expect(args.context).toContain("15");
  });

  it("Explain this hidden before reveal and shown after in both places (review session)", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Vx clears obstacles on departure.",
      sourcePages: [14],
    });

    await seedFlashcardMaterial();
    await openMaterial("mat-pdf");

    // Start review session
    const reviewBtn = await screen.findByRole("button", { name: "Review cards" });
    fireEvent.click(reviewBtn);

    await screen.findByRole("button", { name: "Show answer" });

    // 1. Before reveal, Explain this is not present
    expect(screen.queryByRole("button", { name: "Explain this" })).toBeNull();

    // Reveal answer
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

    // 2. After reveal, Explain this appears
    const explainBtn = screen.getByRole("button", { name: "Explain this" });
    expect(explainBtn.classList.contains("button--secondary")).toBe(true);

    fireEvent.click(explainBtn);
    const input = screen.getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "Explain Vx" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
    const args = mockAsk.mock.calls[0]![0] as any;
    expect(args.materialId).toBe("mat-pdf");
    expect(args.relativePath).toBe("documents/handbook.pdf");
    expect(args.question).toBe("Explain Vx");
    expect(args.context).toContain("What is Vy?");
    expect(args.context).toContain("Best rate of climb speed.");
  });

  it("typing in the Ask box does not trigger review shortcuts", async () => {
    await seedFlashcardMaterial();
    await openMaterial("mat-pdf");

    // Start review session and show answer
    const reviewBtn = await screen.findByRole("button", { name: "Review cards" });
    fireEvent.click(reviewBtn);
    await screen.findByRole("button", { name: "Show answer" });
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

    // Open Explain this
    fireEvent.click(screen.getByRole("button", { name: "Explain this" }));
    const input = screen.getByLabelText("Ask a question");

    const session = within(screen.getByLabelText(/^Card review session/));

    // Initial state: Card 1 of 2 in review session
    expect(session.getByText(/Card 1 of 2/)).toBeTruthy();

    const saveSpy = vi.spyOn(db, "saveCardReviewAtomically");

    // Simulate keydowns on input with review shortcuts
    fireEvent.keyDown(input, { key: "1" });
    fireEvent.keyDown(input, { key: "2" });
    fireEvent.keyDown(input, { key: "3" });
    fireEvent.keyDown(input, { key: "4" });
    fireEvent.keyDown(input, { key: " " });
    fireEvent.keyDown(input, { key: "Enter" });

    // Card review position must remain unchanged on Card 1 of 2 and no rate action saved
    expect(saveSpy).not.toHaveBeenCalled();
    expect(session.getByText(/Card 1 of 2/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Good:/ })).toBeTruthy();
  });

  it("puts the PDF Ask card right after Start here, outside and above Study guide, and passes its context", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Standard rate turns are 3 degrees per second.",
      sourcePages: [10],
    });

    await seedFlashcardMaterial();
    await openMaterial("mat-pdf");

    const studyGuideSection = document.getElementById("material-study-guide")!;
    const askCard = screen.getByRole("heading", { name: "Ask about this PDF" }).closest(".card")! as HTMLElement;
    const startHere = document.getElementById("material-start-here")!;
    expect(startHere.nextElementSibling?.contains(askCard)).toBe(true);
    expect(askCard.compareDocumentPosition(studyGuideSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(studyGuideSection).queryByRole("button", { name: "Ask about this PDF" })).toBeNull();
    expect(await within(askCard).findByText("Ask Gemini a question about this PDF. It answers from the pages and shows which pages it used.")).toBeTruthy();
    const askPdfBtn = within(askCard).getByRole("button", { name: "Ask about this PDF" });
    expect(askPdfBtn.classList.contains("button--secondary")).toBe(true);

    fireEvent.click(askPdfBtn);
    const input = within(askCard).getByLabelText("Ask a question");
    fireEvent.change(input, { target: { value: "What is a standard rate turn?" } });
    fireEvent.click(within(askCard).getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
    const args = mockAsk.mock.calls[0]![0] as any;
    expect(args.materialId).toBe("mat-pdf");
    expect(args.relativePath).toBe("documents/handbook.pdf");
    expect(args.question).toBe("What is a standard rate turn?");
    expect(args.context).toContain("Synthetic Handbook");
    expect(args.context).toContain("A synthetic study summary.");
  });

  it("asks her to connect Gemini instead of offering a question box when it is not connected", async () => {
    vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({
      configured: false,
      model: "gemini-3.5-flash",
      choice: "standard",
    });
    await seedFlashcardMaterial();
    await openMaterial("mat-pdf");

    const askCard = screen.getByRole("heading", { name: "Ask about this PDF" }).closest(".card")! as HTMLElement;
    await waitFor(() =>
      expect(within(askCard).getByText("Connect Gemini in Settings to ask questions about this PDF.")).toBeTruthy(),
    );
    expect(within(askCard).queryByRole("button", { name: "Ask about this PDF" })).toBeNull();
  });

  it("the too-big PDF shows the split line", async () => {
    // 60 MB exceeds the 50 MB limit
    await seedFlashcardMaterial(60 * 1024 * 1024);
    await openMaterial("mat-pdf");

    const askCard = screen.getByRole("heading", { name: "Ask about this PDF" }).closest(".card")! as HTMLElement;
    expect(within(askCard).getByText("This PDF is too big for Gemini — split it first.")).toBeTruthy();
    expect(within(askCard).queryByRole("button", { name: "Ask about this PDF" })).toBeNull();
    expect(within(askCard).queryByRole("region", { name: "Ask Gemini helper" })).toBeNull();
  });
});
