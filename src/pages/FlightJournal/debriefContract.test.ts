// @vitest-environment jsdom
/**
 * The debrief-save contract, from the real form to both implementations.
 *
 * Part 1 drives the real JournalForm and captures each operation exactly as
 * the form hands it to the database driver (the same object the Tauri adapter
 * passes to `invoke("save_debrief_operation", { operation })`). Generated ids
 * and the date are normalized, and the result must equal the checked-in
 * fixtures in `src-tauri/fixtures/debrief-contract/`. The Rust tests
 * deserialize those same files into `DebriefSaveOperation` (which rejects
 * unknown fields) and run them through the native transaction.
 *
 * Part 2 runs the fixtures through the browser/test transaction and compares
 * the persisted rows with `expected.json`, which the Rust test compares too,
 * so both implementations must produce the same rows.
 *
 * Regenerate after an intentional contract change:
 *   UPDATE_DEBRIEF_FIXTURES=1 npx vitest run src/pages/FlightJournal/debriefContract.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DebriefSaveOperation } from "@/data/db";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { JournalForm } from "@/pages/FlightJournal/JournalForm";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

const FIXTURES = join(process.cwd(), "src-tauri", "fixtures", "debrief-contract");
const UPDATE = process.env.UPDATE_DEBRIEF_FIXTURES === "1";
const STEPS = ["01-create", "02-update", "03-withdraw-action", "04-withdraw-question"] as const;

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

afterEach(() => {
  cleanup();
  db.close();
});

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), "utf8").replace(/\r\n/g, "\n");
}

function writeOrCompare(name: string, value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (UPDATE) {
    if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(join(FIXTURES, `${name}.json`), text);
    return;
  }
  expect(text, `${name}.json no longer matches; see the header of this test`).toBe(fixture(name));
}

/** Replace generated ids and today's date with stable placeholders, by first appearance. */
function normalizer() {
  const names = new Map<string, string>();
  const counters: Record<string, number> = {};
  const name = (kind: string, id: string | null | undefined) => {
    if (!id) return id ?? null;
    const key = `${kind}:${id}`;
    if (!names.has(key)) {
      counters[kind] = (counters[kind] ?? 0) + 1;
      names.set(key, `${kind}-${counters[kind]}`);
    }
    return names.get(key)!;
  };
  return (op: DebriefSaveOperation): DebriefSaveOperation => ({
    ...op,
    operationId: name("operation", op.operationId)!,
    targetId: name("journal", op.targetId)!,
    journal: {
      ...op.journal,
      date: "2026-09-26",
      eventId: name("event", op.journal.eventId),
      goalId: name("goal", op.journal.goalId),
      materialIds: (op.journal.materialIds ?? []).map((id) => name("material", id)!),
    },
    action: op.action
      ? { ...op.action, id: name("action", op.action.id)!, materialId: name("material", op.action.materialId) }
      : null,
    withdrawActionId: name("action", op.withdrawActionId),
    question: op.question
      ? {
          ...op.question,
          id: name("question", op.question.id)!,
          eventId: name("event", op.question.eventId),
          materialId: name("material", op.question.materialId),
        }
      : null,
    withdrawQuestionId: name("question", op.withdrawQuestionId),
  });
}

