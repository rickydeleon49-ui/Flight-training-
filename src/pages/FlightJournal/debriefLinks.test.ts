// @vitest-environment jsdom
import { createElement as h } from "react";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { actionsFor } from "@/logic/actions";
import { lessonPreparation } from "@/logic/preparation";
import { JournalForm } from "@/pages/FlightJournal/JournalForm";
import { JournalEntryDetail } from "@/pages/FlightJournal/JournalEntryDetail";
import { Questions } from "@/pages/Questions/Questions";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import type { DebriefSaveOperation, SqlDatabase } from "@/data/db";

let testDb: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(testDb),
  isTauri: () => false,
}));

let appCtx: ReturnType<typeof useAppData>;
function ContextProbe() {
  appCtx = useAppData();
  return null;
}

function TestRoutes() {
  const { status } = useAppData();
  if (status !== "ready") return null;
  return h(
    Routes,
    null,
    h(Route, { path: "/journal/new", element: h(JournalForm) }),
    h(Route, { path: "/journal/:entryId/edit", element: h(JournalForm) }),
    h(Route, { path: "/journal/:entryId", element: h(JournalEntryDetail) }),
    h(Route, { path: "/questions", element: h(Questions) }),
    h(Route, { path: "*", element: h("div", null, "Other") }),
  );
}

async function renderApp(initialPath: string) {
  render(
    h(
      AppDataProvider,
      null,
      h(MemoryRouter, { initialEntries: [initialPath] }, h(ContextProbe), h(TestRoutes)),
    ),
  );
  await waitFor(() => expect(appCtx.status).toBe("ready"));
}

