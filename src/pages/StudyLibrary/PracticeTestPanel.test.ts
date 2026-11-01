// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { practiceAskContext } from "@/logic/practiceAskContext";
import { makeMaterial } from "@/testing/factories";
import maxContext from "@/testing/fixtures/ask-max-import-context.txt?raw";
import { validatePacketText } from "@/logic/studyPacket";
import type { PracticeTest } from "@/domain/types";
import * as geminiService from "@/services/gemini";
import { PracticeTestPanel } from "./PracticeTestPanel";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";

describe("PracticeTestPanel", () => {
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
      {
        question: "Which leg of the traffic pattern is flown parallel to the runway opposite the direction of landing?",
        options: ["Crosswind", "Downwind", "Base leg"],
        correctIndex: 1,
        explanation: "The downwind leg is parallel to the runway in the opposite direction of landing.",
        sourcePage: null,
      },
    ],
    provider: "gemini",
    model: "gemini-3.5-flash",
    generatedAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    repos = createRepositories(db);
    await repos.documents.create({ id: sampleTest.sourceMaterialId, title: sampleTest.title });
    await repos.documents.savePracticeTest(sampleTest);
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db?.close();
  });

  async function renderPanel(ui: React.ReactElement, filePath: string | null = "documents/test.pdf") {
    const value = {
      repositories: repos,
      data: { ...EMPTY_DATA, materials: [makeMaterial({ id: "mat-1", filePath })] },
      status: "ready",
      error: null,
    } as ContextType<typeof AppDataContext>;
    const view = render(h(AppDataContext.Provider, { value }, ui));
    await screen.findByRole("heading", {name:/Question \d+ of 2/});
    return view;
  }

  async function seedEarlierAttempt() {
    const older = { ...sampleTest, questions: sampleTest.questions.map(q => ({ ...q, options: [...q.options, "Older fourth choice"] })) };
    await repos.documents.savePracticeTest(older);
    const active = (await repos.practiceSessions.getActiveVersion("mat-1"))!;
    const started = await repos.practiceSessions.saveSessionAction({ action: "start_or_resume", operationId: crypto.randomUUID(), materialId: "mat-1", versionId: active.version.id });
    await repos.documents.savePracticeTest(sampleTest);
    // Simulate a retained legacy unfinished attempt; normal regeneration closes it.
    await db.execute("UPDATE practice_attempts SET status = 'in_progress', completed_at = NULL WHERE id = ?", [started.attemptId]);
    return started;
  }

  it("uses calm progress for a new attempt and resume wording only after reopening", async () => {
    const view = await renderPanel(h(PracticeTestPanel, {practiceTest: sampleTest}));
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    expect(screen.queryByText(/Resuming your attempt/)).toBeNull();
    const progress = screen.getByRole("status", {name:"Practice progress"});
    expect(progress.classList.contains("ai-disclaimer")).toBe(false);
    await waitFor(async () => expect((await repos.practiceSessions.getCurrentAttempt("mat-1"))?.responses).toHaveLength(1));
    view.unmount();
    await renderPanel(h(PracticeTestPanel, {practiceTest: sampleTest}));
    expect(await screen.findByText(/Resuming your attempt — 1 of 2 answered/)).toBeTruthy();
  });

  it.each(["answer", "finish"])("offers skipped questions at the end and lets her %s", async action => {
    await renderPanel(h(PracticeTestPanel, {practiceTest: sampleTest}));
    fireEvent.click(screen.getByRole("button", {name:"Skip for now →"}));
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    const score = screen.getByRole("button", {name:"See score"});
    await waitFor(() => expect(score.hasAttribute("disabled")).toBe(false));
    fireEvent.click(score);
    const confirm = screen.getByRole("dialog", {name:"Answer skipped questions?"});
    expect(within(confirm).getByText("You skipped 1 question. Answer them now?")).toBeTruthy();
    expect((await repos.practiceSessions.getCurrentAttempt("mat-1"))?.responses).toHaveLength(1);
    if (action === "answer") {
      fireEvent.click(within(confirm).getByRole("button", {name:"Answer skipped"}));
      expect(screen.getByRole("heading", {name:"Question 1 of 2"})).toBeTruthy();
      fireEvent.click(screen.getAllByRole("radio")[1]!);
      await screen.findByText("Correct");
      await waitFor(async () => expect((await repos.practiceSessions.getCurrentAttempt("mat-1"))?.responses).toHaveLength(2));
    } else {
      fireEvent.click(within(confirm).getByRole("button", {name:"Finish test"}));
      await waitFor(async () => expect(await repos.practiceSessions.getCurrentAttempt("mat-1")).toBeNull());
    }
  });

  it("offers fresh current questions first without changing the earlier attempt until clicked", async () => {
    const older = await seedEarlierAttempt();
    const save = vi.spyOn(repos.practiceSessions, "saveSessionAction");
    const value = { repositories: repos, data: EMPTY_DATA, status: "ready", error: null } as ContextType<typeof AppDataContext>;
    render(h(AppDataContext.Provider, { value }, h(PracticeTestPanel, { practiceTest: sampleTest })));
    const fresh = await screen.findByRole("button", { name: "Start a fresh test" });
    expect(fresh.classList.contains("button--primary")).toBe(true);
    expect(screen.getByText("Starting fresh marks the earlier attempt abandoned and keeps its saved answers.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect((await repos.practiceSessions.getAttempt(older.attemptId))?.status).toBe("in_progress");
    fireEvent.click(fresh);
    await screen.findByText("Question 1 of 2");
    expect(screen.getAllByRole("radio")).toHaveLength(3); // The current three answer choices.
    expect(screen.queryByText("Older fourth choice")).toBeNull();
    expect((await repos.practiceSessions.getAttempt(older.attemptId))?.status).toBe("abandoned");
    expect(save.mock.calls[0]?.[0].action).toBe("retake_attempt");
  });

  it("keeps the earlier frozen questions reachable and abandonment behind confirmation", async () => {
    const older = await seedEarlierAttempt();
    const value = { repositories: repos, data: EMPTY_DATA, status: "ready", error: null } as ContextType<typeof AppDataContext>;
    render(h(AppDataContext.Provider, { value }, h(PracticeTestPanel, { practiceTest: sampleTest })));
    fireEvent.click(await screen.findByRole("button", { name: "Continue earlier attempt" }));
    expect(await screen.findByText("Older fourth choice")).toBeTruthy();
    const abandon = screen.getByRole("button", { name: "Abandon attempt" });
    expect(abandon.classList.contains("button--ghost")).toBe(true);
    fireEvent.click(abandon);
    const confirm = await screen.findByRole("dialog", { name: "Abandon this practice attempt?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect((await repos.practiceSessions.getAttempt(older.attemptId))?.status).toBe("in_progress");
    fireEvent.click(abandon);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Abandon this practice attempt?" })).getByRole("button", { name: "Abandon attempt" }));
    await waitFor(() => expect(screen.queryByText("Older fourth choice")).toBeNull());
    expect((await repos.practiceSessions.getAttempt(older.attemptId))?.status).toBe("abandoned");
  });

  it("can finish the earlier frozen attempt and retake with current questions", async () => {
    const older = await seedEarlierAttempt();
    const value = { repositories: repos, data: EMPTY_DATA, status: "ready", error: null } as ContextType<typeof AppDataContext>;
    render(h(AppDataContext.Provider, { value }, h(PracticeTestPanel, { practiceTest: sampleTest })));
    fireEvent.click(await screen.findByRole("button", { name: "Continue earlier attempt" }));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    const complete = await screen.findByRole("button", { name: /Complete test now/ });
    fireEvent.click(complete);
    fireEvent.click(await screen.findByRole("button", { name: "Retake this test" }));
    await screen.findByText("Question 1 of 2");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByText("Older fourth choice")).toBeNull();
    expect((await repos.practiceSessions.getAttempt(older.attemptId))?.status).toBe("completed");
  });

  it("resumes matching questions and keeps primary Continue apart from quiet Abandon", async () => {
    const active = (await repos.practiceSessions.getActiveVersion("mat-1"))!;
    await repos.practiceSessions.saveSessionAction({ action: "start_or_resume", operationId: crypto.randomUUID(), materialId: "mat-1", versionId: active.version.id });
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));
    expect(screen.queryByRole("button", { name: "Start a fresh test" })).toBeNull();
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    const next = await screen.findByRole("button", { name: "Continue" });
    await waitFor(() => expect(next.hasAttribute("disabled")).toBe(false));
    const abandon = screen.getByRole("button", { name: "Abandon attempt" });
    expect(next.classList.contains("button--primary")).toBe(true);
    expect(abandon.classList.contains("button--ghost")).toBe(true);
    expect(next.parentElement).not.toBe(abandon.parentElement);
    expect(abandon.parentElement?.style.borderTop).toContain("dashed");
    fireEvent.click(next);
    expect(await screen.findByText("Question 2 of 2")).toBeTruthy();
  });

  it("shows the ACS chip below a tagged saved question", async () => {
    const tagged = { ...sampleTest, questions: sampleTest.questions.map((question, index) => index === 0 ? { ...question, acsTask: "PA.II.A" } : question) };
    await repos.documents.savePracticeTest(tagged);
    await renderPanel(h(PracticeTestPanel, { practiceTest: tagged }));
    expect(screen.getByText("PA.II.A · Preflight Assessment")).toBeTruthy();
  });

  it("leaves old untagged questions without an ACS chip", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));
    expect(screen.queryByText(/PA\.II\.A/)).toBeNull();
  });

  it("Why without a PDF keeps the original answer without evidence UI", async () => {
    vi.spyOn(geminiService, "watchAskGeminiProgress").mockResolvedValue(() => {});
    const ask = vi.spyOn(geminiService, "askGemini").mockResolvedValue({
      answer: "A fictional practice explanation.", model: "gemini-3.5-flash", sourcePages: [],
    });
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }), null);
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Why this answer?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("A fictional practice explanation.");
    expect(ask.mock.calls[0]![0]).toMatchObject({ materialId: "mat-1", relativePath: null, history: [] });
    expect((ask.mock.calls[0]![0] as geminiService.AskGeminiParams).context).toContain(sampleTest.questions[0]!.question);
    expect(screen.getByText(/^Answered by /)).toBeTruthy();
    expect(screen.queryByText(/^Sources \(/)).toBeNull();
    expect(screen.queryByText("I couldn't check the supporting text.")).toBeNull();
    expect(screen.queryByText("Not answered by these sources.")).toBeNull();
    expect(screen.getByText("Your question, study context and recent conversation are sent to Google.")).toBeTruthy();
    expect(screen.getByText("Study aid — check it against FAA guidance and your instructor.")).toBeTruthy();
  });

  it("cancels a pending reply on answered-to-answered navigation and starts fresh", async () => {
    vi.spyOn(geminiService, "watchAskGeminiProgress").mockResolvedValue(() => {});
    const cancel = vi.spyOn(geminiService, "cancelAskGemini").mockResolvedValue();
    let resolveOld!: (answer: geminiService.AskGeminiResult) => void;
    const ask = vi.spyOn(geminiService, "askGemini")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ answer: "Current answer", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Question 2 of 2");
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: "Question 1, correct" }));
    await screen.findByText("Question 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Old question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    const old = ask.mock.calls[0]![0] as geminiService.AskGeminiParams;
    fireEvent.click(screen.getByRole("button", { name: "Question 2, correct" }));
    await screen.findByText("Question 2 of 2");
    expect(cancel).toHaveBeenCalledExactlyOnceWith(old.requestId);
    expect(screen.queryByLabelText("Ask a question")).toBeNull();
    await act(async () => { resolveOld({ answer: "Stale answer", model: "gemini-3.5-flash", notAnswered: false, passages: [] }); });
    expect(screen.queryByText("Stale answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "New question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Current answer");
    expect(ask.mock.calls[1]![0]).toMatchObject({ history: [], context: expect.stringContaining("downwind leg") });
  });

  it("budgets maximum authored text while retaining both answer identities", () => {
    const chosen = "A" + "🛩".repeat(999);
    const correct = "B" + "🛩".repeat(999);
    const context = practiceAskContext({ questionText: "🛩".repeat(10000), options: [chosen, correct], explanation: "🛩".repeat(5000) }, chosen, correct);
    expect(Array.from(context).length).toBeLessThanOrEqual(8000);
    expect(context).toContain(`Her chosen answer: ${chosen}`);
    expect(context).toContain(`Correct answer: ${correct}`);
    expect(context).toMatch(/^Question: 🛩+…/u);
    expect(context).toContain("Explanation: …");
    expect(context).toContain("Choices:\n…");
    expect(context).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  });

  it("budgets a maximum imported Unicode question through import, persistence and Ask validation", async () => {
    const packet = validatePacketText(JSON.stringify({
      format: "hfd-study-packet", formatVersion: 1, title: "Synthetic maximum",
      questions: [{ id: "q1", type: "single-choice", question: "🛩".repeat(2000),
        choices: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, text: String(i) + "🛩".repeat(499) })),
        correctChoiceId: "c1", explanation: "🛩".repeat(4000) }],
    }));
    expect(packet.ok).toBe(true);
    if (!packet.ok || !packet.payload.practiceTest) throw new Error("Synthetic import refused");
    const imported = packet.payload.practiceTest.questions[0]!;
    const test = { ...sampleTest, questions: [imported, sampleTest.questions[1]!] };
    await repos.documents.savePracticeTest(test);
    vi.spyOn(geminiService, "watchAskGeminiProgress").mockResolvedValue(() => {});
    const ask = vi.spyOn(geminiService, "askGemini").mockResolvedValue({ answer: "Bounded answer", model: "gemini-3.5-flash", notAnswered: false, passages: [] });
    await renderPanel(h(PracticeTestPanel, { practiceTest: test }));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Bounded answer");
    const context = (ask.mock.calls[0]![0] as geminiService.AskGeminiParams).context;
    // Rust validate_context tests this exact fixture, not a second TS validator.
    expect(context).toBe(maxContext);
    expect(Array.from(context)).toHaveLength(8000);
    expect(context).toContain(`Question: ${imported.question}`);
    expect(context).toContain(`Her chosen answer: ${imported.options[0]}`);
    expect(context).toContain(`Correct answer: ${imported.options[1]}`);
    expect(context).toContain("…");
  });

  it.each([false, true])("STUDENT-1: Continue restores the next heading after a long Ask answer (reduced motion %s)", async (reduced) => {
    const scroll = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
    vi.spyOn(geminiService, "watchAskGeminiProgress").mockResolvedValue(() => {});
    const answer = "A long synthetic explanation. ".repeat(200);
    vi.spyOn(geminiService, "askGemini").mockResolvedValue({ answer, model: "gemini-3.5-flash", notAnswered: false, passages: [] });
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    fireEvent.click(screen.getByRole("button", { name: "Why? Ask Gemini" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask a question" }), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(answer.trim());
    // The answer's own scroll-into-view runs in an effect after it renders;
    // wait for it so it cannot land after the counter is cleared (CI flake).
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" })));
    scroll.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const heading = await screen.findByRole("heading", { name: "Question 2 of 2" });
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: reduced ? "auto" : "smooth" });
    expect(screen.queryByText(answer.trim())).toBeNull();
    scroll.mockClear();
    // A user can also go back to an answered question without losing the heading.
    fireEvent.click(screen.getByRole("button", { name: "Question 1, not quite" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Question 1 of 2" }));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: reduced ? "auto" : "smooth" });
  });

  it("STUDENT-1: tiles distinguish incorrect, correct, unanswered and current", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));
    expect(screen.getByRole("button", { name: "Question 1, unanswered" }).className).toContain("practice-pill--current");
    expect(screen.getByRole("button", { name: "Question 2, unanswered" }).className).toBe("practice-pill");
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    expect(screen.getByRole("button", { name: "Question 1, not quite" }).className).toContain("practice-pill--incorrect");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Question 2 of 2");
    expect(screen.getByRole("button", { name: "Question 1, not quite" }).className).not.toContain("practice-pill--current");
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    const correct = screen.getByRole("button", { name: "Question 2, correct" });
    expect(correct.className).toContain("practice-pill--correct");
    expect(correct.className).toContain("practice-pill--current");
  });

  it("material-page practice shows Source page without the loaded material title", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest, materialTitle: "Loaded handbook" }));
    expect(screen.getByText("Source page 42")).toBeTruthy();
    expect(screen.queryByText(/From:/)).toBeNull();
    expect(screen.queryByText(/Loaded handbook/)).toBeNull();
    expect(screen.queryByText(/Crosswind Landing Notes/)).toBeNull();
  });

  it("opening a source keeps the active question and hidden answer without session writes", async () => {
    db.inspectNavigationIdentity = async materialId => ({ materialId, contentSha256: "a".repeat(64), totalPages: 50, verifiedAt: "x", changed: false });
    const open = vi.fn().mockResolvedValue(undefined);
    db.openNavigationDocument = open;
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest, materialTitle: "Loaded handbook" }));
    const save = vi.spyOn(repos.practiceSessions, "saveSessionAction");
    const before = await db.select("SELECT * FROM practice_attempts");
    const responses = await db.select("SELECT * FROM practice_responses");
    const options = screen.getAllByRole("radio");
    const source = screen.getByRole("button", { name: "Open source: Source page 42" });
    expect(source.tagName).toBe("BUTTON");
    expect(source.tabIndex).toBe(0);
    source.focus();
    // jsdom does not synthesize the native button's default keyboard click.
    // Check the parent leaves the key unconsumed, then deliver that activation.
    expect(fireEvent.keyDown(source, { key: 'Enter' })).toBe(true);
    fireEvent.keyUp(source, { key: 'Enter' });
    fireEvent.click(source, { detail: 0 });
    await within(source.parentElement!).findByRole("status");
    expect(save).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(source);
    expect(screen.getAllByRole("radio")).toEqual(options);
    expect(options.every(option => option.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.queryByText(sampleTest.questions[0]!.explanation)).toBeNull();
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(await db.select("SELECT * FROM practice_attempts")).toEqual(before);
    expect(await db.select("SELECT * FROM practice_responses")).toEqual(responses);

    fireEvent.click(options[1]!);
    await screen.findByText("Correct");
    const savedAttempts = await db.select("SELECT * FROM practice_attempts");
    const savedResponses = await db.select("SELECT * FROM practice_responses");
    save.mockClear();
    source.focus();
    fireEvent.click(source, { detail: 0 });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(source);
    expect(screen.getAllByRole("radio")[1]!.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(sampleTest.questions[0]!.explanation)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(await db.select("SELECT * FROM practice_attempts")).toEqual(savedAttempts);
    expect(await db.select("SELECT * FROM practice_responses")).toEqual(savedResponses);
  });

  it("renders the first question with options in radiogroup", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(screen.getByText(/page 42$/)).toBeTruthy();
    expect(screen.getByText(/standard traffic pattern altitude/)).toBeTruthy();

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toContain("800 feet AGL");
    expect(options[1]?.textContent).toContain("1,000 feet AGL");
    expect(options[2]?.textContent).toContain("1,500 feet AGL");
  });

  it("reveals explanation and marks answer as correct when choosing correct option", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[1]!); // 1,000 feet AGL is correct

    await screen.findByText("Correct");
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));

    // Radio buttons should be disabled once revealed
    for (const opt of screen.getAllByRole("radio")) {
      expect(opt.hasAttribute("disabled")).toBe(true);
    }
  });

  it("reveals explanation and marks answer as incorrect when choosing wrong option", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!); // 800 feet AGL is wrong

    await screen.findByText("Not quite");
    expect(screen.getByText(/Standard pattern altitude is 1,000 feet AGL/)).toBeTruthy();
  });

  it("navigates through questions and calculates final score, allowing retake", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    // Q1: answer correctly
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    await screen.findByText("Correct");
    const cont1 = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(cont1.hasAttribute("disabled")).toBe(false));
    fireEvent.click(cont1);

    // Q2: answer incorrectly
    await screen.findByText("Question 2 of 2");
    expect(screen.getByText("Check source")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("radio")[0]!); // Crosswind is wrong

    await screen.findByText("Not quite");
    const scoreBtn = screen.getByRole("button", { name: "See score" });
    await waitFor(() => expect(scoreBtn.hasAttribute("disabled")).toBe(false));

    // Finish test
    fireEvent.click(scoreBtn);

    await screen.findByText("Practice test complete");
    expect(screen.getByText("1 of 2 correct")).toBeTruthy();

    // Retake
    const retakeButton = screen.getByRole("button", { name: "Retake this test" });
    await waitFor(() => expect(retakeButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retakeButton);

    await screen.findByText("Question 1 of 2");
  });

  it("supports keyboard navigation with arrows, Home, End, Space and Enter", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    // Only one option in tab order initially
    expect(options[0]?.getAttribute("tabindex")).toBe("0");
    expect(options[1]?.getAttribute("tabindex")).toBe("-1");
    expect(options[2]?.getAttribute("tabindex")).toBe("-1");

    // ArrowDown moves focus to option 1
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("tabindex")).toBe("0");
    expect(options[0]?.getAttribute("tabindex")).toBe("-1");

    // ArrowRight moves focus to option 2
    fireEvent.keyDown(options[1]!, { key: "ArrowRight" });
    expect(options[2]?.getAttribute("tabindex")).toBe("0");

    // ArrowDown wraps to option 0
    fireEvent.keyDown(options[2]!, { key: "ArrowDown" });
    expect(options[0]?.getAttribute("tabindex")).toBe("0");

    // ArrowUp wraps to option 2 (last)
    fireEvent.keyDown(options[0]!, { key: "ArrowUp" });
    expect(options[2]?.getAttribute("tabindex")).toBe("0");

    // Home moves to option 0
    fireEvent.keyDown(options[2]!, { key: "Home" });
    expect(options[0]?.getAttribute("tabindex")).toBe("0");

    // End moves to option 2
    fireEvent.keyDown(options[0]!, { key: "End" });
    expect(options[2]?.getAttribute("tabindex")).toBe("0");

    // Move to option 1 (correct answer) and press Enter to select
    fireEvent.keyDown(options[2]!, { key: "ArrowUp" });
    expect(options[1]?.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(options[1]!, { key: "Enter" });

    // Answer should now be revealed and focus moved to Continue
    await screen.findByText("Correct");
    expect(screen.getAllByRole("radio")[1]?.getAttribute("aria-label")).toContain("Correct answer");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);
  });

  it("moves focus to Continue on mouse click, and to the next heading on Continue", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    fireEvent.click(options[0]!);

    await screen.findByText("Not quite");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);

    // Click Continue and verify focus moves to the Question 2 heading
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);
    await screen.findByText("Question 2 of 2");
    const nextOptions = screen.getAllByRole("radio");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Question 2 of 2" }));
    expect(nextOptions[0]?.getAttribute("tabindex")).toBe("0");
  });

  it("moves focus to Continue on Space, and to See score after final question answer selection", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    const options = screen.getAllByRole("radio");
    // Press Space on option 1 (Question 1)
    fireEvent.keyDown(options[1]!, { key: " " });

    await screen.findByText("Correct");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(document.activeElement).toBe(continueBtn);

    // Advance to Question 2 (final question)
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);
    await screen.findByText("Question 2 of 2");
    const q2Options = screen.getAllByRole("radio");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Question 2 of 2" }));

    // Select final question answer with Enter
    fireEvent.keyDown(q2Options[1]!, { key: "Enter" });
    await screen.findByText("Correct");
    const seeScoreBtn = screen.getByRole("button", { name: "See score" });
    expect(document.activeElement).toBe(seeScoreBtn);
  });

  it("moves focus to See score when final question is selected via mouse click or Space", async () => {
    await renderPanel(h(PracticeTestPanel, { practiceTest: sampleTest }));

    // Advance to final question
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await screen.findByText("Not quite");
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(continueBtn);

    // Click final question option
    await screen.findByText("Question 2 of 2");
    const finalOptions = screen.getAllByRole("radio");
    fireEvent.click(finalOptions[0]!);

    await screen.findByText("Not quite");
    const seeScoreBtn = screen.getByRole("button", { name: "See score" });
    expect(document.activeElement).toBe(seeScoreBtn);
  });
});
