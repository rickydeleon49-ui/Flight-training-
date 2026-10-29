// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { kitSources } from "@/data/pdfStudyKitDraft";
import type { PdfStudyKitDraft } from "@/services/documents";
import * as geminiService from "@/services/gemini";
import * as pdfService from "@/services/pdf";
import * as documentService from "@/services/documents";
import * as offlineService from "@/services/offlineContent";
import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
let repos: ReturnType<typeof createRepositories>;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

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
      h(MemoryRouter, { initialEntries: [`/study/${id}`] }, h(Ready)),
    ),
  );
  await screen.findByRole("heading", { name: "Flight Training Handbook" });
}

const evidence = { page: 2, startOffset: 0, endOffset: 16, quote: "Sample text here" };

const draftFixture: PdfStudyKitDraft = {
  kind: "pdf-kit",
  version: 1,
  runId: "11111111-2222-4333-8444-555555555555",
  editorOperationId: "22222222-3333-4444-8555-666666666666",
  createdAt: "2026-10-22T12:00:00.000Z",
  reviewState: "review-required",
  identity: {
    materialId: "pdf-mat-1",
    contentSha256: "b".repeat(64),
    selectedPages: [2],
    pageCount: 10,
    algorithmVersion: 1,
    extractorVersion: 1,
  },
  candidates: {
    glossary: [],
    cloze: [],
    outline: [],
    questions: [],
  },
};