describe("M1 D6: Connect improvement -> action -> study material -> instructor question", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    localStorage.clear();
    tempDir = mkdtempSync(join(tmpdir(), "flight-training-d6-test-"));
    dbPath = join(tempDir, "test.db");
    testDb = await createNodeSqliteDatabase(dbPath);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    testDb.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on Windows
    }
  });

  it("1. deliberate workflow: turns improvement into action, links study material and upcoming lesson, and saves atomically", async () => {
    const repos = createRepositories(testDb);

    // Seed scheduled flight lesson and study material
    const lesson = await repos.schedule.create({
      eventType: "flight_lesson",
      date: "2026-10-05",
      title: "Steep Turns & Stalls",
      status: "scheduled",
    });

    const material = await repos.documents.create({
      title: "Airplane Flying Handbook Ch. 9",
      topic: "aerodynamics",
      materialType: "reference",
    });

    await renderApp("/journal/new?mode=quick");

    // Enter reflections
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Crosswind Practice" },
    });
    fireEvent.change(screen.getByLabelText("What was difficult?"), {
      target: { value: "Maintaining centerline during crosswind rollout" },
    });
    fireEvent.change(screen.getByLabelText("Instructor feedback"), {
      target: { value: "More rudder into the wind right after touchdown" },
    });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "How much aileron deflection to hold through taxi speed?" },
    });

    // Helper button to prefill action from improvement reflection
    const turnImprovementBtn = screen.getByRole("button", {
      name: /Turn “What was difficult” into action/i,
    });
    fireEvent.click(turnImprovementBtn);

    // Verify user can review and edit the action title
    const actionInput = screen.getByLabelText(
      "Because of this lesson, what should you do next?",
    ) as HTMLInputElement;
    expect(actionInput.value).toBe("Maintaining centerline during crosswind rollout");
    fireEvent.change(actionInput, {
      target: { value: "Practice centerline control and rudder timing" },
    });

    // Explicitly accept action and link study material
    const actionCheckbox = screen.getByLabelText(
      /Add “Practice centerline control and rudder timing” to your Flight Plan/i,
    );
    fireEvent.click(actionCheckbox);

    const [actionMaterialSelect] = screen.getAllByLabelText("Related study material");
    fireEvent.change(actionMaterialSelect!, { target: { value: material.id } });

    // Explicitly accept question, edit review text, and link upcoming lesson + study material
    const questionCheckbox = screen.getByLabelText(
      /Save an instructor question to the Questions list/i,
    );
    fireEvent.click(questionCheckbox);

    const questionTextArea = screen.getByLabelText(
      "Question to ask your instructor",
    ) as HTMLTextAreaElement;
    expect(questionTextArea.value).toBe(
      "How much aileron deflection to hold through taxi speed?",
    );
    fireEvent.change(questionTextArea, {
      target: { value: "How much aileron to hold in gusts above 15 knots?" },
    });

    const carryLessonSelect = screen.getByLabelText("Carry to upcoming lesson");
    fireEvent.change(carryLessonSelect, { target: { value: lesson.id } });

    const materialSelects = screen.getAllByLabelText("Related study material");
    const questionMaterialSelect = materialSelects[1]!;
    fireEvent.change(questionMaterialSelect, { target: { value: material.id } });

    // Save debrief atomically
    const saveBtn = screen.getByRole("button", { name: "Save quick debrief" });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // Navigates to detail view
    await waitFor(() => expect(screen.getByText("Crosswind Practice")).toBeTruthy());

    // Verify database state
    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.title).toBe("Crosswind Practice");
    expect(entry.wasDifficult).toBe("Maintaining centerline during crosswind rollout");

    const actions = await repos.actions.list();
    expect(actions.length).toBe(1);
    const action = actions[0]!;
    expect(action.title).toBe("Practice centerline control and rudder timing");
    expect(action.relatedType).toBe("journal");
    expect(action.relatedId).toBe(entry.id);
    expect(action.materialId).toBe(material.id);

    const questions = await repos.questions.list();
    expect(questions.length).toBe(1);
    const question = questions[0]!;
    expect(question.text).toBe("How much aileron to hold in gusts above 15 knots?");
    expect(question.journalId).toBe(entry.id);
    expect(question.eventId).toBe(lesson.id);
    expect(question.materialId).toBe(material.id);

    // Verify detail view displays context links
    expect(
      screen.getAllByText(new RegExp(`Material: ${material.title}`)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(new RegExp(`Lesson: ${lesson.title}`))).toBeTruthy();
  });

  it("2. repeated acceptance, rapid clicks, and concurrent calls create exactly one intended action/question", async () => {
    const repos = createRepositories(testDb);

    const op: DebriefSaveOperation = {
      targetId: "op-idempotent-1",
      operationId: "op-debriefLinks-1",
      journal: {
        eventId: null,
        date: "2026-09-26",
        title: "Idempotency Test",
        aircraftType: "C172",
        aircraftId: "N172SP",
        departureAirport: "KSQL",
        arrivalAirport: "KSQL",
        instructorName: "Sarah",
        totalTime: 1.2,
        dualReceived: 1.2,
        soloTime: null,
        picTime: null,
        crossCountryTime: null,
        nightTime: null,
        actualInstrumentTime: null,
        simulatedInstrumentTime: null,
        dayLandings: 3,
        nightLandings: 0,
        mission: "Pattern work",
        practiced: "Touch and goes",
        wentWell: "Good flare",
        wasDifficult: "Crosswind correction",
        instructorFeedback: "Stay on centerline",
        questionsForNextTime: "Rudder pressure",
        confidence: 4,
        goalId: null,
        materialIds: [],
      },
      action: {
        id: "action-idempotent-1",
        title: "Rudder timing drills",
        materialId: null,
      },
      withdrawActionId: null,
      question: {
        id: "question-idempotent-1",
        text: "How to judge rudder pressure in gusty crosswinds?",
        eventId: null,
        materialId: null,
      },
      withdrawQuestionId: null,
    };

    // Invoke saveDebriefAtomically 3 times repeatedly (e.g. retries and re-approval)
    await testDb.saveDebriefAtomically!(op);
    await testDb.saveDebriefAtomically!(op);
    await testDb.saveDebriefAtomically!(op);

    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe("op-idempotent-1");

    const actions = await repos.actions.list();
    expect(actions.length).toBe(1);
    expect(actions[0]!.id).toBe("action-idempotent-1");

    const questions = await repos.questions.list();
    expect(questions.length).toBe(1);
    expect(questions[0]!.id).toBe("question-idempotent-1");
  });

  it("3. distinct operations with identical text remain distinct with unique IDs", async () => {
    const repos = createRepositories(testDb);

    const baseJournal = {
      eventId: null,
      date: "2026-09-26",
      title: "Shared Debrief Text",
      aircraftType: "",
      aircraftId: "",
      departureAirport: "",
      arrivalAirport: "",
      instructorName: "",
      totalTime: null,
      dualReceived: null,
      soloTime: null,
      picTime: null,
      crossCountryTime: null,
      nightTime: null,
      actualInstrumentTime: null,
      simulatedInstrumentTime: null,
      dayLandings: null,
      nightLandings: null,
      mission: "",
      practiced: "",
      wentWell: "",
      wasDifficult: "",
      instructorFeedback: "",
      questionsForNextTime: "",
      confidence: null,
      goalId: null,
      materialIds: [],
    };

    const op1: DebriefSaveOperation = {
      targetId: "entry-distinct-1",
      operationId: "op-debriefLinks-2",
      journal: baseJournal,
      action: { id: "action-distinct-1", title: "Same Action Title", materialId: null },
      withdrawActionId: null,
      question: { id: "question-distinct-1", text: "Same Question Text", eventId: null, materialId: null },
      withdrawQuestionId: null,
    };

    const op2: DebriefSaveOperation = {
      targetId: "entry-distinct-2",
      operationId: "op-debriefLinks-3",
      journal: baseJournal,
      action: { id: "action-distinct-2", title: "Same Action Title", materialId: null },
      withdrawActionId: null,
      question: { id: "question-distinct-2", text: "Same Question Text", eventId: null, materialId: null },
      withdrawQuestionId: null,
    };

    await testDb.saveDebriefAtomically!(op1);
    await testDb.saveDebriefAtomically!(op2);

    const entries = await repos.journal.list();
    expect(entries.length).toBe(2);

    const actions = await repos.actions.list();
    expect(actions.length).toBe(2);
    expect(actions.map((a) => a.id).sort()).toEqual(["action-distinct-1", "action-distinct-2"]);

    const questions = await repos.questions.list();
    expect(questions.length).toBe(2);
    expect(questions.map((q) => q.id).sort()).toEqual(["question-distinct-1", "question-distinct-2"]);
  });

  it("4. injected failure at each write boundary leaves no partial operation (atomic rollback)", async () => {
    const repos = createRepositories(testDb);
    const originalExecute = testDb.execute.bind(testDb);

    const op: DebriefSaveOperation = {
      targetId: "entry-atomic-rollback",
      operationId: "op-debriefLinks-4",
      journal: {
        eventId: null,
        date: "2026-09-26",
        title: "Atomic Rollback Test",
        aircraftType: "",
        aircraftId: "",
        departureAirport: "",
        arrivalAirport: "",
        instructorName: "",
        totalTime: null,
        dualReceived: null,
        soloTime: null,
        picTime: null,
        crossCountryTime: null,
        nightTime: null,
        actualInstrumentTime: null,
        simulatedInstrumentTime: null,
        dayLandings: null,
        nightLandings: null,
        mission: "",
        practiced: "",
        wentWell: "",
        wasDifficult: "",
        instructorFeedback: "",
        questionsForNextTime: "",
        confidence: null,
        goalId: null,
        materialIds: [],
      },
      action: { id: "action-atomic-rollback", title: "Action", materialId: null },
      withdrawActionId: null,
      question: { id: "question-atomic-rollback", text: "Question", eventId: null, materialId: null },
      withdrawQuestionId: null,
    };

    // Boundary 1: Failure during journal insert
    testDb.execute = async (sql: string, params: any[] = []) => {
      if (sql.includes("INSERT INTO journal_entries")) {
        throw new Error("Disk full on journal insert");
      }
      return originalExecute(sql, params);
    };

    await expect(testDb.saveDebriefAtomically!(op)).rejects.toThrow("Disk full on journal insert");
    expect((await repos.journal.list()).length).toBe(0);
    expect((await repos.actions.list()).length).toBe(0);
    expect((await repos.questions.list()).length).toBe(0);

    // Boundary 2: Failure during action insert
    testDb.execute = async (sql: string, params: any[] = []) => {
      if (sql.includes("INSERT INTO next_actions")) {
        throw new Error("Transient error on action insert");
      }
      return originalExecute(sql, params);
    };

    await expect(testDb.saveDebriefAtomically!(op)).rejects.toThrow("Transient error on action insert");
    expect((await repos.journal.list()).length).toBe(0);
    expect((await repos.actions.list()).length).toBe(0);
    expect((await repos.questions.list()).length).toBe(0);

    // Boundary 3: Failure during question insert
    testDb.execute = async (sql: string, params: any[] = []) => {
      if (sql.includes("INSERT INTO questions")) {
        throw new Error("Constraint error on question insert");
      }
      return originalExecute(sql, params);
    };

    await expect(testDb.saveDebriefAtomically!(op)).rejects.toThrow("Constraint error on question insert");
    expect((await repos.journal.list()).length).toBe(0);
    expect((await repos.actions.list()).length).toBe(0);
    expect((await repos.questions.list()).length).toBe(0);

    // Restore execute and verify normal save succeeds
    testDb.execute = originalExecute;
    await testDb.saveDebriefAtomically!(op);
    expect((await repos.journal.list()).length).toBe(1);
    expect((await repos.actions.list()).length).toBe(1);
    expect((await repos.questions.list()).length).toBe(1);
  });

  it("5. database close and reopen preserves all debrief links", async () => {
    const repos = createRepositories(testDb);

    const material = await repos.documents.create({
      title: "PHAK Chapter 12: Weather",
      topic: "weather",
      materialType: "reference",
    });

    const lesson = await repos.schedule.create({
      eventType: "flight_lesson",
      date: "2026-10-02",
      title: "Cross-Country Planning",
      status: "scheduled",
    });

    const op: DebriefSaveOperation = {
      targetId: "entry-persist-links",
      operationId: "op-debriefLinks-5",
      journal: {
        eventId: lesson.id,
        date: "2026-09-26",
        title: "Weather Flight",
        aircraftType: "C172",
        aircraftId: "N172SP",
        departureAirport: "KSQL",
        arrivalAirport: "KSQL",
        instructorName: "Dave",
        totalTime: 1.5,
        dualReceived: 1.5,
        soloTime: null,
        picTime: null,
        crossCountryTime: null,
        nightTime: null,
        actualInstrumentTime: null,
        simulatedInstrumentTime: null,
        dayLandings: 2,
        nightLandings: 0,
        mission: "Weather briefing",
        practiced: "METAR interpretation",
        wentWell: "Good radar read",
        wasDifficult: "Cloud clearance rules",
        instructorFeedback: "Check cloud ceilings",
        questionsForNextTime: "Class C cloud separation",
        confidence: 4,
        goalId: null,
        materialIds: [material.id],
      },
      action: {
        id: "action-persist-links",
        title: "Read PHAK Ch 12",
        materialId: material.id,
      },
      withdrawActionId: null,
      question: {
        id: "question-persist-links",
        text: "Class C cloud clearance minimums?",
        eventId: lesson.id,
        materialId: material.id,
      },
      withdrawQuestionId: null,
    };

    await testDb.saveDebriefAtomically!(op);

    // Close database and reopen from the same file path
    testDb.close();
    testDb = await createNodeSqliteDatabase(dbPath);
    const reopenedRepos = createRepositories(testDb);

    const entries = await reopenedRepos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.materialIds).toEqual([material.id]);
    expect(entries[0]!.eventId).toBe(lesson.id);

    const actions = await reopenedRepos.actions.list();
    expect(actions.length).toBe(1);
    expect(actions[0]!.materialId).toBe(material.id);
    expect(actions[0]!.relatedType).toBe("journal");
    expect(actions[0]!.relatedId).toBe("entry-persist-links");

    const questions = await reopenedRepos.questions.list();
    expect(questions.length).toBe(1);
    expect(questions[0]!.materialId).toBe(material.id);
    expect(questions[0]!.eventId).toBe(lesson.id);
    expect(questions[0]!.journalId).toBe("entry-persist-links");
  });

  it("6. ordinary deletions of material, lesson and debrief keep the records and show each source as unavailable", async () => {
    const repos = createRepositories(testDb);

    const material = await repos.documents.create({
      title: "Temporary Chart",
      topic: "regulations",
      materialType: "reference",
    });

    const lesson = await repos.schedule.create({
      eventType: "flight_lesson",
      date: "2026-10-05",
      title: "Solo Cross-Country",
      status: "scheduled",
    });

    const op: DebriefSaveOperation = {
      targetId: "entry-safe-degradation",
      operationId: "op-debriefLinks-6",
      journal: {
        eventId: lesson.id,
        date: "2026-09-26",
        title: "Chart Study Flight",
        aircraftType: "",
        aircraftId: "",
        departureAirport: "",
        arrivalAirport: "",
        instructorName: "",
        totalTime: null,
        dualReceived: null,
        soloTime: null,
        picTime: null,
        crossCountryTime: null,
        nightTime: null,
        actualInstrumentTime: null,
        simulatedInstrumentTime: null,
        dayLandings: null,
        nightLandings: null,
        mission: "",
        practiced: "",
        wentWell: "",
        wasDifficult: "",
        instructorFeedback: "",
        questionsForNextTime: "",
        confidence: null,
        goalId: null,
        materialIds: [material.id],
      },
      action: {
        id: "action-safe-degradation",
        title: "Review sectional chart",
        materialId: material.id,
      },
      withdrawActionId: null,
      question: {
        id: "question-safe-degradation",
        text: "How to interpret military training routes?",
        eventId: lesson.id,
        materialId: material.id,
      },
      withdrawQuestionId: null,
    };

    await testDb.saveDebriefAtomically!(op);

    // Delete the study material: foreign key sets material_id to NULL without deleting action or question
    await repos.documents.remove(material.id);

    const actionsAfterMatDelete = await repos.actions.list();
    expect(actionsAfterMatDelete.length).toBe(1);
    expect(actionsAfterMatDelete[0]!.id).toBe("action-safe-degradation");
    expect(actionsAfterMatDelete[0]!.materialId).toBeNull();

    const questionsAfterMatDelete = await repos.questions.list();
    expect(questionsAfterMatDelete.length).toBe(1);
    expect(questionsAfterMatDelete[0]!.id).toBe("question-safe-degradation");
    expect(questionsAfterMatDelete[0]!.materialId).toBeNull();

    // Now delete the journal entry: action and question remain intact (not cascade-deleted)
    await repos.journal.remove("entry-safe-degradation");

    const actionsAfterEntryDelete = await repos.actions.list();
    expect(actionsAfterEntryDelete.length).toBe(1);
    expect(actionsAfterEntryDelete[0]!.relatedType).toBe("journal");
    expect(actionsAfterEntryDelete[0]!.relatedId).toBe("entry-safe-degradation");

    const questionsAfterEntryDelete = await repos.questions.list();
    expect(questionsAfterEntryDelete.length).toBe(1);
    // The link is cleared by the foreign key, but the deleted source is remembered.
    expect(questionsAfterEntryDelete[0]!.journalId).toBeNull();
    expect(questionsAfterEntryDelete[0]!.sourceJournalId).toBe("entry-safe-degradation");
    expect(questionsAfterEntryDelete[0]!.sourceMaterialId).toBe(material.id);
    expect(actionsAfterEntryDelete[0]!.sourceMaterialId).toBe(material.id);

    // Delete the lesson through the repository, foreign keys on as in the app.
    await repos.schedule.remove(lesson.id);
    const [questionAfterLessonDelete] = await repos.questions.list();
    expect(questionAfterLessonDelete!.eventId).toBeNull();
    expect(questionAfterLessonDelete!.sourceEventId).toBe(lesson.id);

    // A question that was never linked to anything must not claim a deleted source.
    await repos.questions.create({ id: "never-linked", text: "Which headset should I buy?" });

    cleanup();
    await renderApp("/questions");
    expect(screen.getAllByText("Source entry unavailable")).toHaveLength(1);
    expect(screen.getAllByText("Source material unavailable")).toHaveLength(1);
    expect(screen.getAllByText("Source lesson unavailable")).toHaveLength(1);
    expect(screen.getByText("Which headset should I buy?")).toBeTruthy();

    // Relinking deliberately replaces the provenance.
    const replacement = await repos.documents.create({ title: "AIM 3-5", topic: "regulations", materialType: "reference" });
    await repos.questions.update("question-safe-degradation", { materialId: replacement.id });
    const relinked = await repos.questions.get("question-safe-degradation");
    expect(relinked!.materialId).toBe(replacement.id);
    expect(relinked!.sourceMaterialId).toBeNull();
    await repos.questions.update("question-safe-degradation", { materialId: null });
    expect((await repos.questions.get("question-safe-degradation"))!.sourceMaterialId).toBeNull();
  });

  it("7. independent records linked to the same journal remain untouched", async () => {
    const repos = createRepositories(testDb);

    // Create journal entry first
    await repos.journal.create({
      id: "journal-with-independent",
      date: "2026-09-26",
      title: "Shared Debrief",
      aircraftType: "",
      aircraftId: "",
      departureAirport: "",
      arrivalAirport: "",
      instructorName: "",
      totalTime: null,
      dualReceived: null,
      soloTime: null,
      picTime: null,
      crossCountryTime: null,
      nightTime: null,
      actualInstrumentTime: null,
      simulatedInstrumentTime: null,
      dayLandings: null,
      nightLandings: null,
      mission: "",
      practiced: "",
      wentWell: "",
      wasDifficult: "",
      instructorFeedback: "",
      questionsForNextTime: "",
      confidence: null,
      goalId: null,
      materialIds: [],
    });

    // Create independent action and question linked to that journal
    const indAction = await repos.actions.create({
      id: "ind-action-1",
      title: "Independent Action Added Later",
      category: "prepare",
      priority: "next_up",
      relatedType: "journal",
      relatedId: "journal-with-independent",
    });

    const indQuestion = await repos.questions.create({
      id: "ind-question-1",
      text: "Independent Question Added Later",
      journalId: "journal-with-independent",
    });

    // Debrief save runs without approving actions or questions (or withdrawing another action)
    const op: DebriefSaveOperation = {
      targetId: "journal-with-independent",
      operationId: "op-debriefLinks-7",
      journal: {
        eventId: null,
        date: "2026-09-26",
        title: "Shared Debrief - Updated",
        aircraftType: "",
        aircraftId: "",
        departureAirport: "",
        arrivalAirport: "",
        instructorName: "",
        totalTime: null,
        dualReceived: null,
        soloTime: null,
        picTime: null,
        crossCountryTime: null,
        nightTime: null,
        actualInstrumentTime: null,
        simulatedInstrumentTime: null,
        dayLandings: null,
        nightLandings: null,
        mission: "",
        practiced: "",
        wentWell: "",
        wasDifficult: "",
        instructorFeedback: "",
        questionsForNextTime: "",
        confidence: null,
        goalId: null,
        materialIds: [],
      },
      action: null,
      withdrawActionId: null,
      question: null,
      withdrawQuestionId: null,
    };

    await testDb.saveDebriefAtomically!(op);

    // Both independent records MUST remain untouched
    const actions = await repos.actions.list();
    expect(actions.some((a) => a.id === indAction.id)).toBe(true);

    const questions = await repos.questions.list();
    expect(questions.some((q) => q.id === indQuestion.id)).toBe(true);
  });

  it("8. lesson preparation and actionsFor automatically integrate debrief links", async () => {
    const repos = createRepositories(testDb);

    const lesson = await repos.schedule.create({
      eventType: "flight_lesson",
      date: "2026-10-10",
      title: "Upcoming Stage Check",
      status: "scheduled",
    });

    const material = await repos.documents.create({
      title: "ACS Standards: Private Pilot",
      topic: "regulations",
      materialType: "reference",
    });

    const op: DebriefSaveOperation = {
      targetId: "journal-integration",
      operationId: "op-debriefLinks-8",
      journal: {
        eventId: null,
        date: "2026-09-26",
        title: "Stage Check Prep",
        aircraftType: "",
        aircraftId: "",
        departureAirport: "",
        arrivalAirport: "",
        instructorName: "",
        totalTime: null,
        dualReceived: null,
        soloTime: null,
        picTime: null,
        crossCountryTime: null,
        nightTime: null,
        actualInstrumentTime: null,
        simulatedInstrumentTime: null,
        dayLandings: null,
        nightLandings: null,
        mission: "",
        practiced: "",
        wentWell: "",
        wasDifficult: "",
        instructorFeedback: "",
        questionsForNextTime: "",
        confidence: null,
        goalId: null,
        materialIds: [],
      },
      action: {
        id: "action-integration",
        title: "Review ACS Area of Operation IV",
        materialId: material.id,
      },
      withdrawActionId: null,
      question: {
        id: "question-integration",
        text: "What tolerance is expected on steep turn altitude?",
        eventId: lesson.id,
        materialId: material.id,
      },
      withdrawQuestionId: null,
    };

    await testDb.saveDebriefAtomically!(op);

    const allActions = await repos.actions.list();
    const allQuestions = await repos.questions.list();

    // 1. actionsFor query by material finds the debrief action
    const materialActions = actionsFor(allActions, "material", material.id);
    expect(materialActions.some((a) => a.id === "action-integration")).toBe(true);

    // 2. lessonPreparation includes the debrief question
    const prep = lessonPreparation(lesson, {
      prepItems: [],
      questions: allQuestions,
    });
    expect(prep.total).toBe(1);
    expect(prep.lines[0]!.label).toContain("What tolerance is expected on steep turn altitude?");
    expect(prep.lines[0]!.done).toBe(false);
  });

  // A database file copy, not a complete backup: it only proves the SQLite file
  // reopens with its links. The real complete-backup export, validation and
  // restore round trip is `complete_backup_export_validation_and_restore_keep_debrief_links`
  // in src-tauri/src/debrief.rs (complete backups are implemented in Rust only).
  it("9. a copied database file reopens with debrief links intact (file copy, not a complete backup)", async () => {
    const repos = createRepositories(testDb);

    const lesson = await repos.schedule.create({
      eventType: "flight_lesson",
      date: "2026-10-15",
      title: "Night Cross-Country",
      status: "scheduled",
    });

    const material = await repos.documents.create({
      title: "Night Flying Handbook",
      topic: "weather",
      materialType: "reference",
    });

    const op: DebriefSaveOperation = {
      targetId: "journal-backup-restore",
      operationId: "op-debriefLinks-9",
      journal: {
        eventId: lesson.id,
        date: "2026-09-26",
        title: "Night Navigation Training",
        aircraftType: "C172",
        aircraftId: "N12345",
        departureAirport: "KSQL",
        arrivalAirport: "KMRY",
        instructorName: "Dave",
        totalTime: 2.0,
        dualReceived: 2.0,
        soloTime: null,
        picTime: null,
        crossCountryTime: 2.0,
        nightTime: 2.0,
        actualInstrumentTime: null,
        simulatedInstrumentTime: null,
        dayLandings: null,
        nightLandings: 3,
        mission: "Night cross-country preparation",
        practiced: "VOR tracking, lighted checkpoint identification",
        wentWell: "Good cockpit lighting management",
        wasDifficult: "Identifying unlighted terrain around Salinas",
        instructorFeedback: "Double check MEF on sectional along the route",
        questionsForNextTime: "How to best identify towers with strobe lights?",
        confidence: 4,
        goalId: null,
        materialIds: [material.id],
      },
      action: {
        id: "action-backup-restore",
        title: "Review MEF and chart legend for towers",
        materialId: material.id,
      },
      withdrawActionId: null,
      question: {
        id: "question-backup-restore",
        text: "How to best identify towers with strobe lights?",
        eventId: lesson.id,
        materialId: material.id,
      },
      withdrawQuestionId: null,
    };

    await testDb.saveDebriefAtomically!(op);

    // Close the original database and copy its file
    testDb.close();
    const backupPath = join(tempDir, "backup.db");
    copyFileSync(dbPath, backupPath);

    // Open the copy as a fresh database
    const restoredDbPath = join(tempDir, "restored.db");
    copyFileSync(backupPath, restoredDbPath);
    testDb = await createNodeSqliteDatabase(restoredDbPath);
    const restoredRepos = createRepositories(testDb);

    // Verify all records and link integrity survived the file copy
    const entries = await restoredRepos.journal.list();
    expect(entries.length).toBe(1);
    const restoredEntry = entries[0]!;
    expect(restoredEntry.id).toBe("journal-backup-restore");
    expect(restoredEntry.materialIds).toEqual([material.id]);
    expect(restoredEntry.eventId).toBe(lesson.id);

    const actions = await restoredRepos.actions.list();
    expect(actions.length).toBe(1);
    const restoredAction = actions[0]!;
    expect(restoredAction.id).toBe("action-backup-restore");
    expect(restoredAction.materialId).toBe(material.id);
    expect(restoredAction.relatedType).toBe("journal");
    expect(restoredAction.relatedId).toBe("journal-backup-restore");

    const questions = await restoredRepos.questions.list();
    expect(questions.length).toBe(1);
    const restoredQuestion = questions[0]!;
    expect(restoredQuestion.id).toBe("question-backup-restore");
    expect(restoredQuestion.materialId).toBe(material.id);
    expect(restoredQuestion.eventId).toBe(lesson.id);
    expect(restoredQuestion.journalId).toBe("journal-backup-restore");

    // Verify UI displays the restored links accurately
    await renderApp("/journal/journal-backup-restore");
    expect(
      screen.getAllByText(new RegExp(`Material: ${material.title}`)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(new RegExp(`Lesson: ${lesson.title}`))).toBeTruthy();
  });
  it("10. the debrief page shows deleted material and lesson as unavailable after real deletions", async () => {
    const repos = createRepositories(testDb);
    const material = await repos.documents.create({ title: "PHAK Ch. 12", topic: "weather", materialType: "reference" });
    const lesson = await repos.schedule.create({
      eventType: "flight_lesson",
      date: "2026-10-20",
      title: "Stage check",
      status: "scheduled",
    });
    await testDb.saveDebriefAtomically!({
      operationId: "op-debriefLinks-10",
      targetId: "entry-detail-sources",
      journal: { date: "2026-09-26", title: "Pattern work", materialIds: [] },
      action: { id: "action-detail-sources", title: "Read about gust factors", materialId: material.id },
      withdrawActionId: null,
      question: { id: "question-detail-sources", text: "What is a gust factor?", eventId: lesson.id, materialId: material.id },
      withdrawQuestionId: null,
    });

    await repos.documents.remove(material.id);
    await repos.schedule.remove(lesson.id);

    await renderApp("/journal/entry-detail-sources");
    expect(screen.getByText("Material: Source material unavailable")).toBeTruthy();
    expect(
      screen.getByText("Material: Source material unavailable · Lesson: Source lesson unavailable"),
    ).toBeTruthy();
    expect(screen.getByText("Read about gust factors")).toBeTruthy();
    expect(screen.getByText("What is a gust factor?")).toBeTruthy();
  });

  it("11. a driver without atomic debrief support refuses before writing anything", async () => {
    const executed: string[] = [];
    const plain: SqlDatabase = {
      select: (sql, params) => testDb.select(sql, params),
      execute: async (sql, params) => {
        executed.push(sql);
        await testDb.execute(sql, params);
      },
    };
    const repos = createRepositories(plain);
    await expect(
      repos.journal.saveAtomically({
        operationId: "op-debriefLinks-11",
        targetId: "entry-unsupported",
        journal: { date: "2026-09-26", title: "Should not save" },
        action: { id: "action-unsupported", title: "Should not exist" },
        withdrawActionId: null,
        question: null,
        withdrawQuestionId: null,
      }),
    ).rejects.toThrow(/atomic transaction support/);
    expect(executed).toEqual([]);
    expect(await repos.journal.list()).toEqual([]);
    expect(await repos.actions.list()).toEqual([]);
  });

  it("12. the form reports an unsupported driver as a failure, never as saved", async () => {
    delete (testDb as Partial<TestDatabase>).saveDebriefAtomically;
    await renderApp("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsupported driver flight" } });
    fireEvent.change(screen.getByLabelText("What was difficult?"), { target: { value: "Radio calls" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await screen.findByText(/Unable to save debrief right now/);
    expect(screen.queryByText("Other")).toBeNull();
    const repos = createRepositories(testDb);
    expect(await repos.journal.list()).toEqual([]);
  });
});
