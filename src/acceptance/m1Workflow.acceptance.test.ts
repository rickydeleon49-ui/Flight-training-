// @vitest-environment jsdom
/**
 * M1 D7 acceptance — the Daily Flight Plan and debrief workflow, end to end.
 *
 * Kind of test: **UI integration.** Real pages (Flight Deck, journal form and
 * detail, Study Library material, lesson detail, Questions) render under the
 * real AppDataProvider against a real SQLite file (node:sqlite, the same
 * migrations as the desktop app). The database file is closed and reopened to
 * stand in for an app restart. It does not run the Tauri shell. The Rust tests
 * cover document storage, naming and path validation, the Open/Reveal scope,
 * and the native debrief command, but no test here or there exercises an OS
 * file picker, opening a PDF viewer, or Explorer/Finder behaviour (see
 * docs/M1_D7_ACCEPTANCE_2026-09-27.md).
 *
 * Offline (frontend only): `fetch` and `XMLHttpRequest` are replaced with
 * recorders, and the workflow must make zero calls to either. Nothing here
 * configures or calls Gemini. This says nothing about native networking.
 *
 * Data is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DebriefSaveOperation } from "@/data/db";
import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { addDays, todayIso } from "@/lib/dates";
import { FlightDeck } from "@/pages/FlightDeck/FlightDeck";
import { JournalEntryDetail } from "@/pages/FlightJournal/JournalEntryDetail";
import { JournalForm } from "@/pages/FlightJournal/JournalForm";
import { Questions } from "@/pages/Questions/Questions";
import { EventDetail } from "@/pages/Schedule/EventDetail";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

// --- Frontend network guard (fetch / XMLHttpRequest only) ---------------
const networkCalls: string[] = [];
const originalFetch = globalThis.fetch;
const OriginalXhr = globalThis.XMLHttpRequest;
beforeAll(() => {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    networkCalls.push(`fetch ${String(input)}`);
    return Promise.reject(new Error("offline"));
  }) as typeof fetch;
  globalThis.XMLHttpRequest = class {
    open(_method: string, url: string) {
      networkCalls.push(`xhr ${url}`);
      throw new Error("offline");
    }
  } as unknown as typeof XMLHttpRequest;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = OriginalXhr;
});

// --- Harness -------------------------------------------------------------
let dir: string;
let repos: Repositories;
let context: ReturnType<typeof useAppData>;
let navigate: ReturnType<typeof useNavigate>;
let captured: DebriefSaveOperation[];
let failNextDebriefSave = false;

async function openDatabase() {
  db = await createNodeSqliteDatabase(join(dir, "her-flight-deck.db"));
  repos = createRepositories(db);
  const commit = db.saveDebriefAtomically!.bind(db);
  db.saveDebriefAtomically = async (operation) => {
    captured.push(JSON.parse(JSON.stringify(operation)) as DebriefSaveOperation);
    if (failNextDebriefSave) {
      failNextDebriefSave = false;
      throw new Error("disk I/O error");
    }
    await commit(operation);
  };
}

function Probe() {
  context = useAppData();
  navigate = useNavigate();
  return null;
}
function Pages() {
  const { status } = useAppData();
  if (status !== "ready") return null;
  return h(
    Routes,
    null,
    h(Route, { path: "/", element: h(FlightDeck) }),
    h(Route, { path: "/journal/new", element: h(JournalForm) }),
    h(Route, { path: "/journal/:entryId/edit", element: h(JournalForm) }),
    h(Route, { path: "/journal/:entryId", element: h(JournalEntryDetail) }),
    h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
    h(Route, { path: "/schedule/:eventId", element: h(EventDetail) }),
    h(Route, { path: "/questions", element: h(Questions) }),
    h(Route, { path: "*", element: h("p", null, "Elsewhere") }),
  );
}

async function launch(path = "/") {
  const view = render(
    h(AppDataProvider, null, h(MemoryRouter, { initialEntries: [path] }, h(Probe), h(Pages))),
  );
  await waitFor(() => expect(context.status).toBe("ready"));
  return view;
}

async function go(path: string) {
  await act(async () => {
    navigate(path);
  });
}

beforeEach(async () => {
  localStorage.clear();
  captured = [];
  failNextDebriefSave = false;
  dir = mkdtempSync(join(tmpdir(), "hfd-m1-acceptance-"));
  await openDatabase();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// --- Synthetic training history ------------------------------------------
const today = todayIso();
const lessonDate = addDays(today, 3);

async function seedTrainingHistory() {
  await repos.app.set("airline_starter_pack", "skipped-for-tests");
  const material = await repos.documents.create({
    title: "Synthetic Handbook — Steep Turns",
    topic: "aerodynamics",
    materialType: "reference",
    filePath: "synthetic-steep-turns.pdf",
    originalFileName: "synthetic-steep-turns.pdf",
    fileSize: 2048,
  });
  const lesson = await repos.schedule.create({
    eventType: "flight_lesson",
    date: lessonDate,
    title: "Lesson 9 — Steep turns and slow flight",
    status: "scheduled",
  });
  const history = await repos.journal.create({
    date: addDays(today, -4),
    title: "Lesson 8 — Pattern work",
    aircraftType: "C172S",
    aircraftId: "N0000X",
    totalTime: 1.3,
    dualReceived: 1.3,
    dayLandings: 6,
    wentWell: "Radio calls",
    wasDifficult: "Flare timing",
  });
  const studyAction = await repos.actions.create({
    title: "Read the steep turn chapter",
    dueDate: today,
    estimatedMinutes: 10,
    relatedType: "material",
    relatedId: material.id,
  });
  const skippable = await repos.actions.create({
    title: "Update the logbook totals",
    dueDate: today,
    estimatedMinutes: 5,
  });
  const oldQuestion = await repos.questions.create({ text: "When do we start night work?" });
  return { material, lesson, history, studyAction, skippable, oldQuestion };
}

describe("M1 D7 acceptance: Daily Flight Plan and debrief workflow", () => {
  it("runs the whole workflow, survives a restart, retries safely, and stays honest after deletions", async () => {
    const seed = await seedTrainingHistory();
    await launch("/");

    // 1. Daily Flight Plan: budget, explanation, skip, Start.
    const plan = await screen.findByText("Daily Flight Plan");
    const card = plan.closest(".daily-plan-card") as HTMLElement;
    await within(card).findByText("Read the steep turn chapter");
    fireEvent.click(within(card).getByRole("radio", { name: "30 min" }));
    await waitFor(async () => expect((await repos.app.getDailyPlanState())?.timeBudget).toBe(30));
    fireEvent.click(within(card).getByRole("button", { name: "Why recommend Read the steep turn chapter?" }));
    expect(within(card).getByText("Reason")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Skip Update the logbook totals for today" }));
    await waitFor(async () =>
      expect((await repos.app.getDailyPlanState())?.decisions[`action:${seed.skippable.id}`]?.type).toBe("skip"),
    );
    await act(async () => {
      fireEvent.click(within(card).getByRole("link", { name: "Start study material for Read the steep turn chapter" }));
    });
    await screen.findByRole("heading", { name: "Synthetic Handbook — Steep Turns" });

    // 2. Quick debrief: improvement → edited action with material; edited question → upcoming lesson.
    await go("/journal/new?mode=quick");
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Lesson 9 prep flight" } });
    fireEvent.change(screen.getByLabelText("What was difficult?"), { target: { value: "Losing altitude in steep turns" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), { target: { value: "How much back pressure?" } });
    fireEvent.click(screen.getByRole("button", { name: /Turn “What was difficult” into action/i }));
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Chair-fly steep turns with pitch reference" },
    });
    fireEvent.click(screen.getByLabelText(/to your Flight Plan/i));
    fireEvent.change(screen.getAllByLabelText("Related study material")[0]!, { target: { value: seed.material.id } });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));
    fireEvent.change(screen.getByLabelText("Question to ask your instructor"), {
      target: { value: "How much back pressure holds altitude at 45° bank?" },
    });
    fireEvent.change(screen.getByLabelText("Carry to upcoming lesson"), { target: { value: seed.lesson.id } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await screen.findByText("Lesson 9 prep flight");
    expect(captured).toHaveLength(1);
    const acceptance = captured[0]!;
    const debriefId = acceptance.targetId;
    const actionId = acceptance.action!.id;
    const questionId = acceptance.question!.id;

    // 3. The action appears with its material; the question in lesson preparation.
    await go(`/study/${seed.material.id}?tab=notes`);
    await screen.findByText("Chair-fly steep turns with pitch reference");
    await go(`/schedule/${seed.lesson.id}`);
    await screen.findByText("Ask: How much back pressure holds altitude at 45° bank?");

    // 4. Quick-editing an older flight leaves its flight log intact in the full editor.
    await go(`/journal/${seed.history.id}/edit?mode=quick`);
    fireEvent.change(await screen.findByLabelText("What went well?"), { target: { value: "Radio calls and checklists" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    await screen.findByText("Lesson 8 — Pattern work");
    await go(`/journal/${seed.history.id}/edit`);
    expect((await screen.findByLabelText("Total flight time") as HTMLInputElement).value).toBe("1.3");
    expect((screen.getByLabelText("Dual received") as HTMLInputElement).value).toBe("1.3");
    const saved = await repos.journal.get(seed.history.id);
    expect(saved).toMatchObject({ aircraftType: "C172S", aircraftId: "N0000X", totalTime: 1.3, dayLandings: 6, wentWell: "Radio calls and checklists" });

    // 5. Complete the action and answer the question, through the UI.
    await go(`/journal/${debriefId}`);
    fireEvent.click(await screen.findByLabelText(/^Chair-fly steep turns with pitch reference/));
    await waitFor(async () => expect((await repos.actions.list()).find((a) => a.id === actionId)?.status).toBe("completed"));
    await go("/questions");
    const questionRow = (await screen.findByText("How much back pressure holds altitude at 45° bank?")).closest(".question-row") as HTMLElement;
    fireEvent.click(within(questionRow).getByRole("button", { name: "Add answer" }));
    fireEvent.change(within(questionRow).getByLabelText("Answer"), { target: { value: "Increase back pressure as you roll in; add power." } });
    await act(async () => {
      fireEvent.click(within(questionRow).getByRole("button", { name: "Save answer" }));
    });
    await waitFor(async () => expect((await repos.questions.get(questionId))?.status).toBe("answered"));

    // 6. Retrying the original acceptance changes nothing she did afterwards.
    const ledgerBefore = await db.select("SELECT id FROM debrief_operations ORDER BY id");
    expect(ledgerBefore).toContainEqual({ id: acceptance.operationId });
    await db.saveDebriefAtomically!(acceptance);
    const action = (await repos.actions.list()).find((a) => a.id === actionId)!;
    expect(action).toMatchObject({ status: "completed", materialId: seed.material.id, title: "Chair-fly steep turns with pitch reference" });
    expect(await repos.questions.get(questionId)).toMatchObject({
      status: "answered",
      answer: "Increase back pressure as you roll in; add power.",
      eventId: seed.lesson.id,
    });
    expect(await db.select("SELECT id FROM debrief_operations ORDER BY id")).toEqual(ledgerBefore);

    // 7. Restart: close and reopen the database file.
    cleanup();
    db.close();
    await openDatabase();
    await launch("/");
    const planAfter = (await screen.findByText("Daily Flight Plan")).closest(".daily-plan-card") as HTMLElement;
    await waitFor(() =>
      expect(within(planAfter).getByRole("radio", { name: "30 min" }).getAttribute("aria-checked")).toBe("true"),
    );
    expect(within(planAfter).queryByRole("button", { name: "Skip Update the logbook totals for today" })).toBeNull();
    expect(within(planAfter).getAllByRole("button", { name: /Reset today's skips/ }).length).toBeGreaterThan(0);
    await go(`/journal/${debriefId}`);
    expect(await screen.findByText(/Material: Synthetic Handbook — Steep Turns/)).toBeTruthy();
    expect(screen.getByText(/Lesson: Lesson 9 — Steep turns and slow flight/)).toBeTruthy();
    expect((await repos.journal.list()).map((entry) => entry.title).sort()).toEqual(["Lesson 8 — Pattern work", "Lesson 9 prep flight"]);

    // 8. Deleting the linked material and lesson keeps her history and says so honestly.
    await repos.documents.remove(seed.material.id);
    await repos.schedule.remove(seed.lesson.id);
    await act(async () => {
      await context.refresh();
    });
    await go("/questions");
    await screen.findByText("How much back pressure holds altitude at 45° bank?");
    // The question was carried to the lesson but never linked to a material:
    // only the lesson is reported as deleted.
    expect(screen.queryByText("Source material unavailable")).toBeNull();
    expect(screen.getAllByText("Source lesson unavailable")).toHaveLength(1);
    expect(screen.getByText("When do we start night work?")).toBeTruthy();
    await go(`/journal/${debriefId}`);
    expect(await screen.findByText("Material: Source material unavailable")).toBeTruthy();
    expect((await repos.actions.list()).find((a) => a.id === actionId)?.status).toBe("completed");
    expect((await repos.questions.get(questionId))?.answer).toBe("Increase back pressure as you roll in; add power.");

    // No fetch or XMLHttpRequest call was made during the workflow.
    expect(networkCalls).toEqual([]);
  });

  it("keeps her input after cancelling or a failed save, and never reports a false success", async () => {
    await seedTrainingHistory();
    await launch("/");
    await go("/journal/new?mode=quick");

    // Cancel: the draft is kept and offered back.
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Unsaved solo debrief" } });
    fireEvent.change(screen.getByLabelText("What was difficult?"), { target: { value: "Crosswind on 31" } });
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    });
    await go("/journal/new?mode=quick");
    expect(await screen.findByText(/Picked up where you left off/)).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Unsaved solo debrief");
    expect(await repos.journal.list()).toHaveLength(1); // only the seeded history

    // A failed save: an error, the input stays, no navigation, nothing written.
    failNextDebriefSave = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    expect(await screen.findByText(/Unable to save debrief right now/)).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Unsaved solo debrief");
    expect((screen.getByLabelText("What was difficult?") as HTMLTextAreaElement).value).toBe("Crosswind on 31");
    expect(screen.queryByText("Elsewhere")).toBeNull();
    expect(await repos.journal.list()).toHaveLength(1);

    // Trying again succeeds.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
    await screen.findByText("Unsaved solo debrief");
    expect(await repos.journal.list()).toHaveLength(2);
    expect(networkCalls).toEqual([]);
  });
});
