// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { PracticeTest } from "@/domain/types";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { PracticeHistory } from "@/pages/StudyLibrary/PracticeHistory";
import { PracticeTestPanel } from "@/pages/StudyLibrary/PracticeTestPanel";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let repos: Repositories;

const now = "2026-10-05T12:00:00.000Z";

const sampleQuestions = [
  {
    question: "What is the standard traffic pattern altitude at most non-towered airports?",
    options: ["800 feet AGL", "1,000 feet AGL", "1,500 feet AGL"],
    correctIndex: 1,
    explanation: "Standard pattern altitude is 1,000 feet AGL unless otherwise specified.",
    sourcePage: 42,
  },
  {
    question: "Which leg of the traffic pattern is flown parallel to the runway opposite the direction of landing?",
    options: ["Crosswind", "Downwind", "Base leg"],
    correctIndex: 1,
    explanation: "The downwind leg is parallel to the runway opposite landing direction.",
    sourcePage: null,
  },
  {
    question: "When should the before-landing checklist typically be completed?",
    options: ["On final approach", "On downwind or before entering final", "After touchdown"],
    correctIndex: 1,
    explanation: "Complete before-landing checklist on downwind or before turning final.",
    sourcePage: 55,
  },
];

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-test");

  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };

  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "", choice: "standard" });
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

async function seedMaterialAndTest(matId = "mat-1", title = "Traffic Pattern Guide"): Promise<PracticeTest> {
  await repos.documents.create({
    id: matId,
    title,
    filePath: "docs/pattern.pdf",
    originalFileName: "pattern.pdf",
    fileSize: 2048,
  });

  await repos.documents.savePracticeTest({
    provider: "gemini",
    sourceMaterialId: matId,
    title: `${title} Test`,
    questions: sampleQuestions,
    model: "gemini-3.5-flash",
  });

  const all = await repos.documents.listPracticeTests();
  const test = all.find((t) => t.sourceMaterialId === matId);
  if (!test) throw new Error("Failed to seed practice test");
  return test;
}

function renderInApp(ui: React.ReactElement, initialPath = "/") {
  return render(
    h(
      AppDataProvider,
      null,
      h(MemoryRouter, { initialEntries: [initialPath] }, ui),
    ),
  );
}

