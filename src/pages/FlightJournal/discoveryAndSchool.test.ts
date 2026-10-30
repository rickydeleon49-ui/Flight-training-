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
import { JournalEntryDetail } from "@/pages/FlightJournal/JournalEntryDetail";
import { FlightJournal } from "@/pages/FlightJournal/FlightJournal";
import { readDraft, writeDraft } from "@/lib/drafts";
import { formatTypedDate, todayIso } from "@/lib/dates";
import { flightLogTotals, hasFlightLogData } from "@/logic/flightLog";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import type { DebriefSaveOperation } from "@/data/db";

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
    h(Route, { path: "/journal", element: h(FlightJournal) }),
    h(Route, { path: "/journal/new", element: h(JournalForm) }),
    h(Route, { path: "/journal/:entryId/edit", element: h(JournalForm) }),
    h(Route, { path: "/journal/:entryId", element: h(JournalEntryDetail) }),
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

describe("FLIGHTLOG-01: Discovery flight preset and School historical snapshot UI", () => {
  let tempDir: string;
  let dbFile: string;

  beforeEach(async () => {
    localStorage.clear();
    tempDir = mkdtempSync(join(tmpdir(), "flight-deck-discovery-"));
    dbFile = join(tempDir, "discovery-school.db");
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

  it("1. loads a fresh discovery preset without pre-filling profile aircraft, instructor, or route", async () => {
    const repos = createRepositories(testDb);
    await repos.profile.update({
      aircraftType: "Cessna 172S",
      instructorName: "CFI Dave",
      homeAirport: "KSQL",
      flightSchool: "San Carlos Flight Center",
    });

    await renderApp("/journal/new?mode=discovery");

    expect(screen.getByRole("heading", { level: 1, name: "Log discovery flight" })).toBeTruthy();
    expect(
      screen.getByText("Record your discovery flight experience and impressions. Flight times, aircraft, and school are optional."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Copy only times agreed with your instructor, and keep the instructor-endorsed logbook authoritative/i),
    ).toBeTruthy();

    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Discovery flight");

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    expect(dateInput.value).toBe(formatTypedDate(todayIso()));

    // Profile defaults must NOT be prefilled on a discovery preset
    const aircraftInput = screen.getByLabelText(/Aircraft type/i) as HTMLInputElement;
    expect(aircraftInput.value).toBe("");

    const instructorInput = screen.getByLabelText("Instructor name") as HTMLInputElement;
    expect(instructorInput.value).toBe("");

    const depInput = screen.getByLabelText("Departure airport") as HTMLInputElement;
    expect(depInput.value).toBe("");

    const arrInput = screen.getByLabelText("Arrival airport") as HTMLInputElement;
    expect(arrInput.value).toBe("");

    const schoolInput = screen.getByLabelText("School") as HTMLInputElement;
    expect(schoolInput.value).toBe("");

    // Flight times remain empty
    const totalTimeInput = screen.getByLabelText("Total flight time") as HTMLInputElement;
    expect(totalTimeInput.value).toBe("");
  });

  it("2. saves an optional school snapshot in atomic payload and persists to SQLite", async () => {
    const repos = createRepositories(testDb);

    await renderApp("/journal/new?mode=discovery");

    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "Bay Flight Academy" },
    });
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Got to take the controls on climbout." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Discovery flight" })).toBeTruthy();
    });

    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    const saved = entries[0]!;
    expect(saved.schoolName).toBe("Bay Flight Academy");
    expect(saved.wentWell).toBe("Got to take the controls on climbout.");
    expect(saved.aircraftType).toBe("");
    expect(saved.totalTime).toBeNull();
  });

  it("3. quick and full edit strictly preserves school and all flight fields", async () => {
    const repos = createRepositories(testDb);

    const existing = await repos.journal.create({
      date: "2026-09-15",
      title: "Crosswind Practice",
      aircraftType: "Piper Archer",
      aircraftId: "N123PA",
      departureAirport: "KPAO",
      arrivalAirport: "KPAO",
      instructorName: "CFI Lewis",
      schoolName: "Palo Alto Flying Club",
      totalTime: 1.5,
      dualReceived: 1.5,
      soloTime: null,
      picTime: null,
      crossCountryTime: null,
      nightTime: null,
      actualInstrumentTime: null,
      simulatedInstrumentTime: null,
      dayLandings: 4,
      nightLandings: null,
      mission: "Pattern landings in crosswinds",
      practiced: "Crab and slip techniques",
      wentWell: "Good rudder control",
      wasDifficult: "Flare float",
      instructorFeedback: "Keep alignment with centerline",
      questionsForNextTime: "",
      confidence: 4,
    });

    // 3a. Edit in Quick mode
    await renderApp(`/journal/${existing.id}/edit?mode=quick`);
    expect(screen.getByRole("heading", { level: 1, name: /Quick debrief/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Updated: rudder control was instinctive." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Crosswind Practice" })).toBeTruthy();
    });

    let entries = await repos.journal.list();
    let updated = entries.find((e) => e.id === existing.id)!;
    expect(updated.wentWell).toBe("Updated: rudder control was instinctive.");
    expect(updated.schoolName).toBe("Palo Alto Flying Club");
    expect(updated.aircraftType).toBe("Piper Archer");
    expect(updated.aircraftId).toBe("N123PA");
    expect(updated.totalTime).toBe(1.5);
    expect(updated.dayLandings).toBe(4);

    // 3b. Edit in Full mode (including ?mode=discovery priority regression check: existing edit priority)
    cleanup();
    await renderApp(`/journal/${existing.id}/edit?mode=discovery`);
    expect(screen.getByRole("heading", { level: 1, name: "Edit flight record" })).toBeTruthy();

    const schoolInput = screen.getByLabelText("School") as HTMLInputElement;
    expect(schoolInput.value).toBe("Palo Alto Flying Club");
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Crosswind Practice");
    const aircraftInput = screen.getByLabelText(/Aircraft type/i) as HTMLInputElement;
    expect(aircraftInput.value).toBe("Piper Archer");

    // Modify instructor name, keeping school as is
    fireEvent.change(screen.getByLabelText("Instructor name"), {
      target: { value: "CFI Martha" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Crosswind Practice" })).toBeTruthy();
    });

    entries = await repos.journal.list();
    updated = entries.find((e) => e.id === existing.id)!;
    expect(updated.title).toBe("Crosswind Practice");
    expect(updated.instructorName).toBe("CFI Martha");
    expect(updated.schoolName).toBe("Palo Alto Flying Club");
    expect(updated.aircraftType).toBe("Piper Archer");
    expect(updated.aircraftId).toBe("N123PA");
    expect(updated.totalTime).toBe(1.5);
  });

  it("4. old recovered draft lacking school preserves stored school snapshot on save via atomic omission", async () => {
    const repos = createRepositories(testDb);

    let capturedOp: DebriefSaveOperation | null = null;
    const originalSave = testDb.saveDebriefAtomically;
    if (originalSave) {
      testDb.saveDebriefAtomically = async (op) => {
        capturedOp = op;
        return originalSave.call(testDb, op);
      };
    }

    const existing = await repos.journal.create({
      date: "2026-08-10",
      title: "First Lesson",
      aircraftType: "Cessna 172",
      aircraftId: "N172EF",
      departureAirport: "KSQL",
      arrivalAirport: "KSQL",
      instructorName: "CFI Sam",
      schoolName: "Historical Flight Center",
      totalTime: 1.0,
      dualReceived: 1.0,
      soloTime: null,
      picTime: null,
      crossCountryTime: null,
      nightTime: null,
      actualInstrumentTime: null,
      simulatedInstrumentTime: null,
      dayLandings: 2,
      nightLandings: null,
      mission: "Orientation",
      practiced: "Effects of controls",
      wentWell: "Straight and level",
      wasDifficult: "Trim",
      instructorFeedback: "Feel the pressure",
      questionsForNextTime: "",
      confidence: 3,
    });

    // Simulate an old draft in localStorage saved before schoolName existed (no schoolName key)
    const oldDraftWithoutSchool = {
      id: existing.id,
      eventId: null,
      date: "2026-08-10",
      title: "First Lesson - Draft Edit",
      aircraftType: "Cessna 172",
      aircraftId: "N172EF",
      departureAirport: "KSQL",
      arrivalAirport: "KSQL",
      instructorName: "CFI Sam",
      totalTime: 1.0,
      dualReceived: 1.0,
      soloTime: null,
      picTime: null,
      crossCountryTime: null,
      nightTime: null,
      actualInstrumentTime: null,
      simulatedInstrumentTime: null,
      dayLandings: 2,
      nightLandings: null,
      mission: "Orientation",
      practiced: "Effects of controls",
      wentWell: "Recovered straight and level",
      wasDifficult: "Trim",
      instructorFeedback: "Feel the pressure",
      confidence: 3,
      goalId: null,
      materialIds: [],
    };
    writeDraft(`journal.${existing.id}`, oldDraftWithoutSchool);

    await renderApp(`/journal/${existing.id}/edit`);

    // Verify draft recovery banner is shown
    expect(screen.getByText(/Picked up where you left off/i)).toBeTruthy();

    // The school input should display the stored snapshot (Historical Flight Center)
    const schoolInput = screen.getByLabelText("School") as HTMLInputElement;
    expect(schoolInput.value).toBe("Historical Flight Center");

    // Simulate another write changing only stored school via repositories.journal.update
    // AFTER render and before user saves the old draft (context still holds old name)
    await repos.journal.update(existing.id, {
      schoolName: "Updated While Editing Center",
    });

    // Save changes without touching the school field in the UI
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "First Lesson - Draft Edit" })).toBeTruthy();
    });

    // Capture outgoing atomic operation and assert schoolName key is omitted
    expect(capturedOp).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(capturedOp!.journal, "schoolName")).toBe(false);

    // On successful save old draft title/notes are retained while school remains the newly changed DB value
    const entries = await repos.journal.list();
    const updated = entries.find((e) => e.id === existing.id)!;
    expect(updated.title).toBe("First Lesson - Draft Edit");
    expect(updated.wentWell).toBe("Recovered straight and level");
    // Crucial check: stored school remains the newly changed DB value, not the stale displayed snapshot
    expect(updated.schoolName).toBe("Updated While Editing Center");
  });

  it("5. recovered new draft is not overwritten by discovery preset", async () => {
    // Existing unsaved new draft in localStorage
    writeDraft("journal.new", {
      date: "2026-10-12",
      title: "Unsaved Pre-solo Prep",
      aircraftType: "Piper Warrior",
      schoolName: "Golden Gate Flying",
      wentWell: "Steep turns were sharp",
    });

    await renderApp("/journal/new?mode=discovery");

    // Recovered draft must be preserved rather than overwritten by the discovery preset
    expect(screen.getByText(/Picked up where you left off/i)).toBeTruthy();

    // Discovery preset labels must be conditional on a fresh new draft (not recovered),
    // so resuming a prior training draft does not relabel it discovery
    expect(screen.getByRole("heading", { level: 1, name: "Log a training flight" })).toBeTruthy();
    expect(screen.getByText("Personal flight-time record")).toBeTruthy();
    expect(screen.getByText("Training flight")).toBeTruthy();

    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Unsaved Pre-solo Prep");

    const schoolInput = screen.getByLabelText("School") as HTMLInputElement;
    expect(schoolInput.value).toBe("Golden Gate Flying");

    const wentWellInput = screen.getByLabelText("What went well?") as HTMLInputElement;
    expect(wentWellInput.value).toBe("Steep turns were sharp");
  });

  it("6. rejects school names over 200 characters with a plain error and keeps draft", async () => {
    await renderApp("/journal/new");

    const tooLongSchool = "A".repeat(205);
    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: tooLongSchool },
    });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Solo Flight" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/School name cannot exceed 200 characters/i)).toBeTruthy();

    // Draft is kept intact for the student to correct
    const schoolInput = screen.getByLabelText("School") as HTMLInputElement;
    expect(schoolInput.value).toBe(tooLongSchool);
  });

  it("7. school-only change creates a new operation instead of replaying an old one", async () => {
    let capturedOperations: DebriefSaveOperation[] = [];
    const originalSave = testDb.saveDebriefAtomically;
    if (originalSave) {
      testDb.saveDebriefAtomically = async (op) => {
        capturedOperations.push(op);
        return originalSave.call(testDb, op);
      };
    }

    await renderApp("/journal/new");

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Touch and Go Practice" },
    });
    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "First Flight Academy" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    await waitFor(() => {
      expect(capturedOperations.length).toBe(1);
    });
    const firstOp = capturedOperations[0]!;
    expect(firstOp.journal.schoolName).toBe("First Flight Academy");

    // Wait for first successful save and detail navigation before cleanup/re-render
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Touch and Go Practice" })).toBeTruthy();
    });

    // Now edit only the school name on the saved entry
    cleanup();
    capturedOperations = [];
    await renderApp(`/journal/${firstOp.targetId}/edit`);

    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "Second Flight Academy" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => {
      expect(capturedOperations.length).toBe(1);
    });
    const secondOp = capturedOperations[0]!;
    expect(secondOp.journal.schoolName).toBe("Second Flight Academy");
    // New deliberate operation ID must be created
    expect(secondOp.operationId).not.toBe(firstOp.operationId);

    // Wait for second successful save and detail view
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Touch and Go Practice" })).toBeTruthy();
    });
  });

  it("8. school display and clear in detail and history", async () => {
    const repos = createRepositories(testDb);
    const entry = await repos.journal.create({
      date: "2026-10-01",
      title: "Scenic Intro Flight",
      aircraftType: "Diamond DA40",
      aircraftId: "N40DA",
      departureAirport: "KSQL",
      arrivalAirport: "KSQL",
      instructorName: "CFI Dan",
      schoolName: "Pacific Coast Aviation",
      totalTime: 1.2,
      dualReceived: 1.2,
      soloTime: null,
      picTime: null,
      crossCountryTime: null,
      nightTime: null,
      actualInstrumentTime: null,
      simulatedInstrumentTime: null,
      dayLandings: 2,
      nightLandings: null,
      mission: "Sightseeing intro",
      practiced: "Basic maneuvers",
      wentWell: "Clear skies",
      wasDifficult: "",
      instructorFeedback: "Natural feel for the aircraft",
      questionsForNextTime: "",
      confidence: 5,
    });

    // Check detail view
    await renderApp(`/journal/${entry.id}`);
    expect(screen.getByText("Pacific Coast Aviation")).toBeTruthy();

    // Check debriefs history view
    cleanup();
    await renderApp("/journal");
    fireEvent.click(screen.getByRole("button", { name: /Debriefs/i }));
    expect(screen.getByText(/Pacific Coast Aviation/)).toBeTruthy();

    // Clear school in editor
    cleanup();
    await renderApp(`/journal/${entry.id}/edit`);
    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Scenic Intro Flight" })).toBeTruthy();
    });

    // In detail view, school is no longer rendered
    expect(screen.queryByText("Pacific Coast Aviation")).toBeNull();
    const updated = (await repos.journal.list()).find((e) => e.id === entry.id)!;
    expect(updated.schoolName).toBeNull();
  });

  it("9. notes-only discovery entry is reachable in canonical history without inflating flight/time totals", async () => {
    const repos = createRepositories(testDb);
    await repos.profile.update({
      pilotName: "Audrey",
      aircraftType: "Cirrus SR20",
      instructorName: "CFI James",
      homeAirport: "KPAO",
      flightSchool: "Palo Alto Flight Center",
    });

    // Log a notes-only discovery flight via preset
    await renderApp("/journal/new?mode=discovery");
    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "Bay Area Flying Club" },
    });
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Loved flying around the bay at sunset." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Discovery flight" })).toBeTruthy();
    });

    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    const discovery = entries[0]!;
    expect(hasFlightLogData(discovery)).toBe(false);

    // Totals must remain ZERO because no flight log times or aircraft were entered
    const totals = flightLogTotals(entries);
    expect(totals.flights).toBe(0);
    expect(totals.totalTime).toBe(0);
    expect(totals.dualReceived).toBe(0);

    // Navigate to Flight Journal view
    cleanup();
    await renderApp("/journal");

    // Flight log tab shows 0 logged flights and informs user about notes without flight details
    expect(screen.getByText("0 logged")).toBeTruthy();
    expect(screen.getByText(/1 entry has notes without flight details/i)).toBeTruthy();

    // Click into debriefs to view the entry
    fireEvent.click(screen.getByRole("button", { name: /View in Debriefs/i }));
    expect(screen.getByText("Discovery flight")).toBeTruthy();
    expect(screen.getByText(/Bay Area Flying Club/)).toBeTruthy();
  });

  it("10. save rejection keeps school and notes visible and saved in draft, and retrying succeeds once restored", async () => {
    const repos = createRepositories(testDb);
    const originalSave = testDb.saveDebriefAtomically;

    // Simulate database failure on debrief save
    testDb.saveDebriefAtomically = async () => {
      throw new Error("Simulated storage/network write failure");
    };

    await renderApp("/journal/new?mode=discovery");

    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "Rejection Flight Academy" },
    });
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Crosswind correction was smooth." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    // Alert error message is shown
    expect(screen.getByRole("alert")).toBeTruthy();

    // School and notes remain visible in the form
    const schoolInput = screen.getByLabelText("School") as HTMLInputElement;
    expect(schoolInput.value).toBe("Rejection Flight Academy");
    const wentWellInput = screen.getByLabelText("What went well?") as HTMLInputElement;
    expect(wentWellInput.value).toBe("Crosswind correction was smooth.");

    // Saved in draft via exact draft helper API
    const persistedDraft = readDraft<{ schoolName?: string; wentWell?: string }>("journal.new");
    expect(persistedDraft).not.toBeNull();
    expect(persistedDraft?.schoolName).toBe("Rejection Flight Academy");
    expect(persistedDraft?.wentWell).toBe("Crosswind correction was smooth.");

    // No new DB row created on rejection
    const entriesOnFail = await repos.journal.list();
    expect(entriesOnFail.length).toBe(0);

    // Restore real saver and retry
    testDb.saveDebriefAtomically = originalSave;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Discovery flight" })).toBeTruthy();
    });

    // Successfully saved on retry
    const entriesAfterRetry = await repos.journal.list();
    expect(entriesAfterRetry.length).toBe(1);
    expect(entriesAfterRetry[0]!.schoolName).toBe("Rejection Flight Academy");
    expect(entriesAfterRetry[0]!.wentWell).toBe("Crosswind correction was smooth.");
  });

  it("11. captures failed first atomic save operation, retains pending draft, changes ONLY school, retries with new operationId and same targetId, and persists exactly one row", async () => {
    const repos = createRepositories(testDb);
    const originalSave = testDb.saveDebriefAtomically;
    if (!originalSave) throw new Error("Atomic test saver is unavailable");

    const capturedOperations: DebriefSaveOperation[] = [];

    // Simulate failure on initial debrief save while capturing the requested operation
    testDb.saveDebriefAtomically = async (op: DebriefSaveOperation) => {
      capturedOperations.push(op);
      throw new Error("Simulated storage failure on first attempt");
    };

    await renderApp("/journal/new?mode=discovery");

    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "Initial Flight Academy" },
    });
    fireEvent.change(screen.getByLabelText("What went well?"), {
      target: { value: "Stall recovery was smooth and prompt." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    // Alert error is displayed
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(capturedOperations.length).toBe(1);
    const firstOp = capturedOperations[0]!;

    // Draft retained in storage with pendingOperation
    const pendingDraft = readDraft<any>("journal.new");
    expect(pendingDraft).not.toBeNull();
    expect(pendingDraft?.pendingOperation).toBeTruthy();
    expect(pendingDraft?.pendingOperation.id).toBe(firstOp.operationId);
    expect(pendingDraft?.schoolName).toBe("Initial Flight Academy");

    // Change ONLY School
    fireEvent.change(screen.getByLabelText("School"), {
      target: { value: "Updated Aviation Center" },
    });

    // Restore real save behavior while recording subsequent operations
    testDb.saveDebriefAtomically = async (op: DebriefSaveOperation) => {
      capturedOperations.push(op);
      return originalSave.call(testDb, op);
    };

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Discovery flight" })).toBeTruthy();
    });

    expect(capturedOperations.length).toBe(2);
    const retryOp = capturedOperations[1]!;

    // Assert a new operationId was generated because schoolName changed
    expect(retryOp.operationId).not.toBe(firstOp.operationId);

    // Assert targetId, title, and notes are unchanged
    expect(retryOp.targetId).toBe(firstOp.targetId);
    expect(retryOp.journal.title).toBe(firstOp.journal.title);
    expect(retryOp.journal.wentWell).toBe(firstOp.journal.wentWell);
    expect(retryOp.journal.wentWell).toBe("Stall recovery was smooth and prompt.");

    // Assert school changed
    expect(firstOp.journal.schoolName).toBe("Initial Flight Academy");
    expect(retryOp.journal.schoolName).toBe("Updated Aviation Center");

    // Exactly one DB row exists with the new School
    const entries = await repos.journal.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe(retryOp.targetId);
    expect(entries[0]!.schoolName).toBe("Updated Aviation Center");
    expect(entries[0]!.title).toBe("Discovery flight");
    expect(entries[0]!.wentWell).toBe("Stall recovery was smooth and prompt.");
  });

  it("12. deferred real atomic save preserves queued school change delivered during flight, avoids discarding draft, and persists newer school on second save", async () => {
    const repos = createRepositories(testDb);
    const originalSave = testDb.saveDebriefAtomically;
    if (!originalSave) throw new Error("Atomic test saver is unavailable");

    let releaseFirstSave!: () => void;
    const firstSaveDeferred = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });

    let saveCallCount = 0;
    const capturedOperations: DebriefSaveOperation[] = [];

    testDb.saveDebriefAtomically = async (op: DebriefSaveOperation) => {
      saveCallCount += 1;
      capturedOperations.push(op);
      if (saveCallCount === 1) {
        await firstSaveDeferred;
      }
      return originalSave.call(testDb, op);
    };

    try {
      await renderApp("/journal/new?mode=discovery");

      fireEvent.change(screen.getByLabelText("School"), {
        target: { value: "First In-Flight School" },
      });
      fireEvent.change(screen.getByLabelText("What went well?"), {
        target: { value: "Holding altitude on steep turns." },
      });

      // Submit the form to trigger the in-flight atomic save
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
      });

      expect(saveCallCount).toBe(1);

      // While save is pending, deliver a School change as a queued change event
      // modeling an edit arriving across the save boundary
      const schoolInput = screen.getByLabelText("School") as HTMLInputElement;
      fireEvent.change(schoolInput, {
        target: { value: "Newer Queued School" },
      });

      // Release the first save
      await act(async () => {
        releaseFirstSave();
      });

      // The save resolved, but because hasUnsavedEdits detected the newer School edit,
      // the page must NOT navigate away to detail view, nor discard the newer edit.
      expect(screen.queryByRole("heading", { level: 1, name: "Discovery flight" })).toBeNull();
      expect(schoolInput.value).toBe("Newer Queued School");
      expect(screen.getByRole("button", { name: "Save flight record" })).toBeTruthy();

      // Persist the second save with the newer School
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save flight record" }));
      });

      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 1, name: "Discovery flight" })).toBeTruthy();
      });

      expect(saveCallCount).toBe(2);
      expect(capturedOperations.length).toBe(2);

      // Exactly one row exists in the database, with the newer school
      const entries = await repos.journal.list();
      expect(entries.length).toBe(1);
      expect(entries[0]!.schoolName).toBe("Newer Queued School");
      expect(entries[0]!.wentWell).toBe("Holding altitude on steep turns.");
    } finally {
      // Ensure cleanup cannot leave promises pending
      releaseFirstSave();
      testDb.saveDebriefAtomically = originalSave;
    }
  });
});
