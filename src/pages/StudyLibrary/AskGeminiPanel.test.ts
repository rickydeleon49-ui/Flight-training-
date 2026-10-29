// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { act, cleanup, fireEvent, render as baseRender, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeTest } from "@/domain/types";
import { AppDataContext, AppDataProvider, EMPTY_DATA, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as pdfService from "@/services/pdf";
import * as documentService from "@/services/documents";
import { askGemini, cancelAskGemini, watchAskGeminiProgress, type AskGeminiParams } from "@/services/gemini";
import { AskGeminiPanel } from "./AskGeminiPanel";
import { CardReviewPanel } from "./CardReviewPanel";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { MaterialDetail } from "./MaterialDetail";

import { makeMaterial } from "@/testing/factories";
import { checkAiSubmission } from "@/logic/aiSafety";

const allowedMaterial = makeMaterial({ id: "mat-1", filePath: "documents/test.pdf" });
const allowedData = { ...EMPTY_DATA, materials: [allowedMaterial] };
function render(ui: React.ReactElement) {
  return baseRender(ui, { wrapper: ({ children }) => h(AppDataContext.Provider, {
    value: { data: allowedData } as ContextType<typeof AppDataContext>,
  }, children) });
}

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
    cancelAskGemini: vi.fn().mockResolvedValue(undefined),
    watchAskGeminiProgress: vi.fn().mockResolvedValue(() => {}),
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
    return { ...view, value };
  }

  it("a correctly answered PDF quiz sends the editable starter question as context only", async () => {
    vi.mocked(askGemini).mockResolvedValueOnce({
      answer: "The supplied explanation supports this answer.", model: "gemini-3.5-flash",
      notAnswered: true, passages: [{ page: 42, quote: "Unused evidence" }], evidenceUnavailable: "text_not_read",
    });
    await renderPracticePanel();
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect((screen.getByLabelText("Ask a question") as HTMLInputElement).value).toBe("Why is that the correct answer?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("The supplied explanation supports this answer.");
    expect(vi.mocked(askGemini).mock.calls[0]![0]).toMatchObject({ relativePath: null, question: "Why is that the correct answer?" });
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
    expect(screen.queryByText("Not answered by these sources.")).toBeNull();
    expect(screen.queryByText(/check the supporting text/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Ask Gemini" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect((screen.getByLabelText("Ask a question") as HTMLInputElement).value).toBe("Why is that the correct answer?");
  });

  it.each([["admin", true], ["credential", true], ["admin", false], ["credential", false]] as const)("refuses %s reclassification after a saved quiz and listener startup (file attached: %s)", async (kind, hasFile) => {
    const view = await renderPracticePanel();
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    let ready!: (stop: () => void) => void;
    vi.mocked(watchAskGeminiProgress).mockImplementationOnce(() => new Promise((resolve) => { ready = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    // Replace the current snapshot while the Ask listener is still pending.
    const material = makeMaterial({ id: "mat-1", filePath: hasFile ? "documents/private.pdf" : null,
      materialType: kind === "admin" ? "admin_document" : "study_guide" });
    const credentials = kind === "credential" ? [{ materialId: "mat-1", title: "Synthetic medical" }] as typeof EMPTY_DATA.toolkit.credentials : [];
    const value = { ...view.value, data: {
      ...view.value!.data, materials: [material], toolkit: { ...EMPTY_DATA.toolkit, credentials },
    } } as ContextType<typeof AppDataContext>;
    view.rerender(h(AppDataContext.Provider, { value }, h(PracticeTestPanel, { practiceTest: sampleTest })));
    await act(async () => { ready(() => {}); });
    expect((await screen.findByRole("alert")).textContent).toBe(checkAiSubmission(material, credentials, hasFile ? "file" : "study_context").reason);
    expect(askGemini).not.toHaveBeenCalled();
  });

  it.each(["admin", "credential", "missing"])("shows the %s refusal on opening and tracks material changes", (kind) => {
    const refusedMaterial = makeMaterial({ ...allowedMaterial, materialType: kind === "admin" ? "admin_document" : "study_guide" });
    const credentials = kind === "credential" ? [{ materialId: "mat-1", title: "Synthetic medical" }] as typeof EMPTY_DATA.toolkit.credentials : [];
    const refusedData = { ...allowedData, materials: kind === "missing" ? [] : [refusedMaterial], toolkit: { ...EMPTY_DATA.toolkit, credentials } };
    const panel = (data: typeof allowedData) => h(AppDataContext.Provider, { value: { data } as ContextType<typeof AppDataContext> },
      h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Synthetic context" }));
    const view = render(panel(refusedData));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    const input = screen.getByLabelText("Ask a question") as HTMLInputElement;
    const ask = screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement;
    const reason = kind === "missing" ? "This material is no longer available. Open it again before asking." : checkAiSubmission(refusedMaterial, credentials).reason;
    expect(screen.getByRole("alert").textContent).toBe(reason);
    expect(input.disabled).toBe(true);
    expect(ask.disabled).toBe(true);
    expect(watchAskGeminiProgress).not.toHaveBeenCalled();
    view.rerender(panel(allowedData));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "Why?" } });
    expect(ask.disabled).toBe(false);
    view.rerender(panel(refusedData));
    expect(screen.getByRole("alert").textContent).toBe(reason);
    expect(input.disabled).toBe(true);
    expect(ask.disabled).toBe(true);
    fireEvent.submit(input.closest("form")!);
    expect(askGemini).not.toHaveBeenCalled();
  });

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
      model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 42, quote: "Synthetic passage 42." }],
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
    expect((input as HTMLInputElement).value).toBe("Why is that the correct answer?");
    fireEvent.change(input, { target: { value: "Why isn't 800 feet standard?" } });

    // Submit question
    const askSubmit = screen.getByRole("button", { name: "Ask" });
    fireEvent.click(askSubmit);

    await waitFor(() => {
      expect(mockAsk).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockAsk.mock.calls[0]![0] as import("@/services/gemini").AskGeminiParams;
    expect(callArgs.materialId).toBe("mat-1");
    expect(callArgs.relativePath).toBeNull();
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
    expect(callArgs.question).toBe("Why isn't 800 feet standard?");
    expect(callArgs.context).toContain("What is the standard traffic pattern altitude");
    expect(callArgs.context).toContain("800 feet AGL");
    expect(callArgs.context).toContain("1,000 feet AGL");
    expect(callArgs.context).toContain("Standard pattern altitude is 1,000 feet AGL");
  });

  it.each(["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"])("answers and collapsed sources render with the actual model %s", async (model) => {
    const writes = vi.fn();
    db.beforeStatement = writes;
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Standard pattern altitude is 1,000 ft AGL as stated in AC 90-66B.",
      model, notAnswered: false, passages: [{ page: 42, quote: "Synthetic passage 42." }, { page: 45, quote: "Synthetic passage 45." }],
    });

    render(
      h(AskGeminiPanel, { evidenceMode: true,
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
    expect(screen.getByText(`Answered by ${geminiService.geminiModelName(model)}`)).toBeTruthy();
    const summary = screen.getByText("Sources (2)");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(within(details).getByText("Page 42")).toBeTruthy();
    expect(within(details).getByText("Page 45")).toBeTruthy();
    expect(within(details).getByText("Synthetic passage 42.")).toBeTruthy();
    fireEvent.click(summary);
    expect(details.open).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(mockAsk).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    expect(
      screen.getByText("Study aid — check the sources and your instructor."),
    ).toBeTruthy();
  });

  it.each([false, true])("keeps focus in the input and scrolls the new answer into view (reduced motion: %s)", async (reducedMotion) => {
    const matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion });
    vi.stubGlobal("matchMedia", matchMedia);
    const original = Element.prototype.scrollIntoView;
    try {
      vi.mocked(askGemini).mockImplementation(async (params) => ({
        answer: `Answer: ${params && typeof params === "object" ? params.question : ""}`, model: "gemini-3.5-flash", notAnswered: false, passages: [],
      }));
      render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Synthetic context" }));
      const opener = screen.getByRole("button", { name: "Why? Ask Gemini" });
      opener.focus();
      expect(document.activeElement).toBe(opener);
      fireEvent.click(opener);
      const input = screen.getByRole("textbox", { name: "Ask a question" });
      expect(document.activeElement).toBe(input);
      const scroll = vi.fn();
      const scrolled: Element[] = [];
      Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
        scrolled.push(this);
        scroll(arg);
      };

      // Four replies also cover new answers after the six-turn history cap.
      for (let i = 1; i <= 4; i++) {
        fireEvent.change(input, { target: { value: `Question ${i}` } });
        const submit = screen.getByRole("button", { name: "Ask" });
        submit.focus();
        fireEvent.click(submit);
        await screen.findByText(`Answer: Question ${i}`);
        // Focus and scroll follow the render of the answer, so wait for them.
        await waitFor(() => {
          expect(document.activeElement).toBe(input);
          expect(scroll).toHaveBeenCalledTimes(i);
        });
        expect((input as HTMLInputElement).disabled).toBe(false);
        expect((input as HTMLInputElement).value).toBe("");
        expect(scroll).toHaveBeenLastCalledWith({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
        const target = scrolled.at(-1)!;
        expect(target).not.toBe(input);
        expect(target.textContent).toContain(`Answer: Question ${i}`);
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
      Element.prototype.scrollIntoView = original;
      vi.unstubAllGlobals();
    }
  });

  it("keeps the complete disclosure visible before each send without writing storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Synthetic context" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect(screen.getByText(/recent conversation are sent to Google/)).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it.each([null, "documents/synthetic.txt"])("omits all evidence UI without a PDF (file: %s)", async (filePath) => {
    vi.mocked(askGemini).mockResolvedValueOnce({ answer: "Original context answer.", model: "gemini-3.5-flash", sourcePages: [] });
    const data = { ...allowedData, materials: [makeMaterial({ id: "mat-1", filePath })] };
    render(h(AppDataContext.Provider, { value: { data } as ContextType<typeof AppDataContext> },
      h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Synthetic context" })));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Original context answer.");
    expect(vi.mocked(askGemini).mock.calls[0]![0]).toMatchObject({ relativePath: filePath });
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
    expect(screen.queryByText("I couldn't check the supporting text.")).toBeNull();
    expect(screen.queryByText("Not answered by these sources.")).toBeNull();
  });

  it.each([false, true])("shows the evidence gap or not-answered state (not answered: %s)", async (notAnswered) => {
    vi.mocked(askGemini).mockResolvedValueOnce({
      answer: notAnswered ? "Not answered by these sources." : "Synthetic answer without checked text.",
      model: "gemini-3.5-flash", notAnswered, passages: [],
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const beforeDb = await db.select("SELECT * FROM study_materials");
    render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Context" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "A synthetic question?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(notAnswered ? "Not answered by these sources." : "I couldn't check the supporting text.");
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
    expect(screen.queryByText(/^Page /)).toBeNull();
    expect(screen.queryByText("I couldn't check the supporting text.") !== null).toBe(!notAnswered);
    expect(await db.select("SELECT * FROM study_materials")).toEqual(beforeDb);
    expect(setItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close Ask Gemini" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect(screen.queryByRole("log")).toBeNull();
    setItem.mockRestore();
  });

  it.each([false, true])("says how to enable source checking only when the PDF text is unread (heading present: %s)", async (withHeading) => {
    const heading = document.createElement("h2");
    heading.id = "material-backup-heading";
    heading.tabIndex = -1;
    heading.scrollIntoView = vi.fn();
    if (withHeading) document.body.appendChild(heading);
    try {
      vi.mocked(askGemini)
        .mockResolvedValueOnce({ answer: "Unread answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [], evidenceUnavailable: "text_not_read" })
        .mockResolvedValueOnce({ answer: "Read answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
      render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Context" }));
      fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
      const input = screen.getByLabelText("Ask a question");
      fireEvent.change(input, { target: { value: "First?" } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
      await screen.findByText("Unread answer.");
      const hint = screen.getByText((_, el) => el?.tagName === "P"
        && el.textContent === "I couldn't check the supporting text — use “Read this PDF's text” first.");
      const jump = within(hint).queryByRole("button", { name: "“Read this PDF's text”" });
      expect(jump !== null).toBe(withHeading);
      if (jump) {
        fireEvent.click(jump);
        expect(document.activeElement).toBe(heading);
        expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
      }
      fireEvent.change(input, { target: { value: "Second?" } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
      await screen.findByText("Read answer.");
      // Text was read but nothing matched: the plain line, no pointer.
      expect(screen.getAllByText(/I couldn't check the supporting text/)).toHaveLength(2);
      expect(screen.getByText("I couldn't check the supporting text.")).toBeTruthy();
    } finally {
      heading.remove();
    }
  });

  it("errors show plainly", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockRejectedValueOnce(new Error("Gemini is not connected. Connect it in Settings first."));

    render(
      h(AskGeminiPanel, { evidenceMode: true,
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

  it("keeps the question and explains how to retry when offline", async () => {
    render(
      h(AskGeminiPanel, { evidenceMode: true,
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
      expect(screen.getByText("No internet right now. Your question is still here — press Ask again when you're back online.")).toBeTruthy();
      expect(input).toHaveProperty("value", "Test offline question");
    } finally {
      Object.defineProperty(navigator, "onLine", { value: originalOnLine, configurable: true });
    }
  });

  it("keeps at most 6 turns in history", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockImplementation(async (params) => ({
      answer: `Answer to ${params && typeof params === "object" ? params.question : ""}`,
      model: "gemini-3.5-flash", notAnswered: false, passages: [],
    }));

    render(
      h(AskGeminiPanel, { evidenceMode: true,
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

  it("clears checked passages and retires a pending reply across A → B → A", async () => {
    let finish!: (value: Awaited<ReturnType<typeof askGemini>>) => void;
    vi.mocked(askGemini)
      .mockResolvedValueOnce({ answer: "First source answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 1, quote: "First fictional source quote." }] })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const sourceB = makeMaterial({ id: "mat-2", filePath: "documents/other.pdf" });
    const data = { ...allowedData, materials: [allowedMaterial, sourceB] };
    const panel = (id: string) => h(AppDataContext.Provider, { value: { data } as ContextType<typeof AppDataContext> },
      h(AskGeminiPanel, { evidenceMode: true, materialId: id, context: "Synthetic context" }));
    const view = render(panel("mat-1"));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    const ask = (text: string) => {
      fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    };
    ask("First question");
    fireEvent.click(await screen.findByText("Sources (1)"));
    expect(screen.getByText("First fictional source quote.")).toBeTruthy();
    ask("Pending question");
    await waitFor(() => expect(askGemini).toHaveBeenCalledTimes(2));
    view.rerender(panel("mat-2"));
    view.rerender(panel("mat-1"));
    expect(cancelAskGemini).toHaveBeenCalled();
    await act(async () => finish({ answer: "Late old answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 2, quote: "Late old quote." }] }));
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.queryByText("First fictional source quote.")).toBeNull();
    expect(screen.queryByText("Late old quote.")).toBeNull();
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
  });

  it.each([
    "Gemini did not return a usable answer. Try asking again.",
    "Gemini did not return an answer. Try asking again.",
  ])("keeps a malformed or empty reply out of the conversation and next history: %s", async (message) => {
    vi.mocked(askGemini)
      .mockResolvedValueOnce({ answer: "Earlier valid answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [] })
      .mockRejectedValueOnce(message)
      .mockResolvedValueOnce({ answer: "Next valid answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
    render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Synthetic context" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    const ask = (question: string) => {
      fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: question } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    };
    ask("Earlier valid question");
    await screen.findByText("Earlier valid answer.");
    ask("Failed question");
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(within(screen.getByRole("log")).queryByText(message)).toBeNull();
    expect(screen.queryByText("Failed question")).toBeNull();
    expect(screen.getAllByText(/^Answered by /)).toHaveLength(1);
    expect((screen.getByLabelText("Ask a question") as HTMLInputElement).value).toBe("Failed question");
    ask("Next question");
    await screen.findByText("Next valid answer.");
    expect(vi.mocked(askGemini).mock.calls[2]![0]).toMatchObject({ history: [
      { role: "user", text: "Earlier valid question" },
      { role: "model", text: "Earlier valid answer." },
    ] });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("preserves conversation, draft and pending replies through metadata and context edits", async () => {
    let finish!: (value: Awaited<ReturnType<typeof askGemini>>) => void;
    vi.mocked(askGemini)
      .mockResolvedValueOnce({ answer: "Answer for this PDF.", model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 1, quote: "Same source." }] })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const panel = (edited: boolean) => h(AppDataContext.Provider, {
      value: { data: { ...allowedData, materials: [{ ...allowedMaterial,
        ...(edited ? { updatedAt: "2026-10-28T20:00:00Z", title: "Edited title", notes: "Edited notes" } : {}),
      }] } } as ContextType<typeof AppDataContext>,
    }, h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: edited ? "Updated study context" : "Original context" }));
    const view = render(panel(false));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    const input = () => screen.getByLabelText("Ask a question") as HTMLInputElement;
    fireEvent.change(input(), { target: { value: "First question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Answer for this PDF.");
    fireEvent.change(input(), { target: { value: "Follow-up draft" } });
    view.rerender(panel(true));
    expect(screen.getByText("Answer for this PDF.")).toBeTruthy();
    expect(screen.getByText("Sources (1)")).toBeTruthy();
    expect(input().value).toBe("Follow-up draft");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askGemini).toHaveBeenCalledTimes(2));
    expect(vi.mocked(askGemini).mock.calls[1]![0]).toMatchObject({ context: "Updated study context", history: [
      { role: "user", text: "First question" }, { role: "model", text: "Answer for this PDF." },
    ] });
    view.rerender(panel(false));
    expect(cancelAskGemini).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Asking…" })).toBeTruthy();
    await act(async () => finish({ answer: "Pending reply kept.", model: "gemini-3.5-flash", notAnswered: false, passages: [] }));
    expect(screen.getByText("Pending reply kept.")).toBeTruthy();
    expect(screen.getByText("Answer for this PDF.")).toBeTruthy();
  });

  it("limits the question input to 1000 characters", () => {
    render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Context" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect((screen.getByLabelText("Ask a question") as HTMLInputElement).maxLength).toBe(1000);
  });

  it.each(["Ask another", "Close Ask Gemini"])(
    "drops a late answer after %s without unlocking the next request",
    async (action) => {
      let resolveOld!: (value: Awaited<ReturnType<typeof askGemini>>) => void;
      let resolveNew!: (value: Awaited<ReturnType<typeof askGemini>>) => void;
      vi.mocked(askGemini)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
      render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Context" }));
      fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
      fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Old question" } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
      await waitFor(() => expect(vi.mocked(askGemini)).toHaveBeenCalledTimes(1));
      expect((screen.getByLabelText("Ask a question") as HTMLInputElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: action }));
      if (action === "Close Ask Gemini") {
        fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
      }
      expect(screen.queryByText("Stopped that question.") !== null).toBe(action === "Ask another");
      const input = screen.getByLabelText("Ask a question") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      fireEvent.change(input, { target: { value: "New question" } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
      expect(screen.queryByText("Stopped that question.")).toBeNull();
      await waitFor(() => expect(vi.mocked(askGemini)).toHaveBeenCalledTimes(2));
      expect(vi.mocked(askGemini).mock.calls[1]![0]).toMatchObject({ history: [] });

      await act(async () => { resolveOld({ answer: "Stale answer", model: "gemini-3.5-flash", notAnswered: false, passages: [] }); });
      expect(screen.queryByText("Stale answer")).toBeNull();
      expect(screen.queryByText("Old question")).toBeNull();
      expect(input.value).toBe("New question");
      expect(input.disabled).toBe(true);
      expect(screen.getByRole("button", { name: "Asking…" })).toBeTruthy();

      await act(async () => { resolveNew({ answer: "Current answer", model: "gemini-3.5-flash", notAnswered: false, passages: [] }); });
      expect(screen.getByText("Current answer")).toBeTruthy();
      expect(input.disabled).toBe(false);
    },
  );

  it.each(["Ask another", "Close Ask Gemini"])("drops a late error after %s", async (action) => {
    let rejectOld!: (reason: Error) => void;
    vi.mocked(askGemini).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectOld = reject;
    }));
    render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Context" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Old question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(vi.mocked(askGemini)).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: action }));
    if (action === "Close Ask Gemini") {
      fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    }
    await act(async () => { rejectOld(new Error("Stale error")); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("Ask a question") as HTMLInputElement).disabled).toBe(false);
  });

  it("shows no unfinished flashcard action after an answer", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Bernoulli's principle explains the pressure difference.",
      model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 12, quote: "Synthetic passage 12." }],
    });

    render(
      h(AskGeminiPanel, { evidenceMode: true,
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
      model: "gemini-3.5-flash", notAnswered: false, passages: [],
    });

    render(
      h(AskGeminiPanel, { evidenceMode: true,
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

describe("AskGeminiPanel request progress and cancellation", () => {
  let emit: Parameters<typeof watchAskGeminiProgress>[0];
  let unlisten = vi.fn<() => void>();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    unlisten = vi.fn();
    vi.mocked(watchAskGeminiProgress).mockImplementation(async (listener) => {
      emit = listener;
      return unlisten;
    });
    vi.mocked(askGemini).mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
    vi.mocked(watchAskGeminiProgress).mockResolvedValue(() => {});
  });

  async function start() {
    const view = render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Synthetic context" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askGemini).toHaveBeenCalledTimes(1));
    const { requestId } = vi.mocked(askGemini).mock.calls[0]![0] as AskGeminiParams;
    expect(requestId).toMatch(/^[A-Za-z0-9-]{1,64}$/);
    return { view, requestId: requestId! };
  }

  it.each(["answer", "error"])("shows only current progress under the input, clearing on %s", async (outcome) => {
    let resolve!: (value: Awaited<ReturnType<typeof askGemini>>) => void;
    let reject!: (reason: Error) => void;
    vi.mocked(askGemini).mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const { requestId } = await start();
    act(() => emit({ requestId: "another-request", message: "Other question's progress" }));
    expect(screen.queryByRole("status")).toBeNull();
    const message = "Gemini is busy or rate-limited. Waiting 10 seconds, then trying again — attempt 2 of 3.";
    act(() => emit({ requestId, message }));
    expect(screen.getByRole("status").textContent).toBe(message);
    expect(screen.getByRole("button", { name: "Asking…" })).toBeTruthy();
    expect(screen.getByLabelText("Ask a question").compareDocumentPosition(screen.getByRole("status")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => emit({ requestId, message: "Trying the backup Gemini model…" }));
    expect(screen.getByRole("status").textContent).toBe("Trying the backup Gemini model…");
    act(() => emit({ requestId: "another-request", message: "Do not replace this question's progress" }));
    expect(screen.getByRole("status").textContent).toBe("Trying the backup Gemini model…");
    await act(async () => {
      if (outcome === "answer") resolve({ answer: "Synthetic answer", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
      else reject(new Error("Synthetic error"));
    });
    expect(screen.getByText(outcome === "answer" ? "Synthetic answer" : "Synthetic error")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(cancelAskGemini).not.toHaveBeenCalled();
    act(() => emit({ requestId, message: "Late progress" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each(["Ask another", "Close Ask Gemini", "unmount"])("%s cancels the in-flight id and clears progress", async (action) => {
    const { view, requestId } = await start();
    act(() => emit({ requestId, message: "Gemini is busy, trying again…" }));
    expect(screen.getByRole("status")).toBeTruthy();
    if (action === "unmount") view.unmount();
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(cancelAskGemini).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(unlisten).toHaveBeenCalledTimes(1);
    act(() => emit({ requestId, message: "Late progress" }));
    expect(screen.queryByText("Late progress")).toBeNull();
    expect(screen.queryByText("Gemini is busy, trying again…")).toBeNull();
    expect(screen.queryByRole("status")?.textContent ?? null).toBe(action === "Ask another" ? "Stopped that question." : null);
    if (action === "Close Ask Gemini") {
      fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
      expect(screen.queryByText("Gemini is busy, trying again…")).toBeNull();
    }
  });

  it("closing while the listener starts prevents a native ask and releases the late listener", async () => {
    let ready!: (stop: () => void) => void;
    vi.mocked(watchAskGeminiProgress).mockImplementationOnce(() => new Promise((resolve) => { ready = resolve; }));
    render(h(AskGeminiPanel, { evidenceMode: true, materialId: "mat-1", context: "Synthetic context" }));
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(askGemini).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close Ask Gemini" }));
    await act(async () => { ready(unlisten); });
    expect(askGemini).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(1);
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

  it.each(["admin", "credential"])("refuses %s files at both card entry points and the PDF Ask card", async (kind) => {
    await seedFlashcardMaterial();
    // Study content predates this classification / credential link.
    if (kind === "admin") await repos.documents.update("mat-pdf", { materialType: "admin_document" });
    else await repos.toolkit.save({ ...EMPTY_DATA.toolkit, credentials: [{
      id: "synthetic-credential", type: "medical", title: "Synthetic medical", identifier: "",
      issuedOn: null, expiresOn: null, notes: "", materialId: "mat-pdf",
    }] });
    await openMaterial("mat-pdf");
    const material = (await repos.documents.list()).find((item) => item.id === "mat-pdf")!;
    const credentials = (await repos.toolkit.get()).credentials;
    const reason = checkAiSubmission(material, credentials).reason;
    // PDF-level refusal uses the generation reason and offers no submit button.
    expect(document.getElementById("material-ask-gemini")!.textContent).toContain(reason);
    const cards = within(document.getElementById("material-flashcards")!);
    fireEvent.click(cards.getByRole("button", { name: "Reveal flashcard answer" }));
    fireEvent.click(cards.getByRole("button", { name: "Explain this" }));
    expect((cards.getByLabelText("Ask a question") as HTMLInputElement).disabled).toBe(true);
    expect((cards.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    expect((await cards.findByRole("alert")).textContent).toBe(reason);
    fireEvent.click(cards.getByRole("button", { name: "Close Ask Gemini" }));
    cleanup();
    render(h(AppDataContext.Provider, { value: { data: { ...EMPTY_DATA, materials: [material],
      toolkit: { ...EMPTY_DATA.toolkit, credentials } } } as ContextType<typeof AppDataContext> },
      h(CardReviewPanel, { materialId: "mat-pdf", materialTitle: material.title, repository: repos.cardReviews, autoStart: true })));
    fireEvent.click(await screen.findByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Explain this" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findByRole("alert")).textContent).toBe(reason);
    expect(askGemini).not.toHaveBeenCalled();
  });

  it("Explain this hidden before reveal and shown after in both places (flashcards viewer)", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Vy gives the best climb rate.",
      model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 15, quote: "Synthetic passage 15." }],
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
    expect((input as HTMLInputElement).value).toBe("Why is this the answer?");
    fireEvent.change(input, { target: { value: "Why is Vy important?" } });
    fireEvent.click(within(flashcardsSection).getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
    const args = mockAsk.mock.calls[0]![0] as any;
    expect(args.materialId).toBe("mat-pdf");
    expect(args.relativePath).toBeNull();
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
    expect(screen.queryByText(/check the supporting text/)).toBeNull();
    expect(args.question).toBe("Why is Vy important?");
    expect(args.context).toContain("What is Vy?");
    expect(args.context).toContain("Best rate of climb speed.");
    expect(args.context).toContain("15");
  });

  it("Explain this hidden before reveal and shown after in both places (review session)", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({
      answer: "Vx clears obstacles on departure.",
      model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 14, quote: "Synthetic passage 14." }],
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
    expect((input as HTMLInputElement).value).toBe("Why is this the answer?");
    fireEvent.change(input, { target: { value: "Explain Vx" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
    const args = mockAsk.mock.calls[0]![0] as any;
    expect(args.materialId).toBe("mat-pdf");
    expect(args.relativePath).toBeNull();
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
    expect(screen.queryByText(/check the supporting text/)).toBeNull();
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
      model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 10, quote: "Synthetic passage 10." }],
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
    expect(await screen.findByText("Sources (1)")).toBeTruthy();
    expect(args.question).toBe("What is a standard rate turn?");
    expect(args.context).toContain("Synthetic Handbook");
    expect(args.context).toContain("A synthetic study summary.");
  });

  it("cancels a pending PDF reply and clears its conversation when the attachment is replaced", async () => {
    const mockAsk = vi.mocked(askGemini);
    mockAsk.mockResolvedValueOnce({ answer: "Answer for the original PDF.", model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 2, quote: "Synthetic passage 2." }] });
    let finishPending!: (value: { answer: string; model: string; notAnswered: boolean; passages: { page: number; quote: string }[] }) => void;
    mockAsk.mockImplementationOnce(() => new Promise((resolve) => { finishPending = resolve; }));
    vi.spyOn(documentService, "pickAndImportDocument").mockResolvedValueOnce({
      relativePath: "documents/replacement.pdf", originalFileName: "replacement.pdf", fileSize: 4096,
    });

    await seedFlashcardMaterial();
    await openMaterial("mat-pdf");
    const askCard = () => screen.getByRole("heading", { name: "Ask about this PDF" }).closest(".card")! as HTMLElement;
    fireEvent.click(await within(askCard()).findByRole("button", { name: "Ask about this PDF" }));

    const ask = async (question: string) => {
      fireEvent.change(within(askCard()).getByLabelText("Ask a question"), { target: { value: question } });
      fireEvent.click(within(askCard()).getByRole("button", { name: "Ask" }));
    };
    await ask("What does the original PDF say?");
    await screen.findByText("Answer for the original PDF.");
    await ask("One more question");
    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));
    await screen.findByText("replacement.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(cancelAskGemini).toHaveBeenCalled());
    await waitFor(() => expect(within(askCard()).getByRole("button", { name: "Ask about this PDF" })).toBeTruthy());
    expect(within(askCard()).queryByText("Answer for the original PDF.")).toBeNull();
    await act(async () => finishPending({ answer: "Late answer from the original PDF.", model: "gemini-3.5-flash", notAnswered: false, passages: [{ page: 3, quote: "Synthetic passage 3." }] }));
    expect(screen.queryByText("Late answer from the original PDF.")).toBeNull();
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
