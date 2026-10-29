// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    vi.spyOn(pdfService, "canSplitPdfs").mockReturnValue(true);
    vi.spyOn(pdfService, "inspectPdf").mockResolvedValue({ pages: 50, maxPagesPerSplit: 1000 });
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it.each([false, true])("empty cards fail visibly, save nothing and can be retried (existing set: %s)", async (existing) => {
    if (existing) await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-pdf", title: "Keep this guide", summary: "Keep this summary",
      sections: [{ heading: "Keep", body: "My guide" }],
      flashcards: [{ front: "Keep Q", back: "Keep A", sourcePage: 1 }], sourceNotes: "Keep notes", model: "gemini-3.5-flash",
    });
    const before = await repos.documents.listAiStudySets();
    const generate = vi.spyOn(geminiService, "generateStudyAid").mockResolvedValueOnce({
      title: "Empty", summary: "Empty", sections: [], flashcards: [], sourceNotes: "", model: "gemini-3.5-flash",
      jobId: "empty-job", checkpointed: true,
    }).mockResolvedValueOnce({
      title: "New cards", summary: "", sections: [], flashcards: [{ front: "New Q", back: "New A", sourcePage: 1 }], sourceNotes: "", model: "gemini-3.5-flash",
    });
    await openMaterial("mat-pdf");
    await act(async () => { await geminiJobs.start("flashcards", { materialId: "mat-pdf", filePath: "documents/handbook.pdf" }); });
    expect(await screen.findByText("Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.")).toBeTruthy();
    expect(await repos.documents.listAiStudySets()).toEqual(before);
    expect(geminiJobs.jobs.find(j => j.kind === "flashcards")?.phase).toBe("failed");
    expect(geminiService.acknowledgeGeminiJob).not.toHaveBeenCalledWith("empty-job");
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    fireEvent.click(within(await waitFor(sendDialog)).getByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect((await repos.documents.listAiStudySets())[0]?.flashcards[0]?.front).toBe("New Q"));
  });

  it("a recovered empty card result stays failed and is never offered for saving", async () => {
    vi.mocked(geminiService.listGeminiJobs).mockResolvedValue([{
      id: "empty-recovered", kind: "study-aid", requestId: "flashcards:old-request", materialId: "mat-pdf",
      relativePath: "documents/handbook.pdf", contentSha256: "", stage: "ready", createdAt: 1, updatedAt: 1,
      result: { title: "Empty", summary: "", sections: [], flashcards: [], sourceNotes: "", model: "gemini-3.5-flash" },
    }]);
    await openMaterial("mat-pdf");
    expect(await screen.findByText("Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.")).toBeTruthy();
    expect(geminiJobs.jobs[0]?.phase).toBe("failed");
    await act(async () => { await geminiJobs.saveAgain(geminiJobs.jobs[0]!.key); });
    expect(await repos.documents.listAiStudySets()).toEqual([]);
    expect(geminiService.acknowledgeGeminiJob).not.toHaveBeenCalledWith("empty-recovered");
    expect(screen.queryByRole("button", { name: "Save the new flashcards" })).toBeNull();
  });

  it("shows a first-attempt refusal if journal recovery is still pending", async () => {
    let finish!: (records: geminiService.GeminiJobRecord[]) => void;
    vi.mocked(geminiService.listGeminiJobs).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/mat-pdf"] }, h(Probe), h(Ready))));
    await screen.findByRole("heading", { name: "Synthetic Handbook" });
    expect((await screen.findAllByText("Gemini is still checking earlier work. Try again in a moment.")).length).toBeGreaterThan(0);
    let refusal: string | void;
    await act(async () => { refusal = await geminiJobs.start("flashcards", { materialId: "mat-pdf", filePath: "documents/handbook.pdf" }); });
    expect(refusal!).toBe("Gemini is still checking earlier work. Try again in a moment.");
    await act(async () => finish([]));
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
        expect.stringMatching(/^flashcards:req-/),
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
    fireEvent.click(within(guideCard).getByRole("button", { name: "Create study guide" }));
    const dialog = await waitFor(sendDialog);

    // It has NO Target cards combobox
    expect(within(dialog).queryByRole("combobox", { name: "Target cards" })).toBeNull();
    expect(
      within(dialog).getByText(/Your guide is built section by section/),
    ).toBeTruthy();
  });

  it("the Flashcards section and Practice test section render in order below the guide", async () => {
    await openMaterial("mat-pdf");

    const guideSection = document.getElementById("material-study-guide")!;
    const flashcardsSection = document.getElementById("material-flashcards")!;
    const practiceSection = document.getElementById("material-practice-test")!;

    expect(guideSection).toBeTruthy();
    expect(flashcardsSection).toBeTruthy();
    expect(practiceSection).toBeTruthy();

    // Flashcards and practice section are directly below guide
    expect(
      guideSection.compareDocumentPosition(flashcardsSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      flashcardsSection.compareDocumentPosition(practiceSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Section headings
    expect(
      within(flashcardsSection).getByRole("heading", { name: "Flashcards" }),
    ).toBeTruthy();
    expect(
      within(practiceSection).getByRole("heading", { name: "Practice test" }),
    ).toBeTruthy();

    // Action buttons render in their respective sections
    expect(
      within(flashcardsSection).getByRole("button", { name: "Create flashcards" }),
    ).toBeTruthy();
    expect(
      within(practiceSection).getByRole("button", { name: "Create practice test" }),
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

  it("Item 0: a recovered study-aid record with requestId 'flashcards:...' becomes a flashcards job and keeps existing summary/sections on save", async () => {
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-pdf",
      title: "Existing Guide",
      summary: "Preserved summary",
      sections: [{ heading: "Preserved Sec", body: "Preserved body" }],
      flashcards: [{ front: "Old Q", back: "Old A", sourcePage: 1 }],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });

    const initialSets = await repos.documents.listAiStudySets();
    const existingSet = initialSets.find((s) => s.sourceMaterialId === "mat-pdf")!;

    const mockRecord: geminiService.GeminiJobRecord = {
      id: "rec-recovered-123",
      materialId: "mat-pdf",
      kind: "study-aid",
      requestId: "flashcards:req-recovered-123",
      stage: "ready",
      relativePath: "documents/handbook.pdf",
      contentSha256: "",
      baseRevision: existingSet.updatedAt,
      createdAt: 1000,
      updatedAt: 1000,
      result: {
        title: "Gemini Summary and Flashcards",
        summary: "Overwriting summary from card generator",
        sections: [{ heading: "Overwriting Sec", body: "Overwriting body" }],
        flashcards: [{ front: "Recovered Card Q", back: "Recovered Card A", sourcePage: 10 }],
        sourceNotes: "Recovered notes",
        model: "gemini-3.5-flash",
      },
    };

    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([mockRecord]);

    await openMaterial("mat-pdf");

    const flashcardsJob = geminiJobs.jobs.find((j) => j.materialId === "mat-pdf");
    expect(flashcardsJob?.kind).toBe("flashcards");

    const saveBtn = await screen.findByRole("button", { name: "Save the new flashcards" });
    fireEvent.click(saveBtn);

    await waitFor(async () => {
      const sets = await repos.documents.listAiStudySets();
      const current = sets.find((s) => s.sourceMaterialId === "mat-pdf")!;
      expect(current.summary).toBe("Preserved summary");
      expect(current.sections).toEqual([{ heading: "Preserved Sec", body: "Preserved body" }]);
      expect(current.flashcards).toEqual([{ front: "Recovered Card Q", back: "Recovered Card A", sourcePage: 10 }]);
    });
  });

  it("Item 0: a recovered study-aid record without 'flashcards:' prefix behaves as a study guide", async () => {
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-pdf",
      title: "Existing Guide",
      summary: "Preserved summary",
      sections: [{ heading: "Preserved Sec", body: "Preserved body" }],
      flashcards: [{ front: "Old Q", back: "Old A", sourcePage: 1 }],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });

    const initialSets = await repos.documents.listAiStudySets();
    const existingSet = initialSets.find((s) => s.sourceMaterialId === "mat-pdf")!;

    const mockRecord: geminiService.GeminiJobRecord = {
      id: "rec-recovered-456",
      materialId: "mat-pdf",
      kind: "study-aid",
      requestId: "req-recovered-guide-456",
      stage: "ready",
      relativePath: "documents/handbook.pdf",
      contentSha256: "",
      baseRevision: existingSet.updatedAt,
      createdAt: 1000,
      updatedAt: 1000,
      result: {
        title: "New Study Guide",
        summary: "New guide summary",
        sections: [{ heading: "New Guide Sec", body: "New Guide body" }],
        flashcards: [{ front: "Guide Card Q", back: "Guide Card A", sourcePage: 2 }],
        sourceNotes: "Guide notes",
        model: "gemini-3.5-flash",
      },
    };

    vi.spyOn(geminiService, "listGeminiJobs").mockResolvedValue([mockRecord]);

    await openMaterial("mat-pdf");

    const job = geminiJobs.jobs.find((j) => j.materialId === "mat-pdf");
    expect(job?.kind).toBe("study-aid");

    const saveBtn = await screen.findByRole("button", { name: "Save the new study guide and cards" });
    fireEvent.click(saveBtn);

    await waitFor(async () => {
      const sets = await repos.documents.listAiStudySets();
      const current = sets.find((s) => s.sourceMaterialId === "mat-pdf")!;
      expect(current.summary).toBe("New guide summary");
      expect(current.sections).toEqual([{ heading: "New Guide Sec", body: "New Guide body" }]);
    });
  });

  it("section order on a PDF page is Start here, Ask, file, Study guide, Flashcards, Practice test, ..., backup last", async () => {
    await openMaterial("mat-pdf");

    const startHere = document.getElementById("material-start-here")!;
    const fileActions = document.getElementById("material-file-actions")!;
    const studyGuide = document.getElementById("material-study-guide")!;
    const flashcards = document.getElementById("material-flashcards")!;
    const practiceTest = document.getElementById("material-practice-test")!;
    const backup = document.getElementById("material-mac-backup")!;

    expect(startHere).toBeTruthy();
    expect(fileActions).toBeTruthy();
    expect(studyGuide).toBeTruthy();
    expect(flashcards).toBeTruthy();
    expect(practiceTest).toBeTruthy();
    expect(backup).toBeTruthy();

    const askCard = document.getElementById("material-ask-gemini")!;
    expect(askCard).toBeTruthy();
    const order = [startHere, askCard, fileActions, studyGuide, flashcards, practiceTest, backup];
    for (let i = 0; i < order.length - 1; i++) {
      expect(
        Boolean(order[i]!.compareDocumentPosition(order[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
    }

    expect(within(fileActions).getByRole("button", { name: "Split automatically" })).toBeTruthy();
    expect(within(fileActions).getByRole("button", { name: "Take out a chapter" })).toBeTruthy();
  });

  it("the 'Your own' card and 'write your own' buttons are gone, while an already-saved hand-written guide displays and is editable", async () => {
    await openMaterial("mat-pdf");

    expect(screen.queryByText("Your own")).toBeNull();
    expect(screen.queryByRole("button", { name: /Write your own/i })).toBeNull();
    expect(screen.queryByText(/write your own/i)).toBeNull();

    cleanup();

    await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-pdf",
      title: "My Hand-written Guide",
      summary: "My notes summary",
      sections: [{ heading: "My Section", body: "Hand-written explanation" }],
      flashcards: [{ front: "My Card", back: "My Answer", sourcePage: null }],
      sourceNotes: "",
      model: "",
    });
    await db.execute("UPDATE ai_study_sets SET provider = 'manual' WHERE source_material_id = 'mat-pdf'");

    await openMaterial("mat-pdf");

    expect(await screen.findByText("My Hand-written Guide")).toBeTruthy();
    expect(screen.getByText("Hand-written explanation")).toBeTruthy();

    const editBtn = screen.getByRole("button", { name: "Edit study guide" });
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn);
    expect(await screen.findByRole("region", { name: "Edit this study guide" })).toBeTruthy();
  });

  it("saved flashcards render in the Flashcards section and saved guide sections in the Study guide section", async () => {
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "mat-pdf",
      title: "Split Sections and Cards",
      summary: "Summary text",
      sections: [{ heading: "Aerodynamics", body: "Lift equals weight." }],
      flashcards: [{ front: "What opposes weight?", back: "Lift.", sourcePage: 12 }],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });

    await openMaterial("mat-pdf");

    const studyGuide = document.getElementById("material-study-guide")!;
    const flashcards = document.getElementById("material-flashcards")!;

    expect(within(studyGuide).getByText("Aerodynamics")).toBeTruthy();
    expect(within(studyGuide).getByText("Lift equals weight.")).toBeTruthy();
    expect(within(studyGuide).queryByText("What opposes weight?")).toBeNull();

    expect(within(flashcards).getByText("What opposes weight?")).toBeTruthy();
    expect(within(flashcards).queryByText("Lift equals weight.")).toBeNull();
  });

  it("each of the three Create buttons starts only its own job kind", async () => {
    const generateAidSpy = vi.spyOn(geminiService, "generateStudyAid").mockResolvedValue({
      title: "Cards",
      summary: "Sum",
      sections: [],
      flashcards: [{ front: "F", back: "B", sourcePage: 1 }],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });
    const resumeGuideSpy = vi.spyOn(geminiService, "resumeStudyGuide").mockResolvedValue({
      title: "Guide Title",
      summary: "Summary",
      sections: [{ heading: "Sec", body: "Body" }],
      flashcards: [],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });
    const generateTestSpy = vi.spyOn(geminiService, "generatePracticeTest").mockResolvedValue({
      title: "Test",
      questions: [{ question: "Q?", options: ["A", "B"], correctIndex: 0, explanation: "E", sourcePage: 1 }],
      model: "gemini-3.5-flash",
    });

    await openMaterial("mat-pdf");

    // 1. Create study guide button starts guide
    const studyGuide = document.getElementById("material-study-guide")!;
    fireEvent.click(within(studyGuide).getByRole("button", { name: "Create study guide" }));
    let dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(resumeGuideSpy).toHaveBeenCalledTimes(1));
    expect(generateAidSpy).not.toHaveBeenCalled();
    expect(generateTestSpy).not.toHaveBeenCalled();

    await act(async () => {
      await geminiJobs.dismiss("mat-pdf:study-aid");
    });
    await waitFor(() => expect(geminiJobs.locked()).toBe(false));

    // 2. Create flashcards button starts flashcards
    const flashcards = document.getElementById("material-flashcards")!;
    fireEvent.click(within(flashcards).getByRole("button", { name: "Create flashcards" }));
    dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(generateAidSpy).toHaveBeenCalledTimes(1));
    expect(generateAidSpy).toHaveBeenCalledWith(
      "documents/handbook.pdf",
      "mat-pdf",
      undefined,
      expect.stringMatching(/^flashcards:req-/),
      40,
    );
    expect(generateTestSpy).not.toHaveBeenCalled();

    await act(async () => {
      await geminiJobs.dismiss("mat-pdf:flashcards");
    });
    await waitFor(() => expect(geminiJobs.locked()).toBe(false));

    // 3. Create practice test button starts practice test
    const practiceTest = document.getElementById("material-practice-test")!;
    fireEvent.click(within(practiceTest).getByRole("button", { name: "Create practice test" }));
    dialog = await waitFor(sendDialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to Gemini" }));
    await waitFor(() => expect(generateTestSpy).toHaveBeenCalledTimes(1));
  });

  it("on an over-limit PDF the three sections show the split-first message and their button moves focus to the file section", async () => {
    await db.execute("UPDATE study_materials SET file_size = ? WHERE id = 'mat-pdf'", [60 * 1024 * 1024]);

    await openMaterial("mat-pdf");

    const studyGuide = document.getElementById("material-study-guide")!;
    const flashcards = document.getElementById("material-flashcards")!;
    const practiceTest = document.getElementById("material-practice-test")!;
    const fileActions = document.getElementById("material-file-actions")!;

    expect(within(studyGuide).getByText("This PDF is too big for Gemini — split it first.")).toBeTruthy();
    expect(within(flashcards).getByText("This PDF is too big for Gemini — split it first.")).toBeTruthy();
    expect(within(practiceTest).getByText("This PDF is too big for Gemini — split it first.")).toBeTruthy();

    expect(within(studyGuide).queryByRole("button", { name: "Create study guide" })).toBeNull();
    expect(within(flashcards).queryByRole("button", { name: "Create flashcards" })).toBeNull();
    expect(within(practiceTest).queryByRole("button", { name: "Create practice test" })).toBeNull();

    const guideSplitBtn = within(studyGuide).getByRole("button", { name: "Split file" });
    const cardsSplitBtn = within(flashcards).getByRole("button", { name: "Split file" });
    const testSplitBtn = within(practiceTest).getByRole("button", { name: "Split file" });

    fileActions.scrollIntoView = vi.fn();

    fireEvent.click(guideSplitBtn);
    expect(document.activeElement).toBe(fileActions);
    expect(fileActions.scrollIntoView).toHaveBeenCalled();

    document.body.focus();
    fireEvent.click(cardsSplitBtn);
    expect(document.activeElement).toBe(fileActions);

    document.body.focus();
    fireEvent.click(testSplitBtn);
    expect(document.activeElement).toBe(fileActions);

    expect(within(fileActions).getByRole("button", { name: "Split automatically" })).toBeTruthy();
    expect(within(fileActions).getByRole("button", { name: "Take out a chapter" })).toBeTruthy();
  });
});