describe("M2 Practice-Session PR2 UI & Flow Verification", () => {
  it("resumes in-progress attempt at nextUnansweredOrdinal across remount", async () => {
    const test = await seedMaterialAndTest("mat-resume", "Resume Test Material");

    // 1. Initial mount: answer Q1
    const { unmount } = renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Resume Test Material" }),
    );

    // Wait for panel to load from repo
    await screen.findByText("Question 1 of 3");

    // Select Q1 answer
    const q1Options = screen.getAllByRole("radio");
    fireEvent.click(q1Options[1]!); // correct option

    await screen.findByText("Correct");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);

    // Now at Q2
    await screen.findByText("Question 2 of 3");

    // Unmount panel (simulating navigating away or reload)
    unmount();

    // 2. Remount panel
    renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Resume Test Material" }),
    );

    // Resumes at Q2 (the next unanswered ordinal)
    await screen.findByText("Question 2 of 3");

    // Verify Q1 pill shows answered
    const q1Pill = screen.getByRole("button", { name: /Question 1, correct/ });
    expect(q1Pill).toBeTruthy();

    // Revisit Q1 via pill
    fireEvent.click(q1Pill);
    await screen.findByText("Question 1 of 3");
    expect(screen.getByText("Correct")).toBeTruthy();
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
  });

  it("handles 'I don’t know' distinctly from incorrect and unanswered", async () => {
    const test = await seedMaterialAndTest("mat-dk", "Don't Know Test Material");

    renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Don't Know Test Material" }),
    );

    await screen.findByText("Question 1 of 3");

    // Click "I don't know"
    const dkButton = screen.getByRole("button", { name: "I don’t know" });
    fireEvent.click(dkButton);

    // Shows training explanation and "Marked as don't know" badge
    await screen.findByText("Marked as don’t know");
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();

    // Nav pill updates to indicate don't know
    const q1Pill = screen.getByRole("button", { name: /Question 1, not quite, don’t know/ });
    expect(q1Pill).toBeTruthy();

    // Continue to Q2 once persistence completes
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);
    await screen.findByText("Question 2 of 3");

    // Answer Q2 with "I don't know"
    fireEvent.click(screen.getByRole("button", { name: "I don’t know" }));
    await screen.findByText("Marked as don’t know");

    // Click "Complete test now (1 unanswered)" once persistence completes
    const completeEarlyBtn = await screen.findByRole("button", { name: /Complete test now \(1 unanswered\)/ });
    await waitFor(() => expect(completeEarlyBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(completeEarlyBtn);

    // Verify summary badges: 0 correct, 0 incorrect, 2 don't know, 1 unanswered
    await screen.findByText("Practice test complete");
    expect(screen.getByText("0 of 3 correct")).toBeTruthy();
    expect(screen.getByText("0 correct")).toBeTruthy();
    expect(screen.getByText("0 incorrect")).toBeTruthy();
    expect(screen.getByText("2 don’t know")).toBeTruthy();
    expect(screen.getByText("1 unanswered")).toBeTruthy();

    // Approved disclaimer
    expect(
      screen.getByText(
        "Practice result from your material (0%). Not an official FAA knowledge test score or certification of flight readiness.",
      ),
    ).toBeTruthy();
  });

  it("allows deliberate answer changes while attempt remains in-progress", async () => {
    const test = await seedMaterialAndTest("mat-change", "Change Answer Material");

    renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Change Answer Material" }),
    );

    await screen.findByText("Question 1 of 3");

    // Initially choose wrong option (index 0)
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");

    // Click "Change answer"
    const changeBtn = screen.getByRole("button", { name: "Change answer" });
    await waitFor(() => expect(changeBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(changeBtn);

    // Options are re-enabled: choose correct option (index 1)
    const options = screen.getAllByRole("radio");
    expect(options[1]?.hasAttribute("disabled")).toBe(false);
    fireEvent.click(options[1]!);

    // Now reflects Correct
    await screen.findByText("Correct");
  });

  it("supports skipping and navigation pills across questions", async () => {
    const test = await seedMaterialAndTest("mat-nav", "Navigation Test Material");

    renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Navigation Test Material" }),
    );

    await screen.findByText("Question 1 of 3");

    // Skip Q1 without answering
    fireEvent.click(screen.getByRole("button", { name: "Skip for now →" }));
    await screen.findByText("Question 2 of 3");

    // Answer Q2
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");

    // Navigate to Q3 using pill 3 once Q2 save finishes
    const pill3 = screen.getByRole("button", { name: /^Question 3/ });
    await waitFor(() => expect(pill3.hasAttribute("disabled")).toBe(false));
    fireEvent.click(pill3);
    await screen.findByText("Question 3 of 3");

    // Answer Q3
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");

    // Click pill 1 to return to skipped Q1 once Q3 save finishes
    const pill1 = screen.getByRole("button", { name: /^Question 1/ });
    await waitFor(() => expect(pill1.hasAttribute("disabled")).toBe(false));
    fireEvent.click(pill1);
    await screen.findByText("Question 1 of 3");

    // Answer Q1
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");

    // Finish test: navigate to Q3 and click See score
    await waitFor(() => expect(screen.getByRole("button", { name: /^Question 3/ }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /^Question 3/ }));
    await screen.findByText("Question 3 of 3");

    const seeScoreBtn = screen.getByRole("button", { name: "See score" });
    await waitFor(() => expect(seeScoreBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(seeScoreBtn);

    await screen.findByText("Practice test complete");
    expect(screen.getByText("3 of 3 correct")).toBeTruthy();
    expect(
      screen.getByText(
        "Practice result from your material (100%). Not an official FAA knowledge test score or certification of flight readiness.",
      ),
    ).toBeTruthy();
  });

  it("handles retake by abandoning previous attempt and starting fresh", async () => {
    const test = await seedMaterialAndTest("mat-retake", "Retake Test Material");

    renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Retake Test Material" }),
    );

    await screen.findByText("Question 1 of 3");

    // Answer Q1 and finish early
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");

    const completeBtn = screen.getByRole("button", { name: /Complete test now/ });
    await waitFor(() => expect(completeBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(completeBtn);
    await screen.findByText("Practice test complete");

    // Click "Retake this test"
    const retakeBtn = screen.getByRole("button", { name: "Retake this test" });
    await waitFor(() => expect(retakeBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retakeBtn);

    // Returns to fresh Q1
    await screen.findByText("Question 1 of 3");
    expect(screen.queryByText("Practice test complete")).toBeNull();
    const options = screen.getAllByRole("radio");
    for (const opt of options) {
      expect(opt.getAttribute("aria-checked")).toBe("false");
    }
  });

  it("handles in-progress abandon with truthful confirmation", async () => {
    const test = await seedMaterialAndTest("mat-abandon", "Abandon Test Material");

    renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Abandon Test Material" }),
    );

    await screen.findByText("Question 1 of 3");

    // Answer Q1 so the attempt is in-progress and persisted
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");

    // Click "Abandon attempt" once persisted
    const abandonBtn = await screen.findByRole("button", { name: "Abandon attempt" });
    await waitFor(() => expect(abandonBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(abandonBtn);

    // Confirmation dialog appears
    await screen.findByText("Abandon this practice attempt?");
    expect(
      screen.getByText(
        "This will mark the current in-progress attempt as abandoned. Completed attempts remain in your history.",
      ),
    ).toBeTruthy();

    // Cancel does not abandon
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Question 1 of 3")).toBeTruthy();

    // Confirm abandon
    fireEvent.click(abandonBtn);
    await screen.findByText("Abandon this practice attempt?");
    const confirmAbandonBtn = screen.getAllByRole("button", { name: "Abandon attempt" })[1]!;
    fireEvent.click(confirmAbandonBtn);

    // Resets panel
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("renders quarantined legacy notice on malformed test without start button", async () => {
    // Seed material and corrupted legacy practice test
    const matId = "mat-quarantine";
    await repos.documents.create({
      id: matId,
      title: "Malformed Material",
      filePath: "docs/bad.pdf",
      originalFileName: "bad.pdf",
      fileSize: 1024,
    });

    await db.execute(
      `INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error)
       VALUES (?, ?, ?, 'gemini', 'gemini-1.5', ?, ?, NULL, 'MALFORMED_QUESTION')`,
      [matId, "Malformed Test", "not valid json", now, now],
    );

    renderInApp(
      h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })),
      `/study/${matId}`,
    );

    await screen.findByRole("heading", { name: "Malformed Material" });

    // Quarantined alert is displayed
    await screen.findByText(
      "This practice test contains malformed questions from an earlier version and cannot be started. Please regenerate the practice test.",
    );

    // No start button or radio options for practice questions are shown
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start practice test" })).toBeNull();
  });

  it("keeps completed history reachable after source material deletion", async () => {
    const matId = "mat-detach";
    await seedMaterialAndTest(matId, "Detached History Material");

    // Complete an attempt on this test
    const repo = repos.practiceSessions;
    const version = (await repo.getActiveVersion(matId))!;
    const op1 = crypto.randomUUID();
    const startRes = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: op1,
      materialId: matId,
      versionId: version.version.id,
    });
    const attId = (startRes as { attemptId: string }).attemptId;

    const op2 = crypto.randomUUID();
    await repo.saveSessionAction({
      action: "record_response",
      operationId: op2,
      attemptId: attId,
      itemId: version.items[0]!.id,
      expectedRevision: 0,
      selectedIndex: 1,
      isDontKnow: false,
    });

    const op3 = crypto.randomUUID();
    await repo.saveSessionAction({
      action: "complete_attempt",
      operationId: op3,
      attemptId: attId,
      expectedRevision: 1,
    });

    // Delete the source material
    await repos.documents.remove(matId);

    // Verify source material is deleted but history remains
    const allMaterials = await repos.documents.list();
    expect(allMaterials.some((m) => m.id === matId)).toBe(false);

    // Render /study/history
    renderInApp(
      h(
        Routes,
        null,
        h(Route, { path: "/study/history", element: h(PracticeHistory) }),
        h(Route, { path: "/study/history/:historyKey", element: h(PracticeHistory) }),
        h(Route, { path: "/study/history/:historyKey/:attemptId", element: h(PracticeHistory) }),
      ),
      "/study/history",
    );

    // Lists the detached history group
    await screen.findByText("Detached History Material");
    expect(screen.getByText("Source material removed")).toBeTruthy();
    expect(screen.getByText("1 completed test")).toBeTruthy();

    // Click "View attempts" to navigate to /study/history/:historyKey
    fireEvent.click(screen.getByRole("link", { name: "View attempts" }));

    await screen.findByText("Retained completed attempts from removed study material.");
    expect(screen.getByText("1 of 3 correct")).toBeTruthy();

    // Click "Review attempt" to view immutable review
    fireEvent.click(screen.getByRole("link", { name: "Review attempt" }));

    await screen.findByText("Review: Detached History Material");
    expect(
      screen.getByText(
        "Practice result from your material (33.3%). Not an official FAA knowledge test score or certification of flight readiness.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("What is the standard traffic pattern altitude at most non-towered airports?")).toBeTruthy();
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
  });

  it("erases practice history atomically with truthful confirmation modal", async () => {
    const matId = "mat-erase-ui";
    await seedMaterialAndTest(matId, "Erase UI Material");

    // Complete an attempt
    const repo = repos.practiceSessions;
    const version = (await repo.getActiveVersion(matId))!;
    const op1 = crypto.randomUUID();
    const startRes = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: op1,
      materialId: matId,
      versionId: version.version.id,
    });
    const attId = (startRes as { attemptId: string }).attemptId;

    const op2 = crypto.randomUUID();
    await repo.saveSessionAction({
      action: "complete_attempt",
      operationId: op2,
      attemptId: attId,
      expectedRevision: 0,
    });

    // Render history group detail
    renderInApp(
      h(
        Routes,
        null,
        h(Route, { path: "/study/history", element: h(PracticeHistory) }),
        h(Route, { path: "/study/history/:historyKey", element: h(PracticeHistory) }),
      ),
      `/study/history/${matId}`,
    );

    await screen.findByRole("heading", { name: "Erase UI Material" });
    const eraseBtn = screen.getByRole("button", { name: "Erase practice history" });
    expect(eraseBtn).toBeTruthy();

    // Click erase
    fireEvent.click(eraseBtn);

    // Confirmation dialog opens with truthful disclosures
    await screen.findByText("Erase practice history?");
    expect(
      screen.getByText(
        /This will permanently erase all completed and in-progress practice sessions under this history record for “Erase UI Material”/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /The current study material, active practice test, and PDFs are preserved for future practice. Previously exported backups are unaffected./,
      ),
    ).toBeTruthy();

    // Cancel is non-destructive
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Score: 0%")).toBeTruthy();

    // Open again and confirm erase
    fireEvent.click(eraseBtn);
    await screen.findByText("Erase practice history?");
    const confirmBtn = screen.getByRole("button", { name: "Erase history" });
    fireEvent.click(confirmBtn);

    // Redirects to /study/history
    await waitFor(() => {
      expect(screen.getByText("Practice History")).toBeTruthy();
    });

    // Verify attempts were erased in database
    const attempts = await db.select("SELECT id FROM practice_attempts WHERE source_material_id = ?", [matId]);
    expect(attempts).toHaveLength(0);

    // Active test version is preserved
    const versions = await db.select("SELECT id FROM practice_test_versions WHERE history_key = ?", [matId]);
    expect(versions).toHaveLength(1);
  });

  it("handles transient mutation error with same-operationId retry", async () => {
    const test = await seedMaterialAndTest("mat-retry", "Retry Test Material");

    // Spy on db.savePracticeSessionAtomically to simulate a transient failure once when recording answer
    let failOnce = true;
    let originalOpId: string | null = null;
    const realSave = db.savePracticeSessionAtomically!.bind(db);

    vi.spyOn(db, "savePracticeSessionAtomically").mockImplementation(async (action) => {
      if (action.action === "record_response" && failOnce) {
        failOnce = false;
        originalOpId = action.operationId;
        throw new Error("Simulated network/lock failure");
      }
      return realSave(action);
    });

    renderInApp(
      h(PracticeTestPanel, { practiceTest: test, materialTitle: "Retry Test Material" }),
    );

    await screen.findByText("Question 1 of 3");

    // Click answer option to trigger record_response
    fireEvent.click(screen.getAllByRole("radio")[1]!);

    // Error alert and Retry button appear
    await screen.findByRole("alert");
    expect(screen.getByText("Simulated network/lock failure")).toBeTruthy();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    expect(retryBtn).toBeTruthy();

    // Click Retry
    fireEvent.click(retryBtn);

    // Successful save: reveals training feedback
    await screen.findByText("Correct");

    // Assert that the retry used the EXACT SAME operation ID
    expect(originalOpId).toBeTruthy();
    const receipt = await db.select(
      "SELECT operation_id FROM practice_session_operations WHERE operation_id = ?",
      [originalOpId!],
    );
    expect(receipt).toHaveLength(1);
  });
});
