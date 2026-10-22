// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeTest } from "@/domain/types";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { askGemini } from "@/services/gemini";
import { AskGeminiPanel, GOOGLE_NOTE_STORAGE_KEY } from "./AskGeminiPanel";
import { PracticeTestPanel } from "./PracticeTestPanel";

vi.mock("@/services/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/gemini")>();
  return {
    ...actual,
    askGemini: vi.fn(),
  };
});

describe("AskGeminiPanel and PracticeTestPanel integration", () => {
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
    expect(askGeminiBtn).toBeTruthy();
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
