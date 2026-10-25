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

describe("debrief contract: school snapshot parity across drivers", () => {
  async function schoolSnapshot(database: TestDatabase) {
    return database.select<{ id: string; date: string; title: string; school_name: string | null }>(
      "SELECT id, date, title, school_name FROM journal_entries ORDER BY id",
    );
  }

  it("replays the bounded shared school fixtures and matches expected cross-driver snapshot", async () => {
    db = await createNodeSqliteDatabase();
    const op = (name: string) => JSON.parse(fixture(name)) as DebriefSaveOperation;
    const expected = JSON.parse(fixture("school-expected"));

    // 1. Create with trimmed Unicode (NBSP/BOM) school name
    await db.saveDebriefAtomically!(op("school-01-create"));
    expect(await schoolSnapshot(db)).toEqual(expected.afterCreate);

    // 2. Replay with identical or modified payload carrying another valid school value: complete NO-OP
    const replayOp = {
      ...op("school-01-create"),
      journal: { ...op("school-01-create").journal, schoolName: "Different Valid School" },
    };
    await db.saveDebriefAtomically!(replayOp);
    expect(await schoolSnapshot(db)).toEqual(expected.afterReplayWithDifferentSchool);

    // 3. Deliberate new operation update with omitted schoolName: preserves snapshot
    await db.saveDebriefAtomically!(op("school-02-update-preserve"));
    expect(await schoolSnapshot(db)).toEqual(expected.afterUpdatePreserve);

    // 4. Deliberate new operation update with explicit null: clears snapshot
    await db.saveDebriefAtomically!(op("school-03-update-clear"));
    expect(await schoolSnapshot(db)).toEqual(expected.afterUpdateClear);
  });

  it("handles absent on create as null, preserves on omitted update, and clears on blank string", async () => {
    db = await createNodeSqliteDatabase();
    // Create with omitted schoolName
    await db.saveDebriefAtomically!({
      operationId: "op-create-absent",
      targetId: "j-absent",
      journal: { date: "2026-10-25", title: "Flight Without School" },
    });
    let rows = await schoolSnapshot(db);
    expect(rows[0]?.school_name).toBeNull();

    // Deliberate update with schoolName set
    await db.saveDebriefAtomically!({
      operationId: "op-set-school",
      targetId: "j-absent",
      journal: { date: "2026-10-25", title: "Flight With School", schoolName: "Galvin Flying" },
    });
    rows = await schoolSnapshot(db);
    expect(rows[0]?.school_name).toBe("Galvin Flying");

    // Deliberate update with omitted schoolName preserves
    await db.saveDebriefAtomically!({
      operationId: "op-preserve-omitted",
      targetId: "j-absent",
      journal: { date: "2026-10-25", title: "Updated Flight Title" },
    });
    rows = await schoolSnapshot(db);
    expect(rows[0]?.school_name).toBe("Galvin Flying");
    expect(rows[0]?.title).toBe("Updated Flight Title");

    // Deliberate update with blank/whitespace clears
    await db.saveDebriefAtomically!({
      operationId: "op-clear-blank",
      targetId: "j-absent",
      journal: { date: "2026-10-25", title: "Updated Flight Title", schoolName: "   \t \n  " },
    });
    rows = await schoolSnapshot(db);
    expect(rows[0]?.school_name).toBeNull();
  });

  it("enforces length <= 200 code units and UTF-16 astral counting, rejecting 201 without writing receipt", async () => {
    db = await createNodeSqliteDatabase();

    // Exact 200 ASCII characters succeeds
    await db.saveDebriefAtomically!({
      operationId: "op-200-ascii",
      targetId: "j-200",
      journal: { date: "2026-10-25", title: "200 ascii", schoolName: "A".repeat(200) },
    });
    let rows = await schoolSnapshot(db);
    expect(rows[0]?.school_name).toBe("A".repeat(200));

    // 201 ASCII characters throws and rolls back
    await expect(
      db.saveDebriefAtomically!({
        operationId: "op-201-ascii",
        targetId: "j-201",
        journal: { date: "2026-10-25", title: "201 ascii", schoolName: "A".repeat(201) },
      }),
    ).rejects.toThrow("School name exceeds maximum length of 200 characters.");

    // Check no row was inserted for j-201 and no receipt in debrief_operations
    expect(await db.select("SELECT * FROM journal_entries WHERE id = 'j-201'")).toEqual([]);
    expect(await db.select("SELECT * FROM debrief_operations WHERE id = 'op-201-ascii'")).toEqual([]);

    // Astral characters: 100 emojis = 200 UTF-16 code units (succeeds)
    const astral100 = "🚀".repeat(100);
    expect(astral100.length).toBe(200);
    await db.saveDebriefAtomically!({
      operationId: "op-100-astral",
      targetId: "j-astral-ok",
      journal: { date: "2026-10-25", title: "100 astral", schoolName: astral100 },
    });
    const astralRow = (await db.select<{ school_name: string }>(
      "SELECT school_name FROM journal_entries WHERE id = 'j-astral-ok'",
    ))[0];
    expect(astralRow?.school_name).toBe(astral100);

    // Astral characters: 101 emojis = 202 UTF-16 code units (fails and rolls back)
    const astral101 = "🚀".repeat(101);
    expect(astral101.length).toBe(202);
    await expect(
      db.saveDebriefAtomically!({
        operationId: "op-101-astral",
        targetId: "j-astral-fail",
        journal: { date: "2026-10-25", title: "101 astral", schoolName: astral101 },
      }),
    ).rejects.toThrow("School name exceeds maximum length of 200 characters.");
    expect(await db.select("SELECT * FROM journal_entries WHERE id = 'j-astral-fail'")).toEqual([]);
    expect(await db.select("SELECT * FROM debrief_operations WHERE id = 'op-101-astral'")).toEqual([]);
  });

  it("rejects invalid runtime types and rolls back completely without writing receipt", async () => {
    db = await createNodeSqliteDatabase();

    await expect(
      db.saveDebriefAtomically!({
        operationId: "op-bad-type-num",
        targetId: "j-bad-num",
        journal: { date: "2026-10-25", title: "Bad Type", schoolName: 9999 as unknown as string },
      }),
    ).rejects.toThrow("School name must be a string or null.");

    await expect(
      db.saveDebriefAtomically!({
        operationId: "op-bad-type-obj",
        targetId: "j-bad-obj",
        journal: { date: "2026-10-25", title: "Bad Type", schoolName: { nested: true } as unknown as string },
      }),
    ).rejects.toThrow("School name must be a string or null.");

    expect(await db.select("SELECT COUNT(*) AS count FROM journal_entries")).toEqual([{ count: 0 }]);
    expect(await db.select("SELECT COUNT(*) AS count FROM debrief_operations")).toEqual([{ count: 0 }]);
  });

  it("preserves journal snapshot across flight_schools comparison rename and removal", async () => {
    db = await createNodeSqliteDatabase();
    const repos = createRepositories(db);

    const school = await repos.flightSchools.create({
      name: "Olympic Flight Center",
      hourlyCostCents: 18000,
    });

    await db.saveDebriefAtomically!({
      operationId: "op-school-iso",
      targetId: "j-iso",
      journal: { date: "2026-10-25", title: "Stage Check", schoolName: "Olympic Flight Center" },
    });

    // Rename comparison school
    await repos.flightSchools.update(school.id, { name: "Olympic Flight Academy" });
    let journal = (await schoolSnapshot(db))[0];
    expect(journal?.school_name).toBe("Olympic Flight Center");

    // Remove comparison school
    await repos.flightSchools.remove(school.id);
    journal = (await schoolSnapshot(db))[0];
    expect(journal?.school_name).toBe("Olympic Flight Center");
  });

  it("trims NBSP and BOM but preserves leading/trailing NEL and U+180E, enforcing 200 code unit boundary", async () => {
    db = await createNodeSqliteDatabase();

    // 1. NBSP and BOM trim from ends, but internal and leading/trailing NEL stay intact
    const rawWithNel = "\uFEFF\u00A0\u0085 Rainier Flight Service \u0085\u00A0\uFEFF";
    await db.saveDebriefAtomically!({
      operationId: "op-nel-test",
      targetId: "j-nel",
      journal: { date: "2026-10-25", title: "NEL test", schoolName: rawWithNel },
    });
    let rows = await schoolSnapshot(db);
    expect(rows[0]?.school_name).toBe("\u0085 Rainier Flight Service \u0085");

    // 2. Length-boundary case:
    // Leading NEL with 199 ASCII characters + surrounding BOM and NBSP = 200 code units when trimmed (admitted)
    const validLeadingNel = "\uFEFF\u00A0\u0085" + "A".repeat(199) + "\u00A0\uFEFF";
    await db.saveDebriefAtomically!({
      operationId: "op-valid-boundary-nel",
      targetId: "j-valid-nel",
      journal: { date: "2026-10-25", title: "Valid boundary", schoolName: validLeadingNel },
    });
    rows = await schoolSnapshot(db);
    const validEntry = rows.find((r) => r.id === "j-valid-nel");
    expect(validEntry?.school_name).toBe("\u0085" + "A".repeat(199));
    expect(validEntry?.school_name?.length).toBe(200);

    // Leading NEL with 200 ASCII characters + surrounding BOM and NBSP = 201 code units when trimmed.
    // Because NEL is preserved and NOT trimmed, the trimmed string has 201 code units and must be rejected.
    // If accidental extra trimming of NEL occurred, it would admit oversized text.
    const invalidLeadingNel = "\uFEFF\u00A0\u0085" + "A".repeat(200) + "\u00A0\uFEFF";
    await expect(
      db.saveDebriefAtomically!({
        operationId: "op-invalid-boundary-nel",
        targetId: "j-invalid-nel",
        journal: { date: "2026-10-25", title: "Invalid boundary", schoolName: invalidLeadingNel },
      }),
    ).rejects.toThrow("School name exceeds maximum length of 200 characters.");
    expect(await db.select("SELECT * FROM journal_entries WHERE id = 'j-invalid-nel'")).toEqual([]);

    // Trailing NEL with 200 ASCII characters = 201 code units when trimmed (rejected)
    const invalidTrailingNel = "\uFEFF\u00A0" + "A".repeat(200) + "\u0085\u00A0\uFEFF";
    await expect(
      db.saveDebriefAtomically!({
        operationId: "op-invalid-trailing-nel",
        targetId: "j-invalid-trailing-nel",
        journal: { date: "2026-10-25", title: "Invalid trailing", schoolName: invalidTrailingNel },
      }),
    ).rejects.toThrow("School name exceeds maximum length of 200 characters.");

    // U+180E boundary: 200 'A's + U+180E = 201 code units (rejected)
    const invalid180e = "\uFEFF\u00A0\u180E" + "A".repeat(200) + "\u00A0\uFEFF";
    await expect(
      db.saveDebriefAtomically!({
        operationId: "op-invalid-180e",
        targetId: "j-invalid-180e",
        journal: { date: "2026-10-25", title: "Invalid 180E", schoolName: invalid180e },
      }),
    ).rejects.toThrow("School name exceeds maximum length of 200 characters.");
  });

  it("enforces populated rollback on invalid school save and full-state replay preservation", async () => {
    db = await createNodeSqliteDatabase();
    for (const sql of SEED_SQL) await db.execute(sql);

    // 1. Seed complete prior journal with school, flight fields, material links,
    // related action/question, and operation receipt.
    const priorOp: DebriefSaveOperation = {
      operationId: "op-prior-1",
      targetId: "journal-prior-1",
      journal: {
        date: "2026-10-24",
        title: "Pre-solo maneuvers",
        schoolName: "Rainier Flight Service",
        eventId: "event-1",
        materialIds: ["material-1"],
        aircraftType: "C172S",
        aircraftId: "N172SP",
        departureAirport: "KBFI",
        arrivalAirport: "KBFI",
        instructorName: "Taylor Morgan",
        totalTime: 1.5,
        dualReceived: 1.5,
        soloTime: 0.0,
        picTime: 0.0,
        dayLandings: 3,
        wentWell: "Steep turns and emergency descent",
        wasDifficult: "Crosswind correction on rollout",
        instructorFeedback: "Smooth rudder coordination",
        questionsForNextTime: "Power-off 180 glide distance",
        confidence: 4,
      },
      action: {
        id: "act-prior-1",
        title: "Chair-fly steep turns",
        materialId: "material-1",
      },
      withdrawActionId: null,
      question: {
        id: "q-prior-1",
        text: "What roll rate is best rolling out of steep turns?",
        eventId: "event-1",
        materialId: "material-1",
      },
      withdrawQuestionId: null,
    };
    await db.saveDebriefAtomically!(priorOp);

    // Full snapshot capturing every row/field and relevant timestamps across all tables
    const fullSnapshot = async () => ({
      journal: await db.select("SELECT * FROM journal_entries ORDER BY id"),
      journalMaterials: await db.select("SELECT * FROM journal_materials ORDER BY journal_id, material_id"),
      actions: await db.select("SELECT * FROM next_actions ORDER BY id"),
      questions: await db.select("SELECT * FROM questions ORDER BY id"),
      operations: await db.select("SELECT * FROM debrief_operations ORDER BY id"),
    });

    const snapshotBefore = await fullSnapshot();
    expect(snapshotBefore.journal).toHaveLength(1);
    expect(snapshotBefore.journal[0]?.school_name).toBe("Rainier Flight Service");
    expect(snapshotBefore.journalMaterials).toHaveLength(1);
    expect(snapshotBefore.actions).toHaveLength(1);
    expect(snapshotBefore.questions).toHaveLength(1);
    expect(snapshotBefore.operations).toHaveLength(1);

    // 2. Attempt a new invalid201-school save that also proposes changes/deletions to those linked entities
    const invalidOp: DebriefSaveOperation = {
      operationId: "op-invalid-201",
      targetId: "journal-prior-1",
      journal: {
        date: "2026-10-25",
        title: "Attempted Corrupted Title",
        schoolName: "X".repeat(201),
        materialIds: [], // proposes deleting material links
      },
      action: {
        id: "act-prior-1",
        title: "Mutated action title",
        materialId: null,
      },
      withdrawActionId: null,
      question: null,
      withdrawQuestionId: "q-prior-1", // proposes withdrawing/deleting question
    };

    await expect(db.saveDebriefAtomically!(invalidOp)).rejects.toThrow(
      "School name exceeds maximum length of 200 characters.",
    );

    // Assert clear rejection, all prior state byte/value unchanged, and no new receipt
    expect(await fullSnapshot()).toEqual(snapshotBefore);
    expect(await db.select("SELECT * FROM debrief_operations WHERE id = 'op-invalid-201'")).toEqual([]);

    // 3. Follow with valid retry / missing-school update to show connection remains usable
    // and omitted schoolName preserves existing snapshot.
    const validRetryOp: DebriefSaveOperation = {
      operationId: "op-valid-retry-1",
      targetId: "journal-prior-1",
      journal: {
        date: "2026-10-25",
        title: "Pre-solo maneuvers (revised)",
        // schoolName is omitted: preserves existing snapshot
        materialIds: ["material-1"],
      },
      action: null,
      withdrawActionId: null,
      question: null,
      withdrawQuestionId: null,
    };
    await db.saveDebriefAtomically!(validRetryOp);

    const snapshotAfterValid = await fullSnapshot();
    // School name snapshot is preserved across omitted school update
    expect(snapshotAfterValid.journal[0]?.school_name).toBe("Rainier Flight Service");
    expect(snapshotAfterValid.journal[0]?.title).toBe("Pre-solo maneuvers (revised)");
    // Prior action and question remain intact
    expect(snapshotAfterValid.actions).toHaveLength(1);
    expect(snapshotAfterValid.questions).toHaveLength(1);
    expect(snapshotAfterValid.operations).toHaveLength(2);

    // 4. Committed-operation replay with another valid school value:
    // preserves all existing rows and receipts, not only the school/title projection.
    const replayOp: DebriefSaveOperation = {
      operationId: "op-valid-retry-1", // already committed operation id
      targetId: "journal-prior-1",
      journal: {
        date: "2026-10-26",
        title: "Replay Attempted Mutated Title",
        schoolName: "Different Flight Academy", // different valid school value
        materialIds: [],
      },
      action: null,
      withdrawActionId: "act-prior-1",
      question: null,
      withdrawQuestionId: "q-prior-1",
    };
    await db.saveDebriefAtomically!(replayOp);
    expect(await fullSnapshot()).toEqual(snapshotAfterValid);

    // Also replay initial committed operation with another valid school value
    const replayPriorOp: DebriefSaveOperation = {
      ...priorOp,
      journal: {
        ...priorOp.journal,
        title: "Different Title",
        schoolName: "Yet Another Flight School",
      },
    };
    await db.saveDebriefAtomically!(replayPriorOp);
    expect(await fullSnapshot()).toEqual(snapshotAfterValid);
  });
});
