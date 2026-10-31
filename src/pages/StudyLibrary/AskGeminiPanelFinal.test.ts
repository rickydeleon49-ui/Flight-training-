// @vitest-environment jsdom
/** ASK-FINAL: background text read, friendlier refusals, vague questions, Escape and a fixed Ask another. */
import { createElement as h, type ContextType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeMaterial } from "@/testing/factories";
import type { AiStudySet } from "@/domain/types";

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  readiness: vi.fn(),
  prepare: vi.fn(),
  enabled: vi.fn(() => true),
}));
vi.mock("@/data", () => ({ isTauri: () => false }));
vi.mock("@/services/gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/gemini")>()),
  askGemini: mocks.ask,
  cancelAskGemini: vi.fn().mockResolvedValue(undefined),
  watchAskGeminiProgress: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/services/offlineContent", () => ({
  offlineStudyEnabled: mocks.enabled,
  offlineContentReadiness: mocks.readiness,
  prepareOfflineContent: mocks.prepare,
}));

import { AskGeminiPanel, readPdfTextInBackground } from "./AskGeminiPanel";

const material = makeMaterial({ id: "mat-1", filePath: "documents/10_phak_ch8.pdf", fileSize: 1024 });
const guide = {
  sourceMaterialId: "mat-1", title: "Guide", summary: "", sourceNotes: "", model: "test", provider: "gemini",
  sections: [{ heading: "Study guide", body: "Overview.\n\n### Magnetic compass\n- x\n### Compass errors\n- y\n### Attitude indicator\n- z" }],
  flashcards: [],
} as unknown as AiStudySet;

function renderPanel(props: Partial<Parameters<typeof AskGeminiPanel>[0]> = {}, sets: AiStudySet[] = [guide]) {
  const data = { ...EMPTY_DATA, materials: [material], aiStudySets: sets };
  return render(h(AppDataContext.Provider, { value: { data } as unknown as ContextType<typeof AppDataContext> },
    h(AskGeminiPanel, { materialId: "mat-1", context: "Synthetic context", ...props })));
}
const row = (readiness: unknown) => [{ materialId: "mat-1", readiness }];
const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
};