describe("KIT-SEPARATE: split display by origin", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);

    await repos.documents.create({
      id: "pdf-mat-1",
      title: "Flight Training Handbook",
      filePath: "documents/flight_training.pdf",
      originalFileName: "flight_training.pdf",
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
    vi.spyOn(offlineService, "offlineStudyEnabled").mockReturnValue(true);
    vi.spyOn(offlineService, "offlineContentReadiness").mockResolvedValue([
      { materialId: "pdf-mat-1", readiness: { state: "searchable", pages: 10 } },
    ]);
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it("renders Gemini sections and cards only at the top and kit items only in Your study kit", async () => {
    const geminiSection = { heading: "Gemini Lift", body: "Gemini explanation of lift." };
    const kitSection = { itemId: "kit-sec-1", heading: "Kit Aerodynamics", body: "Kit explanation of drag." };

    const geminiCard = { front: "What is Gemini Lift?", back: "Gemini lift answer.", sourcePage: 1 };
    const kitSection2 = { itemId: "kit-sec-2", heading: "Kit Weight", body: "More kit content.", origin: "user" as const };
    const kitCard = { itemId: "kit-card-1", front: "What is Kit Drag?", back: "Kit drag answer.", sourcePage: 2 };

    const pdfKitSources = await kitSources(draftFixture, [
      { kind: "section", id: kitSection.itemId, content: kitSection, evidence: [evidence] },
      { kind: "section", id: kitSection2.itemId, content: kitSection2, evidence: [evidence] },
      { kind: "card", id: kitCard.itemId, content: kitCard, evidence: [evidence] },
    ]);

    await repos.documents.saveStudySet({
      operationId: crypto.randomUUID(),
      materialId: "pdf-mat-1",
      reason: "create",
      expected: null,
      next: {
        title: "Flight Training Study Set",
        summary: "Gemini summary of the handbook.",
        summaryOrigin: null,
        sections: [geminiSection, kitSection, kitSection2],
        flashcards: [geminiCard, kitCard],
        sourceNotes: "Gemini source notes.",
        provider: "gemini",
        model: "gemini-3.5-flash",
        retired: [],
      },
      pdfKitSources,
    });

    await openMaterial("pdf-mat-1");

    // 1. Verify Top "Study guide" section
    const guideSection = document.getElementById("material-study-guide")!;
    expect(guideSection).toBeTruthy();
    expect(within(guideSection).getByText("Gemini Lift")).toBeTruthy();
    expect(within(guideSection).getByText("Gemini explanation of lift.")).toBeTruthy();
    expect(within(guideSection).queryByText("Kit Aerodynamics")).toBeNull();
    expect(within(guideSection).queryByText("Kit explanation of drag.")).toBeNull();

    // 2. Verify Top "Flashcards" section
    const flashcardsSection = document.getElementById("material-flashcards")!;
    expect(flashcardsSection).toBeTruthy();
    expect(within(flashcardsSection).getByText("Your card 1 of 1")).toBeTruthy();
    expect(within(flashcardsSection).getByText("What is Gemini Lift?")).toBeTruthy();
    expect(within(flashcardsSection).queryByText("What is Kit Drag?")).toBeNull();

    // 3. Verify Bottom "On this Mac (backup)" section
    const backupSection = document.getElementById("material-mac-backup")!;
    expect(backupSection).toBeTruthy();
    expect(within(backupSection).getByText("Your study kit")).toBeTruthy();

    // Kit section inside "Your study kit"
    expect(within(backupSection).getByText("Kit Aerodynamics")).toBeTruthy();
    expect(within(backupSection).getByText("Kit explanation of drag.")).toBeTruthy();
    // Gemini section NOT in "Your study kit"
    expect(within(backupSection).queryByText("Gemini Lift")).toBeNull();

    // Kit card inside "Your study kit"
    expect(within(backupSection).getByText("PDF card 1 of 1")).toBeTruthy();
    expect(within(backupSection).getByText("What is Kit Drag?")).toBeTruthy();
    // Gemini card NOT in "Your study kit"
    expect(within(backupSection).queryByText("What is Gemini Lift?")).toBeNull();

    // Kit provenance labels and page links in "Your study kit"
    expect(within(backupSection).getAllByText("Pulled from your PDF on this Mac").length).toBeGreaterThan(0);
    expect(within(backupSection).getAllByText(/page 2$/).length).toBeGreaterThan(0);

    // PACKS-07: each section carries the study-aid meaning once, never per item.
    for (const name of ["Flight Training Study Set", "PDF card 1 of 1"]) {
      const section = within(backupSection).getByRole("region", { name });
      expect(within(section).getAllByText("Pulled from your PDF on this Mac")).toHaveLength(1);
      expect(within(section).getAllByText("Study aid. Compare this kit with your PDF, current FAA guidance and your instructor.")).toHaveLength(1);
    }
    expect(within(document.getElementById("material-saved-pdf-kit")!).getAllByText(/Compare this kit/)).toHaveLength(2);
    const visibleReminders = [...backupSection.querySelectorAll("p")].filter(note =>
      !note.closest("dialog") && note.textContent?.includes("Compare this kit"),
    );
    expect(visibleReminders).toHaveLength(2);
    expect(within(backupSection).getByText("Edited by you")).toBeTruthy();
    expect(within(backupSection).getAllByText(/page 2$/)).toHaveLength(3);

    // Flipping the kit flashcard
    const kitCardButton = within(backupSection).getByRole("button", { name: "Reveal flashcard answer" });
    fireEvent.click(kitCardButton);
    expect(within(backupSection).getByText("Kit drag answer.")).toBeTruthy();
  });

  it("keeps kit-only Related study destinations reachable when the PDF is detached", async () => {
    const section = { itemId: "saved-kit-section", heading: "Fictional saved section", body: "Saved synthetic kit body" };
    const card = { itemId: "saved-kit-card", front: "Fictional kit question", back: "Fictional kit answer", sourcePage: 2 };
    const pdfKitSources = await kitSources(draftFixture, [
      { kind: "section", id: section.itemId, content: section, evidence: [evidence] },
      { kind: "card", id: card.itemId, content: card, evidence: [evidence] },
    ]);
    await repos.documents.saveStudySet({ operationId: crypto.randomUUID(), materialId: "pdf-mat-1", reason: "create", expected: null,
      next: { title: "Synthetic saved kit", summary: "", summaryOrigin: null, sections: [section], flashcards: [card], sourceNotes: "", provider: "manual", model: "", retired: [] }, pdfKitSources });
    await repos.documents.update("pdf-mat-1", { filePath: null });
    await openMaterial("pdf-mat-1");
    expect(screen.getByText("Saved synthetic kit body")).toBeTruthy();
    expect(document.getElementById("material-offline-study")).toBeNull();
    expect(document.getElementById("material-pdf-kit")).toBeNull();
    const details = screen.getByText("Related study").closest("details")!;
    details.open = true; fireEvent(details, new Event("toggle"));
    const list = await screen.findByRole("list", { name: "Related study destinations" });
    const target = document.getElementById("material-saved-pdf-kit")!;
    target.scrollIntoView = vi.fn();
    for (const label of ["Study guide: Synthetic saved kit From this material", "Cards: Synthetic saved kit From this material"]) {
      fireEvent.click(within(list).getByRole("button", { name: label }));
      expect(document.activeElement).toBe(target);
    }
  });

  it("PACKS-07 labels saved PDF practice once while keeping question sources and edits", async () => {
    const questions = [0, 1].map(index => ({
      identity: crypto.randomUUID(), question: `Synthetic question ${index}?`,
      options: ["Yes", "No"], correctIndex: 0, explanation: "Synthetic explanation.",
      sourcePage: 2, ...(index === 1 ? { origin: "instructor" as const } : {}),
    }));
    await repos.documents.savePracticeAuthoring({
      operationId: crypto.randomUUID(), sourceMaterialId: "pdf-mat-1", reason: "create", expected: null,
      next: { title: "Synthetic practice", provider: "manual", model: "", questions, retired: [] },
      pdfKitSources: await kitSources(draftFixture, questions.map(q => ({ kind: "question", id: q.identity, content: q, evidence: [evidence] }))),
    });
    await openMaterial("pdf-mat-1");
    const practice = document.getElementById("material-practice-test")!;
    const scope = within(practice);
    await scope.findByText("Synthetic question 0?");
    expect(scope.getAllByText("Pulled from your PDF on this Mac")).toHaveLength(1);
    expect(scope.getAllByText("Study aid. Compare this kit with your PDF, current FAA guidance and your instructor.")).toHaveLength(1);
    expect(scope.queryByText("Source material:")).toBeNull();
    expect(scope.getByText("Source page 2")).toBeTruthy();
    fireEvent.click(scope.getByRole("button", { name: "Question 2, unanswered" }));
    await scope.findByText("Synthetic question 1?");
    expect(scope.getAllByText("Pulled from your PDF on this Mac")).toHaveLength(1);
    expect(scope.getByText("Corrected by your instructor")).toBeTruthy();
    expect(scope.getByText("Source page 2")).toBeTruthy();
  });

  it("renders a set with no kit items as before with nothing extra in On this Mac (backup)", async () => {
    const geminiSection = { heading: "Gemini Lift Only", body: "Gemini body." };
    const geminiCard = { front: "Only Gemini Q", back: "Only Gemini A", sourcePage: 1 };

    await repos.documents.saveStudySet({
      operationId: crypto.randomUUID(),
      materialId: "pdf-mat-1",
      reason: "create",
      expected: null,
      next: {
        title: "Flight Training Study Set",
        summary: "Gemini summary.",
        summaryOrigin: null,
        sections: [geminiSection],
        flashcards: [geminiCard],
        sourceNotes: "",
        provider: "gemini",
        model: "gemini-3.5-flash",
        retired: [],
      },
    });

    await openMaterial("pdf-mat-1");

    // Top Study guide shows the Gemini section
    const guideSection = document.getElementById("material-study-guide")!;
    expect(guideSection).toBeTruthy();
    expect(within(guideSection).getByText("Gemini Lift Only")).toBeTruthy();

    // Top Flashcards shows the Gemini card
    const flashcardsSection = document.getElementById("material-flashcards")!;
    expect(flashcardsSection).toBeTruthy();
    expect(within(flashcardsSection).getByText("Card 1 of 1")).toBeTruthy();
    expect(within(flashcardsSection).getByText("Only Gemini Q")).toBeTruthy();

    // On this Mac (backup) has NO "Your study kit"
    const backupSection = document.getElementById("material-mac-backup")!;
    expect(backupSection).toBeTruthy();
    expect(within(backupSection).queryByText("Your study kit")).toBeNull();
  });
});
