// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as geminiService from "@/services/gemini";
import * as documentService from "@/services/documents";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;

function Probe() {
  context = useAppData();
  navigate = useNavigate();
  return null;
}

function Ready() {
  const { status } = useAppData();
  return status === "ready"
    ? h(
        Routes,
        null,
        h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
        h(Route, { path: "*", element: h("p", null, "Other") }),
      )
    : null;
}

async function open(path: string) {
  render(
    h(
      AppDataProvider,
      null,
      h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Ready)),
    ),
  );
  await waitFor(() => expect(context.status).toBe("ready"));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("MaterialDetail Gemini workflow boundaries", () => {
  beforeEach(async () => {
    localStorage.clear();
    db = await createNodeSqliteDatabase();

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
    vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
    vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.restoreAllMocks();
  });

  it("prevents duplicate Gemini study aid calls when activated repeatedly during in-flight generation", async () => {
    const repos = createRepositories(db);
    const material = await repos.documents.create({
      id: "mat-1",
      title: "Navigation Handbook",
      filePath: "documents/nav.pdf",
      originalFileName: "nav.pdf",
      fileSize: 1024,
    });

    const deferred = createDeferred<geminiService.GeneratedStudyAid>();
    const generateStudyAidSpy = vi
      .spyOn(geminiService, "generateStudyAid")
      .mockImplementation(() => deferred.promise);

    await open(`/study/${material.id}`);

    // Click "Create study aid" button
    const createButton = await screen.findByRole("button", { name: "Create study aid" });
    fireEvent.click(createButton);

    // Confirm dialog appears
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    // Rapid second click while generation is active
    fireEvent.click(confirmButton);

    await waitFor(() => expect(generateStudyAidSpy).toHaveBeenCalledTimes(1));

    // Resolve in-flight request
    await act(async () => {
      deferred.resolve({
        title: "Nav Study Guide",
        summary: "Summary of navigation",
        sections: [{ heading: "VOR", body: "VOR tracking info" }],
        flashcards: [{ front: "Q", back: "A", sourcePage: 1 }],
        sourceNotes: "FAA source",
        model: "gemini-3.5-flash",
      });
    });

    // Verify exactly one study aid was saved
    await waitFor(async () => {
      const studySets = await repos.documents.listAiStudySets();
      expect(studySets).toHaveLength(1);
      expect(studySets[0]?.title).toBe("Nav Study Guide");
    });
    expect(generateStudyAidSpy).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate Gemini practice test calls when activated repeatedly during in-flight generation", async () => {
    const repos = createRepositories(db);
    const material = await repos.documents.create({
      id: "mat-practice",
      title: "Weather Handbook",
      filePath: "documents/weather.pdf",
      originalFileName: "weather.pdf",
      fileSize: 1024,
    });

    const deferred = createDeferred<geminiService.GeneratedPracticeTest>();
    const generatePracticeTestSpy = vi
      .spyOn(geminiService, "generatePracticeTest")
      .mockImplementation(() => deferred.promise);

    await open(`/study/${material.id}`);

    // Click "Create practice test" button
    const createButton = await screen.findByRole("button", { name: "Create practice test" });
    fireEvent.click(createButton);

    // Confirm in dialog
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    // Rapid second click
    fireEvent.click(confirmButton);

    await waitFor(() => expect(generatePracticeTestSpy).toHaveBeenCalledTimes(1));

    // Resolve deferred
    await act(async () => {
      deferred.resolve({
        title: "Weather Test",
        questions: [
          {
            question: "What indicates a cold front?",
            options: ["Towering cumulus", "Stratus clouds"],
            correctIndex: 0,
            explanation: "Towering cumulus clouds often indicate an approaching cold front.",
            sourcePage: 10,
          },
        ],
        model: "gemini-3.5-flash",
      });
    });

    await waitFor(async () => {
      const tests = await repos.documents.listPracticeTests();
      expect(tests).toHaveLength(1);
      expect(tests[0]?.title).toBe("Weather Test");
    });
    expect(generatePracticeTestSpy).toHaveBeenCalledTimes(1);
  });

  it("saves a study aid to the material it was made from even after navigating to another one (GEN-REL-02)", async () => {
    const repos = createRepositories(db);
    const material1 = await repos.documents.create({
      id: "mat-old",
      title: "Old Material",
      filePath: "documents/old.pdf",
      originalFileName: "old.pdf",
      fileSize: 1024,
    });
    const material2 = await repos.documents.create({
      id: "mat-new",
      title: "New Material",
      filePath: "documents/new.pdf",
      originalFileName: "new.pdf",
      fileSize: 1024,
    });

    const deferred = createDeferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => deferred.promise);

    await open(`/study/${material1.id}`);

    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    // User navigates to a different material while generation is in flight
    await act(async () => {
      navigate(`/study/${material2.id}`);
    });

    // Now generation finishes for the old material
    await act(async () => {
      deferred.resolve({
        title: "Old Study Guide",
        summary: "Old summary",
        sections: [],
        flashcards: [],
        sourceNotes: "",
        model: "gemini-3.5-flash",
      });
    });

    // The answer belongs to the material it was made from, not to the page.
    await waitFor(async () =>
      expect((await repos.documents.listAiStudySets()).map((set) => [set.sourceMaterialId, set.title])).toEqual([
        ["mat-old", "Old Study Guide"],
      ]),
    );
  });

  it("does not save a stale study aid if the attachment is replaced before generation completes", async () => {
    const repos = createRepositories(db);
    const material = await repos.documents.create({
      id: "mat-replace",
      title: "Replaceable Material",
      filePath: "documents/first.pdf",
      originalFileName: "first.pdf",
      fileSize: 1024,
    });

    const deferred = createDeferred<geminiService.GeneratedStudyAid>();
    vi.spyOn(geminiService, "generateStudyAid").mockImplementation(() => deferred.promise);

    await open(`/study/${material.id}`);

    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    // In-flight generation is now pending for first.pdf.
    // Replace the attachment on the material.
    await act(async () => {
      await context.mutate((r) =>
        r.documents.update(material.id, {
          filePath: "documents/second.pdf",
          originalFileName: "second.pdf",
        }),
      );
    });

    // Old generation completes
    await act(async () => {
      deferred.resolve({
        title: "Old Study Guide",
        summary: "Old summary",
        sections: [],
        flashcards: [],
        sourceNotes: "",
        model: "gemini-3.5-flash",
      });
    });

    // Verify nothing was saved
    const studySets = await repos.documents.listAiStudySets();
    expect(studySets).toHaveLength(0);
  });

  it("surfaces an actionable local error without calling Gemini when file is missing from disk during preflight", async () => {
    const repos = createRepositories(db);
    const material = await repos.documents.create({
      id: "mat-missing",
      title: "Missing Document",
      filePath: "documents/missing.pdf",
      originalFileName: "missing.pdf",
      fileSize: 1024,
    });

    // documentExists returns true initially on mount, but false on preflight
    let checkCount = 0;
    vi.spyOn(documentService, "documentExists").mockImplementation(async () => {
      checkCount++;
      return checkCount === 1;
    });
    const generateSpy = vi.spyOn(geminiService, "generateStudyAid");

    await open(`/study/${material.id}`);

    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(
        screen.getByText(
          "This study file is missing from app storage. Restore or re-attach the file before generating.",
        ),
      ).toBeTruthy();
    });

    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("starting study aid on material A blocks practice test on material B across navigation until A resolves", async () => {
    const repos = createRepositories(db);
    const materialA = await repos.documents.create({
      id: "mat-lock-a",
      title: "Material A",
      filePath: "documents/a.pdf",
      originalFileName: "a.pdf",
      fileSize: 1024,
    });
    const materialB = await repos.documents.create({
      id: "mat-lock-b",
      title: "Material B",
      filePath: "documents/b.pdf",
      originalFileName: "b.pdf",
      fileSize: 1024,
    });

    const deferredAidA = createDeferred<geminiService.GeneratedStudyAid>();
    const deferredPracticeB = createDeferred<geminiService.GeneratedPracticeTest>();

    const generateStudyAidSpy = vi
      .spyOn(geminiService, "generateStudyAid")
      .mockImplementation(() => deferredAidA.promise);
    const generatePracticeSpy = vi
      .spyOn(geminiService, "generatePracticeTest")
      .mockImplementation(() => deferredPracticeB.promise);

    // 1. Start study aid on material A
    await open(`/study/${materialA.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Create study aid" }));
    const confirmButtonA = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButtonA);

    await waitFor(() => expect(generateStudyAidSpy).toHaveBeenCalledTimes(1));

    // 2. Navigate to material B before A completes
    await act(async () => {
      navigate(`/study/${materialB.id}`);
    });

    // Requirement 1:
    // - B's generation button is disabled
    const practiceBtnB = await screen.findByRole("button", { name: "Create practice test" });
    const studyBtnB = await screen.findByRole("button", { name: "Create study aid" });
    expect(practiceBtnB.hasAttribute("disabled")).toBe(true);
    expect(studyBtnB.hasAttribute("disabled")).toBe(true);

    // - No practice request starts when attempting practice generation on B
    fireEvent.click(practiceBtnB);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(generatePracticeSpy).not.toHaveBeenCalled();

    // Requirement 2:
    // - Resolve A while viewing B
    await act(async () => {
      deferredAidA.resolve({
        title: "Study Guide A",
        summary: "Summary A",
        sections: [],
        flashcards: [],
        sourceNotes: "",
        model: "gemini-3.5-flash",
      });
    });

    // - A's result is saved to A, not to B (GEN-REL-02)
    await waitFor(async () =>
      expect((await repos.documents.listAiStudySets()).map((set) => set.sourceMaterialId)).toEqual([materialA.id]),
    );

    // - The global lock releases
    await waitFor(() => expect(practiceBtnB.hasAttribute("disabled")).toBe(false));
    expect(studyBtnB.hasAttribute("disabled")).toBe(false);

    // - B can then start generation normally
    fireEvent.click(practiceBtnB);
    const confirmButtonB = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButtonB);

    await waitFor(() => expect(generatePracticeSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      deferredPracticeB.resolve({
        title: "Test B",
        questions: [
          {
            question: "QB?",
            options: ["B1", "B2"],
            correctIndex: 0,
            explanation: "EB",
            sourcePage: 1,
          },
        ],
        model: "gemini-3.5-flash",
      });
    });

    await waitFor(async () => {
      const tests = await repos.documents.listPracticeTests();
      expect(tests).toHaveLength(1);
      expect(tests[0]?.sourceMaterialId).toBe(materialB.id);
      expect(tests[0]?.title).toBe("Test B");
    });
  });

  it("starting practice test on material A blocks study aid on material B across navigation until A resolves", async () => {
    const repos = createRepositories(db);
    const materialA = await repos.documents.create({
      id: "mat-rev-a",
      title: "Material A Reverse",
      filePath: "documents/rev-a.pdf",
      originalFileName: "rev-a.pdf",
      fileSize: 1024,
    });
    const materialB = await repos.documents.create({
      id: "mat-rev-b",
      title: "Material B Reverse",
      filePath: "documents/rev-b.pdf",
      originalFileName: "rev-b.pdf",
      fileSize: 1024,
    });

    const deferredPracticeA = createDeferred<geminiService.GeneratedPracticeTest>();
    const deferredAidB = createDeferred<geminiService.GeneratedStudyAid>();

    const generatePracticeSpy = vi
      .spyOn(geminiService, "generatePracticeTest")
      .mockImplementation(() => deferredPracticeA.promise);
    const generateStudyAidSpy = vi
      .spyOn(geminiService, "generateStudyAid")
      .mockImplementation(() => deferredAidB.promise);

    // 1. Start practice test on material A
    await open(`/study/${materialA.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Create practice test" }));
    const confirmButtonA = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButtonA);

    await waitFor(() => expect(generatePracticeSpy).toHaveBeenCalledTimes(1));

    // 2. Navigate to material B before A completes
    await act(async () => {
      navigate(`/study/${materialB.id}`);
    });

    // Requirement 3:
    // - B's study aid button is disabled
    const studyBtnB = await screen.findByRole("button", { name: "Create study aid" });
    const practiceBtnB = await screen.findByRole("button", { name: "Create practice test" });
    expect(studyBtnB.hasAttribute("disabled")).toBe(true);
    expect(practiceBtnB.hasAttribute("disabled")).toBe(true);

    // - Attempt study aid on B - no study aid starts
    fireEvent.click(studyBtnB);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(generateStudyAidSpy).not.toHaveBeenCalled();

    // - Resolve A while viewing B
    await act(async () => {
      deferredPracticeA.resolve({
        title: "Test A",
        questions: [
          {
            question: "QA?",
            options: ["A1", "A2"],
            correctIndex: 0,
            explanation: "EA",
            sourcePage: 1,
          },
        ],
        model: "gemini-3.5-flash",
      });
    });

    // - A's result is saved to A, not to B (GEN-REL-02)
    await waitFor(async () =>
      expect((await repos.documents.listPracticeTests()).map((test) => test.sourceMaterialId)).toEqual([materialA.id]),
    );

    // - Global lock releases
    await waitFor(() => expect(studyBtnB.hasAttribute("disabled")).toBe(false));
    expect(practiceBtnB.hasAttribute("disabled")).toBe(false);

    // - B can then start generation normally
    fireEvent.click(studyBtnB);
    const confirmButtonB = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButtonB);

    await waitFor(() => expect(generateStudyAidSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      deferredAidB.resolve({
        title: "Study Guide B",
        summary: "Summary B",
        sections: [{ heading: "Heading B", body: "Body B" }],
        flashcards: [{ front: "QB", back: "AB", sourcePage: 1 }],
        sourceNotes: "Notes",
        model: "gemini-3.5-flash",
      });
    });

    await waitFor(async () => {
      const studySets = await repos.documents.listAiStudySets();
      expect(studySets).toHaveLength(1);
      expect(studySets[0]?.sourceMaterialId).toBe(materialB.id);
      expect(studySets[0]?.title).toBe("Study Guide B");
    });
  });

  it("guards both confirmation actions in event handlers even when triggered directly while an operation is pending", async () => {
    const repos = createRepositories(db);
    const material = await repos.documents.create({
      id: "mat-guard",
      title: "Guard Test Material",
      filePath: "documents/guard.pdf",
      originalFileName: "guard.pdf",
      fileSize: 1024,
    });

    const deferredAid = createDeferred<geminiService.GeneratedStudyAid>();
    const generateStudyAidSpy = vi
      .spyOn(geminiService, "generateStudyAid")
      .mockImplementation(() => deferredAid.promise);
    const generatePracticeSpy = vi
      .spyOn(geminiService, "generatePracticeTest");

    await open(`/study/${material.id}`);

    const studyAidBtn = await screen.findByRole("button", { name: "Create study aid" });
    const practiceBtn = await screen.findByRole("button", { name: "Create practice test" });

    // 1. Start study aid
    fireEvent.click(studyAidBtn);
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(generateStudyAidSpy).toHaveBeenCalledTimes(1));

    // 2. Both buttons are disabled
    expect(studyAidBtn.hasAttribute("disabled")).toBe(true);
    expect(practiceBtn.hasAttribute("disabled")).toBe(true);

    // 3. Direct click on practice button handler must be guarded in onClick
    fireEvent.click(practiceBtn);
    // Dialog should not open
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(generatePracticeSpy).not.toHaveBeenCalled();

    // 4. Direct click on study button handler must be guarded in onClick
    fireEvent.click(studyAidBtn);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(generateStudyAidSpy).toHaveBeenCalledTimes(1);

    // 5. Clean up deferred
    await act(async () => {
      deferredAid.resolve({
        title: "Study Guide",
        summary: "Summary",
        sections: [],
        flashcards: [],
        sourceNotes: "",
        model: "gemini-3.5-flash",
      });
    });

    await waitFor(async () => {
      const studySets = await repos.documents.listAiStudySets();
      expect(studySets).toHaveLength(1);
    });
  });

  it("starting study-aid generation prevents a practice-test request and disables both buttons", async () => {
    const repos = createRepositories(db);
    const material = await repos.documents.create({
      id: "mat-shared-lock-1",
      title: "Navigation Handbook",
      filePath: "documents/nav.pdf",
      originalFileName: "nav.pdf",
      fileSize: 1024,
    });

    const deferredAid = createDeferred<geminiService.GeneratedStudyAid>();
    const generateStudyAidSpy = vi
      .spyOn(geminiService, "generateStudyAid")
      .mockImplementation(() => deferredAid.promise);
    const generatePracticeSpy = vi
      .spyOn(geminiService, "generatePracticeTest");

    await open(`/study/${material.id}`);

    const studyAidBtn = await screen.findByRole("button", { name: "Create study aid" });
    const practiceBtn = await screen.findByRole("button", { name: "Create practice test" });

    expect(studyAidBtn.hasAttribute("disabled")).toBe(false);
    expect(practiceBtn.hasAttribute("disabled")).toBe(false);

    // Start study aid generation
    fireEvent.click(studyAidBtn);
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(generateStudyAidSpy).toHaveBeenCalledTimes(1));

    // Both buttons should now be disabled
    const workingAidBtn = await screen.findByRole("button", { name: "Reading document…" });
    expect(workingAidBtn.hasAttribute("disabled")).toBe(true);
    expect(practiceBtn.hasAttribute("disabled")).toBe(true);

    // Attempting to trigger practice test while study aid is generating must be prevented
    fireEvent.click(practiceBtn);
    expect(generatePracticeSpy).not.toHaveBeenCalled();

    // Resolve study aid
    await act(async () => {
      deferredAid.resolve({
        title: "Nav Study Guide",
        summary: "Summary",
        sections: [],
        flashcards: [],
        sourceNotes: "",
        model: "gemini-3.5-flash",
      });
    });

    await waitFor(async () => {
      const studySets = await repos.documents.listAiStudySets();
      expect(studySets).toHaveLength(1);
    });
    expect(generatePracticeSpy).not.toHaveBeenCalled();
  });

  it("starting practice-test generation prevents a study-aid request and disables both buttons", async () => {
    const repos = createRepositories(db);
    const material = await repos.documents.create({
      id: "mat-shared-lock-2",
      title: "Weather Handbook",
      filePath: "documents/weather.pdf",
      originalFileName: "weather.pdf",
      fileSize: 1024,
    });

    const deferredPractice = createDeferred<geminiService.GeneratedPracticeTest>();
    const generatePracticeSpy = vi
      .spyOn(geminiService, "generatePracticeTest")
      .mockImplementation(() => deferredPractice.promise);
    const generateStudyAidSpy = vi
      .spyOn(geminiService, "generateStudyAid");

    await open(`/study/${material.id}`);

    const studyAidBtn = await screen.findByRole("button", { name: "Create study aid" });
    const practiceBtn = await screen.findByRole("button", { name: "Create practice test" });

    expect(studyAidBtn.hasAttribute("disabled")).toBe(false);
    expect(practiceBtn.hasAttribute("disabled")).toBe(false);

    // Start practice test generation
    fireEvent.click(practiceBtn);
    const confirmButton = await screen.findByRole("button", { name: "Send to Gemini" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(generatePracticeSpy).toHaveBeenCalledTimes(1));

    // Both buttons should now be disabled
    const workingPracticeBtn = await screen.findByRole("button", { name: "Reading document…" });
    expect(workingPracticeBtn.hasAttribute("disabled")).toBe(true);
    expect(studyAidBtn.hasAttribute("disabled")).toBe(true);

    // Attempting to trigger study aid while practice test is generating must be prevented
    fireEvent.click(studyAidBtn);
    expect(generateStudyAidSpy).not.toHaveBeenCalled();

    // Resolve practice test
    await act(async () => {
      deferredPractice.resolve({
        title: "Weather Test",
        questions: [
          {
            question: "Q1",
            options: ["O1", "O2"],
            correctIndex: 0,
            explanation: "E1",
            sourcePage: 1,
          },
        ],
        model: "gemini-3.5-flash",
      });
    });

    await waitFor(async () => {
      const tests = await repos.documents.listPracticeTests();
      expect(tests).toHaveLength(1);
    });
    expect(generateStudyAidSpy).not.toHaveBeenCalled();
  });
});