describe("debrief contract: payloads captured from the real form", () => {
  let captured: DebriefSaveOperation[];
  let loseResponse: boolean;

  beforeEach(async () => {
    localStorage.clear();
    captured = [];
    loseResponse = true;
    db = await createNodeSqliteDatabase();
    const commit = db.saveDebriefAtomically!.bind(db);
    // Capture exactly what the form sends, commit it, then (while
    // `loseResponse` is set) lose the response so the form stays on the draft.
    db.saveDebriefAtomically = async (operation) => {
      captured.push(JSON.parse(JSON.stringify(operation)) as DebriefSaveOperation);
      await commit(operation);
      if (loseResponse) throw new Error("The response was lost after the commit.");
    };
  });

  let context: ReturnType<typeof useAppData>;
  function Probe() {
    context = useAppData();
    return null;
  }
  function Ready() {
    const { status } = useAppData();
    return status === "ready"
      ? h(Routes, null,
          h(Route, { path: "/journal/new", element: h(JournalForm) }),
          h(Route, { path: "*", element: h("p", null, "Saved") }))
      : null;
  }

  async function save() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save quick debrief" }));
    });
  }

  it("create, lost-response retry, deliberate edit, and both withdrawals", async () => {
    const repos = createRepositories(db);
    await repos.app.set("airline_starter_pack", "skipped-for-tests");
    const material = await repos.documents.create({ title: "Airplane Flying Handbook Ch. 8", topic: "aerodynamics", materialType: "reference" });
    await db.execute(
      `INSERT INTO schedule_events (id, title, event_type, date, status, created_at, updated_at)
       VALUES ('lesson-x', 'Crosswind landings', 'flight_lesson', '2099-01-10', 'scheduled', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')`,
    );

    render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/journal/new?mode=quick"] }, h(Probe), h(Ready))));
    await waitFor(() => expect(context.status).toBe("ready"));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Crosswind practice" } });
    fireEvent.change(screen.getByLabelText("What was difficult?"), { target: { value: "Drifting left in the flare" } });
    fireEvent.change(screen.getByLabelText("Questions for next time"), { target: { value: "How much aileron in a gust?" } });
    fireEvent.click(screen.getByRole("button", { name: /Turn “What was difficult” into action/i }));
    fireEvent.click(screen.getByLabelText(/to your Flight Plan/i));
    const [actionMaterial] = screen.getAllByLabelText("Related study material");
    fireEvent.change(actionMaterial!, { target: { value: material.id } });
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));
    fireEvent.change(screen.getByLabelText("Carry to upcoming lesson"), { target: { value: "lesson-x" } });
    fireEvent.change(screen.getAllByLabelText("Related study material")[1]!, { target: { value: material.id } });

    // 1. Create — committed, but the response is lost.
    await save();
    await screen.findByText(/Unable to save debrief right now/);

    // Retry with nothing changed: the same operation id, so the database ignores it.
    await save();
    expect(captured).toHaveLength(2);
    expect(captured[1]).toEqual(captured[0]);

    // 2. Deliberate edit of the accepted action and question.
    fireEvent.change(screen.getByLabelText("Because of this lesson, what should you do next?"), {
      target: { value: "Practice crosswind flare with rudder" },
    });
    fireEvent.change(screen.getByLabelText("Question to ask your instructor"), {
      target: { value: "How much aileron should I hold in a 15-knot gust?" },
    });
    await save();

    // 3. Withdraw the action; 4. then the question.
    fireEvent.click(screen.getByLabelText(/to your Flight Plan/i));
    await save();
    loseResponse = false;
    fireEvent.click(screen.getByLabelText(/Save an instructor question to the Questions list/i));
    await save();
    await screen.findByText("Saved");

    // Every operation has exactly the canonical keys: no isNew, no journal.id.
    for (const op of captured) {
      expect(Object.keys(op).sort()).toEqual(
        ["action", "journal", "operationId", "question", "targetId", "withdrawActionId", "withdrawQuestionId"],
      );
      expect(op.journal).not.toHaveProperty("id");
    }
    const distinct = [captured[0]!, captured[2]!, captured[3]!, captured[4]!];
    expect(new Set(distinct.map((op) => op.operationId)).size).toBe(4);

    const normalize = normalizer();
    distinct.forEach((op, index) => writeOrCompare(STEPS[index]!, normalize(op)));
  });
});

