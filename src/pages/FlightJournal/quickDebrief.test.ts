// @vitest-environment jsdom
import { createElement as h } from "react";
import { mkdtempSync, rmSync } from "node:fs";
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
import { JournalForm } from "@/pages/FlightJournal/JournalForm";
import { readDraft, writeDraft } from "@/lib/drafts";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

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
    h(Route, { path: "/journal/:entryId", element: h("div", { "data-testid": "entry-detail" }, "Detail") }),
    h(Route, { path: "*", element: h("div", null, "Other") }),
  );
}

async function renderJournalForm(initialPath: string) {
  render(
    h(
      AppDataProvider,
      null,
      h(MemoryRouter, { initialEntries: [initialPath] }, h(ContextProbe), h(TestRoutes)),
    ),
  );
  await waitFor(() => expect(appCtx.status).toBe("ready"));
}

describe("M1 D5: Quick debrief mode in existing journal flow", () => {
  let tempDir: string;
  let dbFile: string;

  beforeEach(async () => {
    localStorage.clear();
    tempDir = mkdtempSync(join(tmpdir(), "flight-deck-d5-"));
    dbFile = join(tempDir, "quick-debrief.db");
    testDb = await createNodeSqliteDatabase(dbFile);
  });

  afterEach(() => {
    cleanup();
    try {
      testDb.close();
    } catch {
      // Best effort
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    vi.restoreAllMocks();
  });

  it("creates a quick debrief with reflections, confidence, and deliberate action and question, persisting to real SQLite", async () => {
    const repos = createRepositories(testDb);

    const lesson = await repos.schedule.create({
      title: "Pattern Work & Landings",
      eventType: "flight_lesson",
      date: "2026-09-26",
      instructor: "CFI Dave",
      status: "completed",
    });

    await renderJournalForm(`/journal/new?event=${lesson.id}&mode=quick`);

    expect(screen.getByRole("heading", { level: 1, name: "Quick debrief" })).toBeTruthy();
    expect(screen.queryByLabelText("Total flight time")).toBeNull();
    expect(screen.queryByLabelText("Aircraft type / model")).toBeNull();

    // Fill in quick reflection
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Crosswind corrections on final were solid." },
    });
    fireEvent.change(screen.getByLabelText("What was difficult?"), {
      target: { value: "Judging the roundout height on runway 31." },
    });
    fireEvent.change(screen.getByLabelText("Instructor feedback"), {
      target: { value: "Look further down the runway during the flare." },
    });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "How do I transition sight picture when transitioning to dusk?" },
    });

    // Select confidence rating 4
    fireEvent.click(screen.getByRole("button", { name: "4" }));

    // Deliberate review: action
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Practice flare sight picture chair flying" },
    });
    fireEvent.click(
      screen.getByLabelText(/Add “Practice flare sight picture chair flying” to your Flight Plan/i),
    );

    // Deliberate review: question acceptance and text edit
    fireEvent.click(
      screen.getByLabelText(/Save an instructor question to the Questions list/i),
    );
    const questionInput = screen.getByLabelText("Question to ask your instructor");
    fireEvent.change(questionInput, {
      target: { value: "What visual references help judge flare height at dusk?" },
    });

    // Save quick debrief
    const saveButton = screen.getByRole("button", { name: "Save quick debrief" });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    // Verify navigation to detail
    await waitFor(() => {
      expect(screen.getByTestId("entry-detail")).toBeTruthy();
    });

    // Verify database records
    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Missing entry");

    expect(entry.eventId).toBe(lesson.id);
    expect(entry.wentWell).toBe("Crosswind corrections on final were solid.");
    expect(entry.wasDifficult).toBe("Judging the roundout height on runway 31.");
    expect(entry.instructorFeedback).toBe("Look further down the runway during the flare.");
    expect(entry.confidence).toBe(4);
    expect(entry.totalTime).toBeNull();
    expect(entry.aircraftId).toBe("");

    // Verify linked action and question created deliberately
    const actions = await repos.actions.list();
    const debriefAction = actions.find((a) => a.relatedId === entry.id);
    expect(debriefAction).toBeDefined();
    expect(debriefAction?.title).toBe("Practice flare sight picture chair flying");
    expect(debriefAction?.category).toBe("prepare");

    const questions = await repos.questions.list();
    const debriefQuestion = questions.find((q) => q.journalId === entry.id);
    expect(debriefQuestion).toBeDefined();
    expect(debriefQuestion?.text).toBe("What visual references help judge flare height at dusk?");
  });

  it("strictly preserves all hidden fields when editing an existing entry in quick debrief mode", async () => {
    const repos = createRepositories(testDb);

    const goal = await repos.goals.create({
      title: "Private Pilot Certificate",
      status: "working_on",
    });

    // Create an existing comprehensive flight record
    const existing = await repos.journal.create({
      date: "2026-09-20",
      title: "Night Cross Country",
      aircraftType: "Piper Archer III",
      aircraftId: "N41829",
      departureAirport: "KPAO",
      arrivalAirport: "KMRY",
      instructorName: "Captain Lewis",
      totalTime: 2.4,
      dualReceived: 2.4,
      soloTime: 0.0,
      picTime: 0.0,
      crossCountryTime: 2.4,
      nightTime: 1.5,
      actualInstrumentTime: 0.3,
      simulatedInstrumentTime: 0.8,
      dayLandings: 1,
      nightLandings: 3,
      mission: "Dual night cross country to Monterey",
      practiced: "Flight plan diversion, pilot controlled lighting",
      wentWell: "Good navigation using VOR and pilotage",
      wasDifficult: "Cockpit lighting management",
      instructorFeedback: "Good situational awareness",
      questionsForNextTime: "Review alternate airport minimums",
      confidence: 3,
      goalId: goal.id,
    });

    // Open existing entry in quick debrief mode
    await renderJournalForm(`/journal/${existing.id}/edit?mode=quick`);

    expect(screen.getByRole("heading", { level: 1, name: /Quick debrief/i })).toBeTruthy();
    // Unexposed flight time and aircraft fields should NOT be in the quick editor form
    expect(screen.queryByLabelText("Total flight time")).toBeNull();
    expect(screen.queryByLabelText("Aircraft type / model")).toBeNull();
    expect(screen.queryByLabelText("Tail number / identifier")).toBeNull();
    expect(screen.queryByLabelText("Departure airport")).toBeNull();
    expect(screen.queryByLabelText("Today's mission")).toBeNull();

    // Edit only quick debrief fields
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Updated: Excellent diversion calculation and fuel management." },
    });
    fireEvent.change(screen.getByLabelText("Instructor feedback"), {
      target: { value: "Updated: Very smooth radio calls at non-towered field." },
    });
    fireEvent.click(screen.getByRole("button", { name: "5" })); // Change confidence to 5

    // Save changes
    const saveButton = screen.getByRole("button", { name: "Save changes" });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId("entry-detail")).toBeTruthy();
    });

    // Verify in SQLite that EVERY single unexposed field was preserved verbatim
    const entries = await repos.journal.list();
    const updated = entries.find((e) => e.id === existing.id);
    expect(updated).toBeDefined();

    // Modified fields:
    expect(updated?.wentWell).toBe(
      "Updated: Excellent diversion calculation and fuel management.",
    );
    expect(updated?.instructorFeedback).toBe(
      "Updated: Very smooth radio calls at non-towered field.",
    );
    expect(updated?.confidence).toBe(5);

    // Preserved hidden fields (must not be reset to null, default, or empty):
    expect(updated?.aircraftType).toBe("Piper Archer III");
    expect(updated?.aircraftId).toBe("N41829");
    expect(updated?.departureAirport).toBe("KPAO");
    expect(updated?.arrivalAirport).toBe("KMRY");
    expect(updated?.instructorName).toBe("Captain Lewis");
    expect(updated?.totalTime).toBe(2.4);
    expect(updated?.dualReceived).toBe(2.4);
    expect(updated?.soloTime).toBe(0.0);
    expect(updated?.picTime).toBe(0.0);
    expect(updated?.crossCountryTime).toBe(2.4);
    expect(updated?.nightTime).toBe(1.5);
    expect(updated?.actualInstrumentTime).toBe(0.3);
    expect(updated?.simulatedInstrumentTime).toBe(0.8);
    expect(updated?.dayLandings).toBe(1);
    expect(updated?.nightLandings).toBe(3);
    expect(updated?.mission).toBe("Dual night cross country to Monterey");
    expect(updated?.practiced).toBe("Flight plan diversion, pilot controlled lighting");
    expect(updated?.goalId).toBe(goal.id);
  });

  it("supports full round trips: quick debrief save -> full editor update -> quick editor edit", async () => {
    const repos = createRepositories(testDb);

    // 1. Save initial quick debrief
    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-26" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Maneuvers Intro" } });
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Steep turns" } });
    fireEvent.change(screen.getByLabelText("What was difficult?"), { target: { value: "Slow flight altitude" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    let entries = await repos.journal.list();
    expect(entries.length).toBeGreaterThan(0);
    const createdId = entries[0]!.id;
    expect(entries[0]!.totalTime).toBeNull();

    cleanup();

    // 2. Reopen in full editor and enter flight times and aircraft details
    await renderJournalForm(`/journal/${createdId}/edit`);
    expect(screen.getByRole("heading", { level: 1, name: "Edit flight record" })).toBeTruthy();
    expect(screen.getByLabelText("Total flight time")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Total flight time"), { target: { value: "1.6" } });
    fireEvent.change(screen.getByLabelText("Dual received"), { target: { value: "1.6" } });
    fireEvent.change(screen.getByLabelText("Day landings"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Aircraft type / model"), { target: { value: "C172S" } });
    fireEvent.change(screen.getByLabelText("Tail number / identifier"), { target: { value: "N918SP" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    entries = await repos.journal.list();
    expect(entries[0]!.totalTime).toBe(1.6);
    expect(entries[0]!.aircraftId).toBe("N918SP");

    cleanup();

    // 3. Reopen in quick editor, edit reflections, and verify flight times are preserved
    await renderJournalForm(`/journal/${createdId}/edit?mode=quick`);
    expect(screen.getByRole("heading", { level: 1, name: /Quick debrief/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Steep turns and roll-in coordination improved." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    entries = await repos.journal.list();
    expect(entries[0]!.wentWell).toBe("Steep turns and roll-in coordination improved.");
    expect(entries[0]!.totalTime).toBe(1.6);
    expect(entries[0]!.dualReceived).toBe(1.6);
    expect(entries[0]!.dayLandings).toBe(4);
    expect(entries[0]!.aircraftType).toBe("C172S");
    expect(entries[0]!.aircraftId).toBe("N918SP");
  });

  it("cancellation leaves the database untouched with zero writes", async () => {
    const repos = createRepositories(testDb);
    const initialEntries = await repos.journal.list();
    expect(initialEntries.length).toBe(0);

    await renderJournalForm("/journal/new?mode=quick");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Cancelled flight note" } });
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Nothing saved yet" } });

    // Click Cancel (first cancel button in header)
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    const firstCancel = cancelButtons[0];
    expect(firstCancel).toBeDefined();
    await act(async () => {
      fireEvent.click(firstCancel!);
    });

    // Verify 0 database writes occurred
    const entriesAfterCancel = await repos.journal.list();
    expect(entriesAfterCancel.length).toBe(0);
    const actions = await repos.actions.list();
    expect(actions.length).toBe(0);
    const questions = await repos.questions.list();
    expect(questions.length).toBe(0);
  });

  it("does not silently create unapproved actions or questions when deliberate checkboxes are unchecked", async () => {
    const repos = createRepositories(testDb);

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Deliberate Review Test" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Unapproved question note in reflection." },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Unapproved action title" },
    });

    // Deliberately check and then UNCHECK both checkboxes to verify toggling off declines them
    const addActionCheckbox = screen.getByLabelText(/Add “Unapproved action title” to your Flight Plan/i);
    fireEvent.click(addActionCheckbox);
    fireEvent.click(addActionCheckbox);

    const saveQuestionCheckbox = screen.getByLabelText(/Save an instructor question to the Questions list/i);
    fireEvent.click(saveQuestionCheckbox);
    fireEvent.click(saveQuestionCheckbox);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.questionsForNextTime).toBe("Unapproved question note in reflection.");

    // Neither action nor question was silently created
    const actions = await repos.actions.list();
    expect(actions.length).toBe(0);

    const questions = await repos.questions.list();
    expect(questions.length).toBe(0);
  });

  it("prevents duplicate submissions on rapid repeated clicks", async () => {
    const repos = createRepositories(testDb);

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Rapid Submit Test" } });
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "First click" } });

    const saveButton = screen.getByRole("button", { name: "Save quick debrief" });

    // Click twice in immediate succession
    await act(async () => {
      fireEvent.click(saveButton);
      fireEvent.click(saveButton);
    });

    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
  });

  it("preserves draft text on save failure and enables safe retry without duplicate records", async () => {
    const repos = createRepositories(testDb);

    let failFirstSave = true;
    testDb.beforeStatement = async (sql: string) => {
      if (failFirstSave && sql.includes("INSERT INTO next_actions")) {
        failFirstSave = false;
        throw new Error("Simulated transient write glitch during action creation");
      }
    };

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retry Safe Test" } });
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Crucial reflections that must not be lost." },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Review emergency procedures" },
    });
    fireEvent.click(
      screen.getByLabelText(/Add “Review emergency procedures” to your Flight Plan/i),
    );

    // First save attempt fails
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });

    // Error is displayed and entered text is preserved
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(
      (screen.getByLabelText("What went well?") as HTMLTextAreaElement).value,
    ).toBe("Crucial reflections that must not be lost.");
    expect(
      (screen.getByLabelText("Because of this lesson, what should you do next?") as HTMLInputElement).value,
    ).toBe("Review emergency procedures");

    // Retry save
    const retryButton = screen.getByRole("button", { name: "Save quick debrief" });
    await act(async () => {
      fireEvent.click(retryButton);
    });

    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Verify retry did NOT produce duplicate entries
    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.wentWell).toBe("Crucial reflections that must not be lost.");

    const actions = await repos.actions.list();
    expect(actions.length).toBe(1);
    expect(actions[0]!.title).toBe("Review emergency procedures");
    expect(actions[0]!.relatedId).toBe(entries[0]!.id);
  });

  it("persists quick debrief records and links across SQLite database close and reload", async () => {
    const repos = createRepositories(testDb);

    const lesson = await repos.schedule.create({
      title: "Solo Prep",
      eventType: "flight_lesson",
      date: "2026-09-25",
      instructor: "CFI Sam",
      status: "completed",
    });

    const entry = await repos.journal.create({
      eventId: lesson.id,
      date: "2026-09-25",
      title: "Pre-Solo Debrief",
      wentWell: "Pattern altitude control",
      wasDifficult: "Go-around transition",
      confidence: 4,
    });

    const action = await repos.actions.create({
      title: "Chair fly go-around procedure",
      category: "prepare",
      priority: "next_up",
      relatedType: "journal",
      relatedId: entry.id,
    });

    const question = await repos.questions.create({
      text: "When exactly do I retract the first notch of flaps during a go-around?",
      journalId: entry.id,
      status: "to_ask",
    });

    // Close SQLite database
    testDb.close();

    // Reopen database from disk file
    const reopenedDb = await createNodeSqliteDatabase(dbFile);
    try {
      const reopenedRepos = createRepositories(reopenedDb);

      const loadedEntries = await reopenedRepos.journal.list();
      expect(loadedEntries.length).toBe(1);
      expect(loadedEntries[0]!.id).toBe(entry.id);
      expect(loadedEntries[0]!.wentWell).toBe("Pattern altitude control");
      expect(loadedEntries[0]!.confidence).toBe(4);

      const loadedActions = await reopenedRepos.actions.list();
      expect(loadedActions.length).toBe(1);
      expect(loadedActions[0]!.id).toBe(action.id);
      expect(loadedActions[0]!.relatedId).toBe(entry.id);

      const loadedQuestions = await reopenedRepos.questions.list();
      expect(loadedQuestions.length).toBe(1);
      expect(loadedQuestions[0]!.id).toBe(question.id);
      expect(loadedQuestions[0]!.journalId).toBe(entry.id);
    } finally {
      reopenedDb.close();
    }
  });

  it("allows switching between Quick debrief and Full editor mode without losing typed text", async () => {
    await renderJournalForm("/journal/new?mode=quick");

    // In Quick mode
    expect(screen.queryByLabelText("Total flight time")).toBeNull();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Switching Test" } });
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Typed in quick mode" },
    });

    // Switch to Full mode via tab chip
    const fullTab = screen.getByRole("tab", { name: "Full flight log & debrief" });
    fireEvent.click(fullTab);

    // Full mode fields now visible
    expect(screen.getByLabelText("Total flight time")).toBeTruthy();

    // Text typed in quick mode is fully preserved
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Switching Test");
    expect((screen.getByLabelText("What went well?") as HTMLTextAreaElement).value).toBe(
      "Typed in quick mode",
    );

    // Enter flight time in full mode
    fireEvent.change(screen.getByLabelText("Total flight time"), { target: { value: "1.2" } });

    // Switch back to Quick mode
    const quickTab = screen.getByRole("tab", { name: "Quick debrief" });
    fireEvent.click(quickTab);

    // Flight time field is hidden again
    expect(screen.queryByLabelText("Total flight time")).toBeNull();
    // Reflection text still intact
    expect((screen.getByLabelText("What went well?") as HTMLTextAreaElement).value).toBe(
      "Typed in quick mode",
    );
  });

  it("regression 1: preserves intentional edits across mode switches (numeric, text, relationships, clearing)", async () => {
    const repos = createRepositories(testDb);

    const goal = await repos.goals.create({
      title: "Commercial Pilot",
      status: "working_on",
    });

    const entry = await repos.journal.create({
      date: "2026-09-26",
      title: "Solo Cross Country Flight",
      aircraftType: "C172S",
      aircraftId: "N12345",
      departureAirport: "KPAE",
      arrivalAirport: "KBVS",
      instructorName: "Dave",
      totalTime: 1.0,
      mission: "Cross country navigation",
      goalId: goal.id,
    });

    await renderJournalForm(`/journal/${entry.id}/edit?mode=quick`);

    // Switch to Full mode
    const fullTab = screen.getByRole("tab", { name: "Full flight log & debrief" });
    fireEvent.click(fullTab);

    // Edit totalTime to 2.5
    fireEvent.change(screen.getByLabelText("Total flight time"), { target: { value: "2.5" } });
    // Clear mission to empty string
    fireEvent.change(screen.getByLabelText("Today's mission"), { target: { value: "" } });
    // Change aircraftId to N99999
    fireEvent.change(screen.getByLabelText("Tail number / identifier"), {
      target: { value: "N99999" },
    });
    // Clear goal link
    fireEvent.change(screen.getByLabelText("Related goal"), { target: { value: "" } });

    // Switch back to Quick mode
    const quickTab = screen.getByRole("tab", { name: "Quick debrief" });
    fireEvent.click(quickTab);

    // Save changes
    const saveButton = screen.getByRole("button", { name: "Save changes" });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Verify in SQLite that intentional edits survived switching modes and saving
    const entries = await repos.journal.list();
    const updated = entries.find((e) => e.id === entry.id);
    expect(updated).toBeDefined();
    expect(updated?.totalTime).toBe(2.5);
    expect(updated?.mission).toBe("");
    expect(updated?.aircraftId).toBe("N99999");
    expect(updated?.goalId).toBeNull();
    // Untouched hidden field preserved
    expect(updated?.aircraftType).toBe("C172S");
    expect(updated?.departureAirport).toBe("KPAE");
  });

  it("refuses a part of the flight longer than its total and saves once corrected", async () => {
    const repos = createRepositories(testDb);
    const entry = await repos.journal.create({ date: "2026-09-26", title: "Pattern work", totalTime: 1.0 });

    await renderJournalForm(`/journal/${entry.id}/edit`);
    fireEvent.change(screen.getByLabelText("Total flight time"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Dual received"), { target: { value: "2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Dual received time can't be more than this flight's total time of 1.5 hr.",
    );
    expect((await repos.journal.list()).find((e) => e.id === entry.id)?.dualReceived).toBeNull();

    fireEvent.change(screen.getByLabelText("Dual received"), { target: { value: "1.5" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());
    const saved = (await repos.journal.list()).find((e) => e.id === entry.id);
    expect(saved?.totalTime).toBe(1.5);
    expect(saved?.dualReceived).toBe(1.5);
  });

  it("lets a quick debrief save an entry whose earlier times it doesn't show", async () => {
    const repos = createRepositories(testDb);
    const entry = await repos.journal.create({ date: "2026-09-20", title: "Older entry", totalTime: 1.0, dualReceived: 1.2 });

    await renderJournalForm(`/journal/${entry.id}/edit?mode=quick`);
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Steep turns" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());
    const saved = (await repos.journal.list()).find((e) => e.id === entry.id);
    expect(saved?.wentWell).toBe("Steep turns");
    expect(saved?.dualReceived).toBe(1.2);
  });

  it("regression 2: requires explicit acceptance of derived records and does not create fallbacks or auto-create", async () => {
    const repos = createRepositories(testDb);

    // Part A: Reflection-only save creates no action or question
    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-26" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Reflection Only Debrief" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "How do I manage roundout transition?" },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Chair fly pattern roundout" },
    });

    // Save WITHOUT clicking any checkboxes (they must start false)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    let entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.questionsForNextTime).toBe("How do I manage roundout transition?");

    // 0 actions and 0 questions created because user did not explicitly accept them!
    let actions = await repos.actions.list();
    expect(actions.length).toBe(0);
    let questions = await repos.questions.list();
    expect(questions.length).toBe(0);

    cleanup();

    // Part B: Clearing question review text creates NO question (no invisible fallback to reflection text)
    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-26" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Cleared Question Debrief" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Reflection question text that should NOT become a question record if review text is cleared." },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Action item to keep" },
    });

    // Explicitly check action checkbox
    const actionCheckbox = screen.getByLabelText(/Add “Action item to keep” to your Flight Plan/i);
    fireEvent.click(actionCheckbox);

    // Explicitly check question checkbox
    const questionCheckbox = screen.getByLabelText(/Save an instructor question to the Questions list/i);
    fireEvent.click(questionCheckbox);

    // Now clear the review textarea completely!
    const questionTextArea = screen.getByLabelText("Question to ask your instructor");
    fireEvent.change(questionTextArea, { target: { value: "   " } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    actions = await repos.actions.list();
    expect(actions.length).toBe(1);
    expect(actions[0]!.title).toBe("Action item to keep");

    // Question must NOT be created because review text was cleared (no invisible fallback)
    questions = await repos.questions.list();
    expect(questions.length).toBe(0);

    cleanup();

    // Part C: Recovered drafts do not silently accept derived records
    writeDraft("journal.new", {
      date: "2026-09-26",
      title: "Interrupted Draft",
      questionsForNextTime: "Draft question from interrupted session",
    });

    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.getByRole("status")).toBeTruthy(); // Draft recovered

    // Save recovered draft
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Recovered draft must not have silently created questions or actions
    questions = await repos.questions.list();
    expect(questions.length).toBe(0);
  });

  it("regression 3: safe reconciliation of partial-save retries when action is unchecked, text changed, or leaving/reopening", async () => {
    const repos = createRepositories(testDb);

    let injectFailure = true;
    testDb.beforeStatement = async (sql: string) => {
      if (injectFailure && sql.includes("INSERT INTO questions")) {
        injectFailure = false;
        throw new Error("Injected partial save failure at INSERT INTO questions");
      }
    };

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-26" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Partial Failure Test" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Ask about pattern crosswind correction" },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Initial Action" },
    });

    // Explicitly check both checkboxes
    fireEvent.click(screen.getByLabelText(/Add “Initial Action” to your Flight Plan/i));
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    // First save attempt: will succeed for journal and action, but fail for question
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });

    // Error is displayed
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    // Verify atomic transaction rollback in SQLite: zero partial records left
    let entries = await repos.journal.list();
    expect(entries.length).toBe(0);
    let actions = await repos.actions.list();
    expect(actions.length).toBe(0);
    let questions = await repos.questions.list();
    expect(questions.length).toBe(0);

    // Now user UNCHECKS the action before retrying:
    const actionCheckbox = screen.getByLabelText(/Add “Initial Action” to your Flight Plan/i);
    fireEvent.click(actionCheckbox);

    // And user changes the question text:
    const questionTextArea = screen.getByLabelText("Question to ask your instructor");
    fireEvent.change(questionTextArea, {
      target: { value: "Updated question: crosswind crab vs slip" },
    });

    // Retry save (failure will not trigger again)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });

    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Verify reconciliation:
    // 1. Journal entry matches
    entries = await repos.journal.list();
    expect(entries.length).toBe(1);

    // 2. Previously created action was removed because user unchecked it on retry!
    actions = await repos.actions.list();
    expect(actions.length).toBe(0);

    // 3. Question was successfully created with updated text
    questions = await repos.questions.list();
    expect(questions.length).toBe(1);
    expect(questions[0]!.text).toBe("Updated question: crosswind crab vs slip");

    cleanup();

    // Now test leaving and reopening after partial failure:
    // Create an unrelated action that must NEVER be touched
    const unrelatedAction = await repos.actions.create({
      title: "Unrelated action that must be preserved",
      relatedType: "goal",
      relatedId: "some-goal",
    });

    // Inject failure at question insert again
    injectFailure = true;
    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-26" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Leave and Reopen Partial" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Question before leave" },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Action before leave" },
    });

    fireEvent.click(screen.getByLabelText(/Add “Action before leave” to your Flight Plan/i));
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    // Save fails at question
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // User navigates away / reopens page:
    cleanup();
    injectFailure = false;

    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.getByRole("status")).toBeTruthy(); // Draft recovered

    // Now on reopened form: user changes action title to "Updated Action After Reopen"
    // and explicitly checks the action checkbox
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Updated Action After Reopen" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Updated Action After Reopen” to your Flight Plan/i));

    // And saves
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Unrelated action was not deleted
    const allActions = await repos.actions.list();
    expect(allActions.some((a) => a.id === unrelatedAction.id)).toBe(true);

    // The journal action was updated rather than duplicated
    const linkedActions = allActions.filter((a) => a.relatedType === "journal");
    expect(linkedActions.length).toBe(1);
    expect(linkedActions[0]!.title).toBe("Updated Action After Reopen");
  });

  it("finding 1: same-journal independent records added after editor opens are preserved by reflection edits", async () => {
    const repos = createRepositories(testDb);
    const entry = await repos.journal.create({
      date: "2026-09-26",
      title: "Existing Entry",
      wentWell: "Initial reflections",
    });

    await renderJournalForm(`/journal/${entry.id}/edit?mode=quick`);

    // Through the repositories, create an independent action and question linked to that same journal after the editor mounts
    const independentAction = await repos.actions.create({
      title: "Independent Action Added Later",
      category: "prepare",
      priority: "next_up",
      relatedType: "journal",
      relatedId: entry.id,
    });

    const independentQuestion = await repos.questions.create({
      text: "Independent Question Added Later",
      journalId: entry.id,
      status: "to_ask",
    });

    // Change a reflection and save
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Updated reflection only" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    const actions = await repos.actions.list();
    expect(actions.some((a) => a.id === independentAction.id)).toBe(true);

    const questions = await repos.questions.list();
    expect(questions.some((q) => q.id === independentQuestion.id)).toBe(true);
  });

  it("finding 1: explicit acceptance never overwrites an independent linked record, and withdrawal removes only owned partial record", async () => {
    const repos = createRepositories(testDb);
    const entry = await repos.journal.create({
      date: "2026-09-26",
      title: "Debrief with Independent Links",
    });

    // Independent action and question already exist for this journal entry
    const independentAction = await repos.actions.create({
      title: "Pre-existing Independent Action",
      category: "prepare",
      priority: "next_up",
      relatedType: "journal",
      relatedId: entry.id,
    });

    const independentQuestion = await repos.questions.create({
      text: "Pre-existing Independent Question",
      journalId: entry.id,
      status: "to_ask",
    });

    // Create a new debrief that creates its own owned action and question
    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Debrief With Owned Records" } });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Owned Action Alpha" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Owned Action Alpha” to your Flight Plan/i));
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Owned Question Alpha" },
    });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Both independent and newly created records exist intact
    const allActions = await repos.actions.list();
    expect(allActions.some((a) => a.id === independentAction.id)).toBe(true);
    expect(allActions.some((a) => a.title === "Owned Action Alpha")).toBe(true);

    const allQuestions = await repos.questions.list();
    expect(allQuestions.some((q) => q.id === independentQuestion.id)).toBe(true);
    expect(allQuestions.some((q) => q.text === "Owned Question Alpha")).toBe(true);
  });

  it("finding 1: independent records present when partially saved draft is recovered are never overwritten", async () => {
    const repos = createRepositories(testDb);

    let injectFailure = true;
    testDb.beforeStatement = async (sql: string) => {
      if (injectFailure && sql.includes("INSERT INTO questions")) {
        injectFailure = false;
        throw new Error("Injected failure during question write");
      }
    };

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Partial Recovery Journal" } });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Owned Action Prior to Failure" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Owned Action Prior to Failure” to your Flight Plan/i));
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Failing Question" },
    });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    // Save fails at questions table
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // Check that draft recovery retained the target entry ID
    const savedDraft = readDraft<any>("journal.new");
    expect(savedDraft).toBeTruthy();
    const entryId = savedDraft.id;
    expect(entryId).toBeTruthy();

    cleanup();
    injectFailure = false;

    // While unmounted, an independent process adds an action linked to this journal entry
    const independentAction = await repos.actions.create({
      title: "Concurrent Action Added While Draft In Storage",
      category: "prepare",
      priority: "next_up",
      relatedType: "journal",
      relatedId: entryId,
    });

    // Reopen the form
    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.getByRole("status")).toBeTruthy(); // Draft recovered

    // User updates owned action title and checks Add to plan
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Owned Action Successfully Updated" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Owned Action Successfully Updated” to your Flight Plan/i));

    // Save again
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Independent action was completely preserved and never overwritten
    const actions = await repos.actions.list();
    const independent = actions.find((a) => a.id === independentAction.id);
    expect(independent).toBeTruthy();
    expect(independent!.title).toBe("Concurrent Action Added While Draft In Storage");

    // Owned action was updated
    const owned = actions.find((a) => a.title === "Owned Action Successfully Updated");
    expect(owned).toBeTruthy();
    expect(owned!.id).not.toBe(independentAction.id);
  });

  it("finding 1: failure after journal and action writes remains recoverable with no duplicates on retry or reopen", async () => {
    const repos = createRepositories(testDb);

    let injectFailure = true;
    testDb.beforeStatement = async (sql: string) => {
      if (injectFailure && sql.includes("INSERT INTO questions")) {
        injectFailure = false;
        throw new Error("Temporary question write failure");
      }
    };

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retry & Reopen Debrief" } });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Action Item 1" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Action Item 1” to your Flight Plan/i));
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Question Item 1" },
    });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    // Save fails
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // Immediate retry on the same mounted form
    const retryButton = screen.getByRole("button", { name: "Save quick debrief" });
    await act(async () => {
      fireEvent.click(retryButton);
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Exactly 1 journal entry, 1 action, 1 question
    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.title).toBe("Retry & Reopen Debrief");

    const actions = await repos.actions.list();
    expect(actions.length).toBe(1);
    expect(actions[0]!.title).toBe("Action Item 1");

    const questions = await repos.questions.list();
    expect(questions.length).toBe(1);
    expect(questions[0]!.text).toBe("Question Item 1");
  });

  it("finding 2: recovers next-action title and exact edited question text on unmount and reopen, preserving intentional blank edits", async () => {
    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Navigation Recovery" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Reflection question text" },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Chair fly ground references" },
    });

    // Enable question review control and edit its text separately
    const questionCheckbox = screen.getByLabelText(/Save an instructor question to the Questions list/i);
    fireEvent.click(questionCheckbox);

    const questionInput = screen.getByLabelText("Question to ask your instructor");
    fireEvent.change(questionInput, {
      target: { value: "Edited question text differing from reflection" },
    });

    // Unmount and reopen the form
    cleanup();
    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.getByRole("status")).toBeTruthy(); // Draft recovered

    // Verify next-action title is recovered
    const actionField = screen.getByLabelText(
      "Because of this lesson, what should you do next?",
    ) as HTMLInputElement;
    expect(actionField.value).toBe("Chair fly ground references");

    // Acceptance controls start unchecked (explicit acceptance required)
    expect(
      (screen.getByLabelText(/Add “Chair fly ground references” to your Flight Plan/i) as HTMLInputElement).checked,
    ).toBe(false);

    // Re-enable question review
    const reenabledCheckbox = screen.getByLabelText(/Save an instructor question to the Questions list/i);
    fireEvent.click(reenabledCheckbox);

    // Verify edited question text is recovered exactly
    const reenabledQuestionInput = screen.getByLabelText(
      "Question to ask your instructor",
    ) as HTMLTextAreaElement;
    expect(reenabledQuestionInput.value).toBe("Edited question text differing from reflection");

    // Now test intentional blank edit: user clears the question review textarea completely
    fireEvent.change(reenabledQuestionInput, { target: { value: "" } });

    // User updates reflection text
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Brand new reflection question" },
    });

    // Unmount and reopen again
    cleanup();
    await renderJournalForm("/journal/new?mode=quick");

    // Re-enable question review: the intentional blank edit must be preserved!
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));
    const blankQuestionInput = screen.getByLabelText(
      "Question to ask your instructor",
    ) as HTMLTextAreaElement;
    expect(blankQuestionInput.value).toBe("");
  });

  it("finding 2: maintains compatibility with legacy drafts and ensures Start fresh clears all recovery state", async () => {
    // Write an older legacy draft with no nextActionTitle or questionToSave
    writeDraft("journal.new", {
      date: "2026-09-26",
      title: "Legacy Draft Entry",
      questionsForNextTime: "Legacy questions from before D5 update",
      wentWell: "Legacy steep turns",
    });

    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.getByRole("status")).toBeTruthy(); // Draft recovered

    // Title and reflection questions are present
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Legacy Draft Entry");
    expect(
      (screen.getByLabelText("Questions for next time") as HTMLTextAreaElement).value,
    ).toBe("Legacy questions from before D5 update");

    // Next action title is empty string rather than crashing or showing "undefined"
    const nextAction = screen.getByLabelText(
      "Because of this lesson, what should you do next?",
    ) as HTMLInputElement;
    expect(nextAction.value).toBe("");

    // Enable question review: cleanly inherits the reflection question
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));
    expect(
      (screen.getByLabelText("Question to ask your instructor") as HTMLTextAreaElement).value,
    ).toBe("Legacy questions from before D5 update");

    // Now click "Start fresh"
    const startFreshButton = screen.getByRole("button", { name: "Start fresh" });
    fireEvent.click(startFreshButton);

    // Draft is forgotten and form reset
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    expect(readDraft("journal.new")).toBeNull();

    // Leaving and reopening does not bring back the cleared draft
    cleanup();
    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  });

  it("save safety 1: durable pre-write identity protects against interruption after journal commit, action commit, and question commit without duplicate records", async () => {
    const repos = createRepositories(testDb);

    // Boundary A: Interrupted after journal commit (before action commit)
    let shouldFailAction = true;
    let capturedDraftA: any = null;
    testDb.beforeStatement = async (sql: string) => {
      if (shouldFailAction && sql.includes("INSERT INTO next_actions")) {
        shouldFailAction = false;
        capturedDraftA = readDraft("journal.new");
        throw new Error("Simulated interruption after journal commit");
      }
    };

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Boundary A Debrief" } });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Action Boundary A" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Action Boundary A” to your Flight Plan/i));
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Question Boundary A" },
    });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // Verify localStorage has pre-assigned IDs
    expect(capturedDraftA).toBeTruthy();
    expect(capturedDraftA.id).toBeTruthy();
    expect(capturedDraftA.createdActionId).toBeTruthy();
    expect(capturedDraftA.createdQuestionId).toBeTruthy();

    // In SQLite: atomic transaction rolls back, leaving zero partial records
    let entries = await repos.journal.list();
    expect(entries.length).toBe(0);
    let actions = await repos.actions.list();
    expect(actions.length).toBe(0);

    // Reopen form from captured durable draft
    cleanup();
    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.getByRole("status")).toBeTruthy(); // Draft recovered

    // Re-approve action and question
    fireEvent.click(screen.getByLabelText(/Add “Action Boundary A” to your Flight Plan/i));
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Assert exact counts and identities
    entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe(capturedDraftA.id);

    actions = await repos.actions.list();
    expect(actions.length).toBe(1);
    expect(actions[0]!.id).toBe(capturedDraftA.createdActionId);

    let questions = await repos.questions.list();
    expect(questions.length).toBe(1);
    expect(questions[0]!.id).toBe(capturedDraftA.createdQuestionId);

    cleanup();

    // Boundary B: Interrupted during question commit (atomic rollback leaves no partial records)
    let shouldFailQuestion = true;
    let capturedDraftB: any = null;
    testDb.beforeStatement = async (sql: string) => {
      if (shouldFailQuestion && sql.includes("INSERT INTO questions")) {
        shouldFailQuestion = false;
        capturedDraftB = readDraft("journal.new");
        throw new Error("Simulated interruption after action commit");
      }
    };

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Boundary B Debrief" } });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Action Boundary B" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Action Boundary B” to your Flight Plan/i));
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Question Boundary B" },
    });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    expect(capturedDraftB).toBeTruthy();
    expect(capturedDraftB.createdActionId).toBeTruthy();

    // In SQLite: atomic rollback ensures action was not committed
    actions = await repos.actions.list();
    expect(actions.some((a) => a.id === capturedDraftB.createdActionId)).toBe(false);
    const actionCountBeforeB = actions.length;

    // Reopen form from captured durable draft
    cleanup();
    await renderJournalForm("/journal/new?mode=quick");
    expect(screen.getByRole("status")).toBeTruthy();

    // Re-approve action and question
    fireEvent.click(screen.getByLabelText(/Add “Action Boundary B” to your Flight Plan/i));
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

    // Assert action was created with durable ID, NOT duplicated
    actions = await repos.actions.list();
    expect(actions.length).toBe(actionCountBeforeB + 1);
    const actionB = actions.find((a) => a.id === capturedDraftB.createdActionId);
    expect(actionB).toBeTruthy();
    expect(actionB!.title).toBe("Action Boundary B");

    questions = await repos.questions.list();
    expect(questions.some((q) => q.id === capturedDraftB.createdQuestionId)).toBe(true);

    cleanup();

    // Boundary C: Permanent regression for D5's after-question-commit interruption boundary
    // Simulate process crash after all database commits succeed, but before draft storage is cleared.
    const capturedDraftC = readDraft("journal.new");
    if (!capturedDraftC) {
      // Re-populate localStorage to simulate the unforgotten draft at the commit boundary
      const draftC = {
        id: "entry-c-boundary",
        title: "Boundary C Debrief",
        date: "2026-09-26",
        wentWell: "",
        wasDifficult: "",
        instructorFeedback: "",
        questionsForNextTime: "Boundary C question",
        nextActionTitle: "Boundary C action",
        createdActionId: "action-c-boundary",
        createdQuestionId: "question-c-boundary",
      };
      writeDraft("journal.new", draftC);
      // Pre-commit the records into DB as if the transaction committed right before the crash
      await testDb.saveDebriefAtomically!({
        targetId: draftC.id,
        operationId: "op-quickDebrief-1",
        journal: {
          eventId: null,
          date: draftC.date,
          title: draftC.title,
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
          questionsForNextTime: draftC.questionsForNextTime,
          confidence: null,
          goalId: null,
          materialIds: [],
        },
        action: { id: draftC.createdActionId, title: draftC.nextActionTitle, materialId: null },
        withdrawActionId: null,
        question: { id: draftC.createdQuestionId, text: draftC.questionsForNextTime, eventId: null, materialId: null },
        withdrawQuestionId: null,
      });

      const actionsBeforeC = await repos.actions.list();
      const questionsBeforeC = await repos.questions.list();
      const entriesBeforeC = await repos.journal.list();

      // Pilot reopens app from the recovered draft and clicks save again
      await renderJournalForm("/journal/new?mode=quick");
      expect(screen.getByRole("status")).toBeTruthy();

      fireEvent.click(screen.getByLabelText(/Add “Boundary C action” to your Flight Plan/i));
      fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
      });
      await waitFor(() => expect(screen.getByTestId("entry-detail")).toBeTruthy());

      // Assert exact record identity idempotency (zero duplicates)
      const actionsAfterC = await repos.actions.list();
      expect(actionsAfterC.length).toBe(actionsBeforeC.length);
      const questionsAfterC = await repos.questions.list();
      expect(questionsAfterC.length).toBe(questionsBeforeC.length);
      const entriesAfterC = await repos.journal.list();
      expect(entriesAfterC.length).toBe(entriesBeforeC.length);
    }

    cleanup();
    testDb.beforeStatement = undefined;
  });

  it("save safety 1: refuses to begin partial database commits if draft storage write fails", async () => {
    const repos = createRepositories(testDb);

    // Mock localStorage to throw QuotaExceededError
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    try {
      await renderJournalForm("/journal/new?mode=quick");
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Storage Failure Debrief" } });
      fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
        target: { value: "Action Item" },
      });
      fireEvent.click(screen.getByLabelText(/Add “Action Item” to your Flight Plan/i));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
      });

      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toMatch(/draft storage is unavailable or full/i);
      });

      // Assert zero database side effects occurred
      const entries = await repos.journal.list();
      expect(entries.length).toBe(0);
      const actions = await repos.actions.list();
      expect(actions.length).toBe(0);
      const questions = await repos.questions.list();
      expect(questions.length).toBe(0);
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("save safety 2: disables all controls during save and preserves edits made while saving across deferred write failure and success", async () => {

    let resolveWrite: (() => void) | null = null;
    let rejectWrite: ((err: Error) => void) | null = null;
    let writeDeferred = new Promise<void>((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });

    testDb.beforeStatement = async (sql: string) => {
      if (sql.includes("INSERT INTO journal_entries") || sql.includes("UPDATE journal_entries")) {
        await writeDeferred;
      }
    };

    await renderJournalForm("/journal/new?mode=quick");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Deferred Write Test" } });
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Before save reflection" },
    });
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Action before save" },
    });
    fireEvent.click(screen.getByLabelText(/Add “Action before save” to your Flight Plan/i));
    fireEvent.change(screen.getByLabelText("Questions for next time"), {
      target: { value: "Question reflection" },
    });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));

    // Trigger save
    const saveButton = screen.getByRole("button", { name: "Save quick debrief" });
    fireEvent.click(saveButton);

    // Assert accessible disabled controls during save operation
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    });

    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    const reflectionArea = screen.getByLabelText("What went well?") as HTMLTextAreaElement;
    const actionInput = screen.getByLabelText("Because of this lesson, what should you do next?") as HTMLInputElement;
    const actionCheckbox = screen.getByLabelText(/Add “Action before save” to your Flight Plan/i) as HTMLInputElement;
    const questionCheckbox = screen.getByLabelText(/Save an instructor question to the Questions list/i) as HTMLInputElement;
    const questionTextArea = screen.getByLabelText("Question to ask your instructor") as HTMLTextAreaElement;

    expect(titleInput.disabled).toBe(true);
    expect(reflectionArea.disabled).toBe(true);
    expect(actionInput.disabled).toBe(true);
    expect(actionCheckbox.disabled).toBe(true);
    expect(questionCheckbox.disabled).toBe(true);
    expect(questionTextArea.disabled).toBe(true);

    // Simulate programmatic update while saving is pending
    fireEvent.change(reflectionArea, { target: { value: "New text while saving" } });

    // Reject the deferred write (failure case)
    await act(async () => {
      rejectWrite!(new Error("Disk write rejected"));
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // Controls re-enable and the text was NOT reverted to "Before save reflection"
    expect(titleInput.disabled).toBe(false);
    expect(reflectionArea.disabled).toBe(false);
    expect(reflectionArea.value).toBe("New text while saving");

    // Now test deferred write success with newer edits preserved
    writeDeferred = new Promise<void>((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });

    // Click Save again
    fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    });

    // Make an edit while the write is pending
    fireEvent.change(reflectionArea, { target: { value: "Even newer text typed while saving" } });

    // Resolve the deferred write (success case)
    await act(async () => {
      resolveWrite!();
    });

    // The form preserves newer edits rather than discarding them or navigating away prematurely
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
    });
    expect(screen.queryByTestId("entry-detail")).toBeNull();
    expect(reflectionArea.value).toBe("Even newer text typed while saving");

    testDb.beforeStatement = undefined;
  });
});
