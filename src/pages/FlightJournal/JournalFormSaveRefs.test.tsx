// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import type { DebriefSaveOperation } from "@/data/db";
import { writeDraft } from "@/lib/drafts";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { JournalForm } from "./JournalForm";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
vi.mock("@/logic/nightHint", async (original) => ({
  ...await original<typeof import("@/logic/nightHint")>(),
  loadAirportIndex: async () => ({}),
  nightHint: () => null,
}));

function Ready() {
  return useAppData().status === "ready" ? <JournalForm /> : null;
}
async function open() {
  render(<AppDataProvider><MemoryRouter initialEntries={["/journal/new?mode=quick"]}>
    <Routes>
      <Route path="/journal/new" element={<Ready />} />
      <Route path="/journal/:entryId" element={<p>Saved entry page</p>} />
    </Routes>
  </MemoryRouter></AppDataProvider>);
  await screen.findByRole("tablist", { name: "Debrief editor mode" });
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" })); });
async function counts() {
  const n = async (table: string) => (await db.select<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`))[0]!.c;
  return { entries: await n("journal_entries"), actions: await n("next_actions"), questions: await n("questions") };
}
/** Wrap the real atomic save so tests can fail or hold it while still writing to the database. */
function wrapSave(behave: (call: number, op: DebriefSaveOperation) => Promise<void> | void) {
  const real = db.saveDebriefAtomically!.bind(db);
  const ops: DebriefSaveOperation[] = [];
  vi.spyOn(db, "saveDebriefAtomically").mockImplementation(async (op: DebriefSaveOperation) => {
    ops.push(op);
    await behave(ops.length, op);
    return real(op);
  });
  return ops;
}

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-tests");
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

it("a recovered draft loads with its saved ids and saves once under them", async () => {
  writeDraft("journal.new", {
    id: "synthetic-entry-1", date: "2026-01-05", title: "Recovered synthetic lesson",
    wentWell: "Recovered note", nextActionTitle: "Review synthetic flare timing",
    createdActionId: "synthetic-action-1", questionsForNextTime: "Synthetic recovered question?",
    questionToSave: "Synthetic recovered question?", questionEdited: true, createdQuestionId: "synthetic-question-1",
  });
  const ops = wrapSave(() => undefined);
  await open();
  expect(await screen.findByRole("status")).toBeTruthy(); // the "Picked up where you left off" note
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Recovered synthetic lesson");
  fireEvent.click(screen.getByRole("checkbox", { name: /Review synthetic flare timing/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Save an instructor question/ }));
  await save();
  await screen.findByText("Saved entry page");
  expect(ops).toHaveLength(1);
  expect(ops[0]!.targetId).toBe("synthetic-entry-1");
  expect(ops[0]!.action?.id).toBe("synthetic-action-1");
  expect(ops[0]!.question?.id).toBe("synthetic-question-1");
  expect(await counts()).toEqual({ entries: 1, actions: 1, questions: 1 });
});

it("retrying after a failed save reuses the first attempt's ids and creates no duplicates", async () => {
  const ops = wrapSave((call) => { if (call === 1) throw new Error("Synthetic save failure"); });
  await open();
  type("Title", "Synthetic retry lesson");
  type("Questions for next time", "Synthetic retry question?");
  type("Because of this lesson, what should you do next?", "Synthetic retry action");
  fireEvent.click(screen.getByRole("checkbox", { name: /Synthetic retry action/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Save an instructor question/ }));
  await save();
  await screen.findByRole("alert");
  expect(await counts()).toEqual({ entries: 0, actions: 0, questions: 0 });
  await save();
  await screen.findByText("Saved entry page");
  expect(ops).toHaveLength(2);
  expect(ops[1]!.targetId).toBe(ops[0]!.targetId);
  expect(ops[1]!.action!.id).toBe(ops[0]!.action!.id);
  expect(ops[1]!.question!.id).toBe(ops[0]!.question!.id);
  expect(await counts()).toEqual({ entries: 1, actions: 1, questions: 1 });
});

it("an edit typed while a save is pending is kept, then saved onto the same records", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ops = wrapSave((call) => (call === 1 ? held : undefined));
  await open();
  type("Title", "Synthetic pending lesson");
  type("What went well?", "First draft of the note");
  type("Because of this lesson, what should you do next?", "Synthetic pending action");
  fireEvent.click(screen.getByRole("checkbox", { name: /Synthetic pending action/ }));
  await save();
  await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy());
  type("What went well?", "Edited while saving");
  await act(async () => { release(); });
  // The newer text is neither lost nor navigated away from.
  await waitFor(() => expect(screen.getByRole("button", { name: "Save quick debrief" })).toBeTruthy());
  expect((screen.getByLabelText("What went well?") as HTMLTextAreaElement).value).toBe("Edited while saving");
  expect(screen.queryByText("Saved entry page")).toBeNull();
  await save();
  await screen.findByText("Saved entry page");
  expect(ops).toHaveLength(2);
  expect(ops[0]!.journal.wentWell).toBe("First draft of the note");
  expect(ops[1]!.journal.wentWell).toBe("Edited while saving");
  expect(ops[1]!.targetId).toBe(ops[0]!.targetId);
  expect(ops[1]!.action!.id).toBe(ops[0]!.action!.id);
  expect(await counts()).toEqual({ entries: 1, actions: 1, questions: 0 });
  const [row] = await createRepositories(db).journal.list();
  expect(row!.wentWell).toBe("Edited while saving");
});