/** The rows both implementations must produce, excluding timestamps. */
async function snapshot(database: TestDatabase) {
  return {
    journal: await database.select(
      `SELECT id, date, title, event_id, was_difficult, questions_for_next_time
         FROM journal_entries ORDER BY id`,
    ),
    journalMaterials: await database.select(
      "SELECT journal_id, material_id FROM journal_materials ORDER BY journal_id, material_id",
    ),
    actions: await database.select(
      `SELECT id, title, description, category, priority, status, due_date, estimated_minutes,
              related_type, related_id, material_id, source_material_id, completed_at
         FROM next_actions ORDER BY id`,
    ),
    questions: await database.select(
      `SELECT id, text, topic, status, answer, answered_at, event_id, material_id, journal_id,
              source_event_id, source_material_id, source_journal_id
         FROM questions ORDER BY id`,
    ),
    operations: await database.select("SELECT id, journal_id FROM debrief_operations ORDER BY id"),
  };
}

/** Seed and later-progress SQL, identical in the Rust test. */
export const SEED_SQL = [
  `INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
   VALUES ('material-1', 'Airplane Flying Handbook Ch. 8', 'reference', 'aerodynamics', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')`,
  `INSERT INTO schedule_events (id, title, event_type, date, status, created_at, updated_at)
   VALUES ('event-1', 'Crosswind landings', 'flight_lesson', '2099-01-10', 'scheduled', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')`,
];
const PROGRESS_SQL = [
  `UPDATE next_actions SET status = 'completed', completed_at = '2026-09-27T10:00:00.000Z',
          priority = 'important', due_date = '2026-10-01', estimated_minutes = 25,
          description = 'Flew it twice with my instructor' WHERE id = 'action-1'`,
  `UPDATE questions SET status = 'answered', answer = 'Hold it into the wind, more as you slow',
          answered_at = '2026-09-27T10:05:00.000Z', topic = 'aerodynamics' WHERE id = 'question-1'`,
];

describe("debrief contract: both implementations persist the same rows", () => {
  it("replays the captured fixtures through the browser transaction", async () => {
    db = await createNodeSqliteDatabase();
    for (const sql of SEED_SQL) await db.execute(sql);
    const op = (name: string) => JSON.parse(fixture(name)) as DebriefSaveOperation;
    const expected: Record<string, unknown> = {};

    await db.saveDebriefAtomically!(op("01-create"));
    expected.afterCreate = await snapshot(db);

    // Later work on the accepted action and question, then a replay of the
    // original operation (a retry after a lost response): nothing is undone.
    for (const sql of PROGRESS_SQL) await db.execute(sql);
    await db.saveDebriefAtomically!(op("01-create"));
    expected.afterProgressAndReplay = await snapshot(db);

    await db.saveDebriefAtomically!(op("02-update"));
    expected.afterUpdate = await snapshot(db);
    await db.saveDebriefAtomically!(op("03-withdraw-action"));
    expected.afterWithdrawAction = await snapshot(db);
    await db.saveDebriefAtomically!(op("04-withdraw-question"));
    expected.afterWithdrawQuestion = await snapshot(db);

    // The semantics, spelled out rather than only snapshotted.
    const replayed = expected.afterProgressAndReplay as Awaited<ReturnType<typeof snapshot>>;
    expect(replayed.actions[0]).toMatchObject({ status: "completed", priority: "important", due_date: "2026-10-01", estimated_minutes: 25 });
    expect(replayed.questions[0]).toMatchObject({ status: "answered", answer: "Hold it into the wind, more as you slow" });
    const updated = expected.afterUpdate as Awaited<ReturnType<typeof snapshot>>;
    expect(updated.actions[0]).toMatchObject({
      title: "Practice crosswind flare with rudder",
      status: "completed",
      priority: "important",
      due_date: "2026-10-01",
      estimated_minutes: 25,
      description: "Flew it twice with my instructor",
    });
    expect(updated.questions[0]).toMatchObject({
      text: "How much aileron should I hold in a 15-knot gust?",
      status: "answered",
      answer: "Hold it into the wind, more as you slow",
      topic: "aerodynamics",
    });
    const final = expected.afterWithdrawQuestion as Awaited<ReturnType<typeof snapshot>>;
    expect(final.actions).toEqual([]);
    expect(final.questions).toEqual([]);
    expect(final.journal).toHaveLength(1);

    writeOrCompare("expected", expected);
  });
});