beforeEach(() => {
  mocks.enabled.mockReturnValue(true);
  mocks.readiness.mockResolvedValue(row({ state: "searchable", pages: 32 }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("1: reading the PDF's text in the background", () => {
  it("opening Ask on an unread PDF reads it on her Mac first, and the question waits for it", async () => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    mocks.readiness.mockResolvedValueOnce(row({ state: "notPrepared" }))
      .mockImplementation(async () => { await done; return row({ state: "searchable", pages: 32 }); });
    mocks.prepare.mockResolvedValue({ materialId: "mat-1", readiness: { state: "preparing" } });
    mocks.ask.mockResolvedValue({ answer: "Not answered by these sources.", model: "gemini-3.5-flash", notAnswered: true, passages: [] });
    renderPanel({ evidenceMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    expect(await screen.findByText("Reading this PDF on your Mac…")).toBeTruthy();
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith("mat-1");
    ask("Why does the compass lag in a turn?");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.ask).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    // The wait between checks is real; give it time.
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(screen.queryByText("Reading this PDF on your Mac…")).toBeNull();
    // 2: the page range comes from the read.
    expect(await screen.findByText(
      "That isn't in these pages (pages 1–32). This PDF covers: Magnetic compass; Compass errors; Attitude indicator. Try another chapter, or ask your instructor.",
    )).toBeTruthy();
  });

  it("a PDF already read is not read again; card and practice Why? read too", async () => {
    renderPanel({ buttonLabel: "Explain this" });
    fireEvent.click(screen.getByRole("button", { name: "Explain this" }));
    await waitFor(() => expect(mocks.readiness).toHaveBeenCalledTimes(1));
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(screen.queryByText("Reading this PDF on your Mac…")).toBeNull();
  });

  it("if the read fails, Ask behaves as before", async () => {
    mocks.readiness.mockResolvedValueOnce(row({ state: "notPrepared" }));
    mocks.prepare.mockRejectedValue(new Error("worker"));
    mocks.ask.mockResolvedValue({ answer: "Fictional answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [], evidenceUnavailable: "text_not_read" });
    renderPanel({ evidenceMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    ask("Why does the compass lag in a turn?");
    expect(await screen.findByText("Fictional answer.")).toBeTruthy();
    expect(screen.getByText(/I couldn't check the supporting text/)).toBeTruthy();
    expect(screen.queryByText("Reading this PDF on your Mac…")).toBeNull();
  });

  it("does nothing when this build can't read text, or the file isn't a PDF", async () => {
    mocks.enabled.mockReturnValue(false);
    renderPanel({ evidenceMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it("readPdfTextInBackground polls the same local read until it settles, and gives up quietly", async () => {
    const reading = vi.fn();
    mocks.readiness.mockResolvedValueOnce(row({ state: "notPrepared" }))
      .mockResolvedValueOnce(row({ state: "preparing" }))
      .mockResolvedValueOnce(row({ state: "partial", searchable: 9, pages: 10, imagePages: 1, reason: "imagePages" }));
    mocks.prepare.mockResolvedValue({ materialId: "mat-1", readiness: { state: "preparing" } });
    const wait = vi.fn(async () => {});
    expect(await readPdfTextInBackground("mat-1", reading, () => true, wait)).toBe(10);
    expect(reading).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(2);
    mocks.readiness.mockReset().mockResolvedValue(row({ state: "couldNotProcess", code: "encrypted" }));
    expect(await readPdfTextInBackground("mat-1", reading, () => true, wait)).toBeNull();
    mocks.readiness.mockReset().mockRejectedValue(new Error("ipc"));
    expect(await readPdfTextInBackground("mat-1", reading, () => true, wait)).toBeNull();
  });
});

describe("3: a question with no topic", () => {
  it("on Ask about this PDF, a bare why? is answered locally and sends nothing", async () => {
    renderPanel({ evidenceMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    for (const vague of ["why?", "?", "explain"]) {
      ask(vague);
      expect(await screen.findByText("Which part do you mean? For example: “Magnetic compass”, “Compass errors” and “Attitude indicator”.")).toBeTruthy();
      expect((screen.getByLabelText("Ask a question") as HTMLInputElement).value).toBe(vague);
    }
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("without a saved guide it still asks which part", async () => {
    renderPanel({ evidenceMode: true }, []);
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    ask("why?");
    expect(await screen.findByText("Which part do you mean? For example, name a topic or a page from this PDF.")).toBeTruthy();
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("on a card or practice Why?, a bare why? is sent (the card is the context)", async () => {
    mocks.ask.mockResolvedValue({ answer: "Card answer.", model: "gemini-3.5-flash", sourcePages: [] });
    renderPanel({ buttonLabel: "Explain this" });
    fireEvent.click(screen.getByRole("button", { name: "Explain this" }));
    ask("why?");
    expect(await screen.findByText("Card answer.")).toBeTruthy();
    expect(mocks.ask).toHaveBeenCalledTimes(1);
    expect(mocks.ask.mock.calls[0]![0]).toMatchObject({ question: "why?", cardWhy: { citedPage: null }, relativePath: "documents/10_phak_ch8.pdf" });
  });

  it("a follow-up why? inside a conversation is sent", async () => {
    mocks.ask.mockResolvedValue({ answer: "First answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
    renderPanel({ evidenceMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    ask("What is acceleration error?");
    await screen.findByText("First answer.");
    ask("why?");
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2));
  });
});

describe("8: Ask another stays put; Escape closes", () => {
  it("Ask another sits in a sticky header above the answers", async () => {
    mocks.ask.mockResolvedValue({ answer: "An answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
    renderPanel({ evidenceMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    ask("What is acceleration error?");
    await screen.findByText("An answer.");
    const another = screen.getByRole("button", { name: "Ask another" });
    const header = another.closest(".ask-gemini-panel__header") as HTMLElement;
    expect(header.style.position).toBe("sticky");
    expect(header.compareDocumentPosition(screen.getByRole("log")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Escape closes an inline Why? panel and returns focus to the button that opened it", async () => {
    renderPanel({ buttonLabel: "Explain this" });
    const opener = screen.getByRole("button", { name: "Explain this" });
    fireEvent.click(opener);
    const input = screen.getByLabelText("Ask a question");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Ask a question")).toBeNull());
    const reopened = screen.getByRole("button", { name: "Explain this" });
    expect(document.activeElement).toBe(reopened);
  });

  it("inside a dialog, Escape is left to the dialog", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    try {
      const data = { ...EMPTY_DATA, materials: [material], aiStudySets: [] };
      render(h(AppDataContext.Provider, { value: { data } as unknown as ContextType<typeof AppDataContext> },
        h(AskGeminiPanel, { materialId: "mat-1", context: "", evidenceMode: true })), { container: dialog });
      fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
      fireEvent.keyDown(screen.getByLabelText("Ask a question"), { key: "Escape" });
      expect(screen.getByLabelText("Ask a question")).toBeTruthy();
    } finally {
      cleanup();
      dialog.remove();
    }
  });
});

describe("4: card and practice Why? send page text, never the PDF", () => {
  it("sends the cited page, says the PDF itself is not sent, then what was sent", async () => {
    mocks.ask.mockResolvedValueOnce({ answer: "Card answer.", model: "gemini-3.5-flash", sourcePages: [], contextPages: [14, 15, 16, 17, 18] })
      .mockResolvedValueOnce({ answer: "Second answer.", model: "gemini-3.5-flash", sourcePages: [], contextPages: [] });
    renderPanel({ buttonLabel: "Explain this", sourcePage: 16 });
    fireEvent.click(screen.getByRole("button", { name: "Explain this" }));
    expect(screen.getByText(/The PDF itself is not sent\./)).toBeTruthy();
    expect(screen.queryByText(/full PDF/)).toBeNull();
    ask("Why does the compass lag?");
    expect(await screen.findByText("Sent: this card and the text of pages 14–18")).toBeTruthy();
    expect(mocks.ask.mock.calls[0]![0]).toMatchObject({ cardWhy: { citedPage: 16 } });
    expect(mocks.ask.mock.calls[0]![0]).not.toHaveProperty("pdfOptional");
    // No text available (scanned page, read failed): the card only, said so.
    ask("And acceleration error?");
    expect(await screen.findByText("Sent: this card only")).toBeTruthy();
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
  });

  it("Ask about this PDF is unchanged: no card option", async () => {
    mocks.ask.mockResolvedValue({ answer: "PDF answer.", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
    renderPanel({ evidenceMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    ask("What is acceleration error?");
    await screen.findByText("PDF answer.");
    expect(mocks.ask.mock.calls[0]![0]).not.toHaveProperty("cardWhy");
    expect(screen.queryByText(/^Sent:/)).toBeNull();
  });
});
