// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { useGeminiJobs } from "@/state/GeminiJobs";
import * as geminiService from "@/services/gemini";
import * as pdfService from "@/services/pdf";
import * as documentService from "@/services/documents";
import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
let repos: ReturnType<typeof createRepositories>;
let geminiJobs: ReturnType<typeof useGeminiJobs>;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
  }));

function Probe() {
  geminiJobs = useGeminiJobs();
  return null;
}

function Ready() {
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
      h(MemoryRouter, { initialEntries: [`/study/${id}`] }, h(Probe), h(Ready)),
    ),
  );
  await screen.findByRole("heading", { name: "Synthetic Handbook" });
  await waitFor(() => expect(geminiJobs.recovery).toBe("ready"));
}

const sendDialog = () => screen.getByRole("dialog", { name: "Send this file to Google?" });

describe("GEMINI-FLASHCARDS step 1: separate flashcards action and guide preservation", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);

    await repos.documents.create({
      id: "mat-pdf",
      title: "Synthetic Handbook",
      filePath: "documents/handbook.pdf",
      originalFileName: "handbook.pdf",
      fileSize: 1024 * 1024,
    });

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
    vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({ pages: 50, maxPagesPerSplit: 1000 });
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it("starting flashcards on a PDF calls generateStudyAid with the chosen target and never section-guide functions", async () => {
    const generateStudyAidSpy = vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      title: "Cards Title",
      summary: "AI summary",
      sections: [{ heading: "Sec", body: "Body" }],
      flashcards: [{ front: "Q1", back: "A1", sourcePage: 5 }],
      sourceNotes: "Notes",
      model: "gemini-3.5-flash",
    });
    const resumeGuideSpy = vi.spyOn(geminiService, "resumeStudyGuide");
    const restartGuideSpy = vi.spyOn(geminiService, "restartStudyGuide");
    const queueGuideSpy = vi.spyOn(geminiService, "queueStudyGuide");

    await openMaterial("mat-pdf");

    // Click "Create flashcards"
    fireEvent.click(await screen.findByRole("button", { name: "Create flashcards" }));

    // Confirm dialog opens with Target cards chooser
    const dialog = await waitFor(sendDialog);
    const targetSelect = within(dialog).getByRole("combobox", { name: "Target cards" });
    expect(targetSelect).toBeTruthy();

    // Select 60 cards
    fireEvent.change(targetSelect, { target: { value: "60" } });

    // Confirm sending
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));

    await waitFor(() =>
      expect(generateStudyAidSpy).toHaveBeenCalledWith(
        "documents/handbook.pdf",
        "mat-pdf",
        undefined,
        expect.stringMatching(/^req-/),
        60,
      ),
    );

    expect(resumeGuideSpy).not.toHaveBeenCalled();
    expect(restartGuideSpy).not.toHaveBeenCalled();
    expect(queueGuideSpy).not.toHaveBeenCalled();
  });

  it("saving keeps the existing summary and sections byte-for-byte and replaces only flashcards", async () => {
    const existingSummary = "Exact summary with symbols: ✈ & 100%!";
    const existingSections = [
      { heading: "Section Alpha", body: "Detailed body byte-for-byte text.\nLine 2." },
      { heading: "Section Beta", body: "Second section body." },
    ];
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-pdf",
      title: "Original Title",
      summary: existingSummary,
      sections: existingSections,
      flashcards: [
        { front: "Old Q1", back: "Old A1", sourcePage: 1 },
        { front: "Old Q2", back: "Old A2", sourcePage: 2 },
      ],
      sourceNotes: "Original notes",
      model: "gemini-3.5-flash",
    });

    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      title: "Discarded AI Title",
      summary: "Discarded AI summary",
      sections: [{ heading: "Discarded AI section", body: "Discarded body" }],
      flashcards: [
        { front: "Brand New Q1", back: "Brand New A1", sourcePage: 10 },
        { front: "Brand New Q2", back: "Brand New A2", sourcePage: 20 },
      ],
      sourceNotes: "AI notes",
      model: "gemini-3.5-flash",
    });

    await openMaterial("mat-pdf");

    fireEvent.click(await screen.findByRole("button", { name: "Create flashcards" }));
    const dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));

    // Wait for the save to settle into the library
    await waitFor(async () => {
      const sets = await repos.documents.listAiStudySets();
      const set = sets.find((s) => s.sourceMaterialId === "mat-pdf");
      expect(set?.flashcards.length).toBe(2);
      expect(set?.flashcards[0]?.front).toBe("Brand New Q1");
    });

    const sets = await repos.documents.listAiStudySets();
    const set = sets.find((s) => s.sourceMaterialId === "mat-pdf")!;

    // Byte-for-byte summary and sections preserved
    expect(set.summary).toBe(existingSummary);
    expect(set.sections).toEqual(existingSections);
    // Flashcards replaced with new cards
    expect(set.flashcards).toEqual([
      { front: "Brand New Q1", back: "Brand New A1", sourcePage: 10 },
      { front: "Brand New Q2", back: "Brand New A2", sourcePage: 20 },
    ]);
  });

  it("if material has no saved study set yet, saves the cards with an empty guide", async () => {
    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      title: "Fresh Guide Title",
      summary: "Fresh summary",
      sections: [{ heading: "Fresh section", body: "Fresh body" }],
      flashcards: [{ front: "Solo Card Q", back: "Solo Card A", sourcePage: 3 }],
      sourceNotes: "Notes",
      model: "gemini-3.5-flash",
    });

    await openMaterial("mat-pdf");

    fireEvent.click(await screen.findByRole("button", { name: "Create flashcards" }));
    const dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));

    await waitFor(async () => {
      const sets = await repos.documents.listAiStudySets();
      expect(sets.some((s) => s.sourceMaterialId === "mat-pdf")).toBe(true);
    });

    const sets = await repos.documents.listAiStudySets();
    const set = sets.find((s) => s.sourceMaterialId === "mat-pdf")!;

    // Empty guide: empty summary and empty sections
    expect(set.summary).toBe("");
    expect(set.sections).toEqual([]);
    expect(set.flashcards).toEqual([{ front: "Solo Card Q", back: "Solo Card A", sourcePage: 3 }]);
  });

  it("a set with her own edited cards goes through the regeneration review instead of being overwritten", async () => {
    await repos.documents.saveStudySet({
      operationId: crypto.randomUUID(),
      materialId: "mat-pdf",
      reason: "create",
      expected: null,
      next: {
        title: "My Guide",
        summary: "My summary",
        summaryOrigin: null,
        sections: [{ heading: "Sec", body: "Body" }],
        flashcards: [
          { front: "My Custom Q", back: "My Custom A", sourcePage: 1, origin: "user" },
        ],
        sourceNotes: "",
        provider: "gemini",
        model: "gemini-3.5-flash",
        retired: [],
      },
    });

    vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      title: "New AI Title",
      summary: "New AI summary",
      sections: [{ heading: "New Sec", body: "New Body" }],
      flashcards: [{ front: "New AI Q", back: "New AI A", sourcePage: 5 }],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });

    await openMaterial("mat-pdf");

    fireEvent.click(await screen.findByRole("button", { name: "Create flashcards" }));
    const dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));

    // Review notice appears instead of direct save
    const reviewBtn = await screen.findByRole("button", { name: "Review the new flashcards" });
    expect(reviewBtn).toBeTruthy();

    // Verify database was NOT overwritten silently
    const sets = await repos.documents.listAiStudySets();
    const current = sets.find((s) => s.sourceMaterialId === "mat-pdf")!;
    expect(current.flashcards[0]?.front).toBe("My Custom Q");
  });

  it("the guide card no longer promises flashcards for PDFs", async () => {
    await openMaterial("mat-pdf");

    // The guide card
    const guideCard = document.getElementById("material-study-guide")!;
    expect(guideCard).toBeTruthy();

    // Eyebrow says "Study guide" (not "Guide and flashcards")
    expect(within(guideCard).getByText("Study guide")).toBeTruthy();
    expect(within(guideCard).queryByText("Guide and flashcards")).toBeNull();

    // Text says "build a study guide section by section"
    expect(
      within(guideCard).getByText(/Gemini will read this PDF and build a study guide section by section/),
    ).toBeTruthy();
    expect(within(guideCard).queryByText(/guide and flashcards/)).toBeNull();

    // Open guide confirm dialog
    fireEvent.click(within(guideCard).getByRole("button", { name: "Create study aid" }));
    const dialog = await waitFor(sendDialog);

    // It has NO Target cards combobox
    expect(within(dialog).queryByRole("combobox", { name: "Target cards" })).toBeNull();
    expect(
      within(dialog).getByText(/Your guide is built section by section/),
    ).toBeTruthy();
  });

  it("the new section renders below the guide with both buttons", async () => {
    await openMaterial("mat-pdf");

    const guideSection = document.getElementById("material-study-guide")!;
    const flashcardsAndPracticeSection = document.getElementById("material-flashcards-and-practice")!;

    expect(guideSection).toBeTruthy();
    expect(flashcardsAndPracticeSection).toBeTruthy();

    // Flashcards and practice section is directly below guide
    expect(
      guideSection.compareDocumentPosition(flashcardsAndPracticeSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Contains title "Flashcards and practice test"
    expect(
      within(flashcardsAndPracticeSection).getByRole("heading", { name: "Flashcards and practice test" }),
    ).toBeTruthy();

    // Both action buttons render
    expect(
      within(flashcardsAndPracticeSection).getByRole("button", { name: "Create flashcards" }),
    ).toBeTruthy();
    expect(
      within(flashcardsAndPracticeSection).getByRole("button", { name: "Create practice test" }),
    ).toBeTruthy();
  });

  it("shows plain message if native side refuses because guide job is in progress", async () => {
    vi.spyOn(geminiService, "generateStudyAid").mockRejectedValue(
      "Resume or explicitly discard the earlier versioned draft first.",
    );

    await openMaterial("mat-pdf");

    fireEvent.click(await screen.findByRole("button", { name: "Create flashcards" }));
    const dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));

    expect(
      await screen.findByText("Finish or stop the study guide first, then make flashcards."),
    ).toBeTruthy();
  });
});
