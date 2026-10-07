/**
 * M1 D7 acceptance — upgrading an existing v9 dataset to migration 10.
 *
 * Kind of test: **repository integration** against real SQLite files.
 * `applyMigrations` (the fallback drivers' runner) builds the shipped schema
 * through migration 9 only. The dataset is written with raw SQL in the v9
 * shape, because today's repositories write columns v9 does not have. The file
 * is then reopened the normal way, which applies migration 10. The desktop app
 * runs the same SQL through tauri-plugin-sql; the Rust test
 * `debrief::tests::upgrading_a_v9_dataset_keeps_everything_and_enables_d6`
 * applies the registered Rust migration list the same way.
 *
 * Data is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS, applyMigrations } from "@/data/migrations";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { parseDailyPlanState } from "@/logic/dailyPlan";

interface Sync {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
}

async function openRaw(path: string): Promise<Sync> {
  const nativeSqlite = "node:sqlite";
  const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
  const db = new DatabaseSync(path) as Sync;
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const TS = "2026-09-01T12:00:00.000Z";
const DAILY_PLAN = JSON.stringify({
  version: 1,
  date: "2026-09-20",
  timeBudget: 30,
  suggestedIds: ["action:act-open"],
  decisions: { "action:act-skip": { type: "skip", date: "2026-09-20" } },
  updatedAt: TS,
});

/** A realistic v9 training record, in the v9 column shape. */
const V9_DATASET = [
  `INSERT INTO schedule_events (id, title, event_type, date, status, instructor, created_at, updated_at)
   VALUES ('ev-past', 'Lesson 6 — Stalls', 'flight_lesson', '2026-08-28', 'completed', 'CFI Example', '${TS}', '${TS}'),
          ('ev-next', 'Lesson 7 — Ground reference', 'flight_lesson', '2026-10-02', 'scheduled', 'CFI Example', '${TS}', '${TS}')`,
  `INSERT INTO event_prep_items (id, event_id, title, done, position, created_at)
   VALUES ('prep-1', 'ev-next', 'Review turns around a point', 1, 0, '${TS}')`,
  `INSERT INTO study_materials (id, title, material_type, topic, review_status, file_path, original_file_name, file_size, created_at, updated_at)
   VALUES ('mat-1', 'Synthetic PHAK Ch. 5', 'reference', 'aerodynamics', 'reviewed', 'mat-1-phak5.pdf', 'phak5.pdf', 4096, '${TS}', '${TS}')`,
  `INSERT INTO journal_entries (id, event_id, date, title, went_well, was_difficult, instructor_feedback,
       questions_for_next_time, confidence, aircraft_type, aircraft_id, total_time, dual_received, day_landings,
       created_at, updated_at)
   VALUES ('jr-1', 'ev-past', '2026-08-28', 'Stalls', 'Power-off recovery', 'Rudder in power-on',
       'Lead with rudder', 'What is critical AOA?', 3, 'C172S', 'N0000X', 1.4, 1.4, 3, '${TS}', '${TS}')`,
  `INSERT INTO journal_materials (journal_id, material_id) VALUES ('jr-1', 'mat-1')`,
  `INSERT INTO next_actions (id, title, status, priority, due_date, estimated_minutes, related_type, related_id, completed_at, created_at, updated_at)
   VALUES ('act-done', 'Chair-fly power-on stall', 'completed', 'important', '2026-08-30', 20, 'journal', 'jr-1', '2026-08-30T09:00:00.000Z', '${TS}', '${TS}'),
          ('act-open', 'Read about load factor', 'open', 'next_up', NULL, 15, 'material', 'mat-1', NULL, '${TS}', '${TS}'),
          ('act-skip', 'Book the next lesson', 'open', 'later', NULL, NULL, 'event', 'ev-next', NULL, '${TS}', '${TS}')`,
  `INSERT INTO questions (id, text, topic, event_id, material_id, journal_id, status, answer, answered_at, created_at, updated_at)
   VALUES ('q-answered', 'What is critical AOA?', 'aerodynamics', 'ev-past', 'mat-1', 'jr-1', 'answered', 'About 16 degrees, varies by wing', '2026-08-29T10:00:00.000Z', '${TS}', '${TS}'),
          ('q-open', 'How do we practice turns around a point?', 'maneuvers', 'ev-next', NULL, NULL, 'to_ask', '', NULL, '${TS}', '${TS}')`,
  `INSERT INTO app_metadata (key, value) VALUES ('daily_plan_session', '${DAILY_PLAN}')`,
];

const TABLES = [
  "schedule_events",
  "event_prep_items",
  "study_materials",
  "journal_entries",
  "journal_materials",
  "next_actions",
  "questions",
  "app_metadata",
];

/** The v9 columns of every seeded table, so upgraded rows compare like for like. */
function v9Snapshot(db: Sync, columns: Record<string, string[]>) {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    out[table] = db.prepare(`SELECT ${columns[table]!.join(", ")} FROM ${table} ORDER BY 1, 2`).all();
  }
  return out;
}

function columnsOf(db: Sync): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const table of TABLES) {
    out[table] = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  }
  return out;
}

let dir: string;
let path: string;
let open: TestDatabase[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hfd-upgrade-"));
  path = join(dir, "her-flight-deck.db");
  open = [];
});
afterEach(() => {
  for (const db of open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function reopen(): Promise<TestDatabase> {
  const db = await createNodeSqliteDatabase(path);
  open.push(db);
  return db;
}

describe("M1 D7 acceptance: upgrading an existing dataset through migration 10", () => {
  it("keeps every v9 record, adds D6 without inventing anything, and never reruns migrations", async () => {
    // Build the shipped v9 database and fill it.
    const v9 = await openRaw(path);
    await applyMigrations((sql) => v9.exec(sql), new Set([10, 11, 12]));
    for (const sql of V9_DATASET) v9.exec(sql);
    const v9Columns = columnsOf(v9);
    expect(v9Columns.next_actions).not.toContain("material_id");
    const before = v9Snapshot(v9, v9Columns);
    const versionsBefore = v9.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
    expect(versionsBefore).toHaveLength(9);
    v9.close();

    // Upgrade by opening it the normal way.
    const upgraded = await reopen();
    const raw = await openRaw(path);
    expect(raw.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual(
      MIGRATIONS.map((m) => ({ version: m.version })),
    );
    expect(v9Snapshot(raw, v9Columns)).toEqual(before);

    // Nothing invented: no new rows, no new links, empty provenance and ledger.
    expect(raw.prepare("SELECT material_id, source_material_id FROM next_actions").all()).toEqual(
      [{ material_id: null, source_material_id: null }, { material_id: null, source_material_id: null }, { material_id: null, source_material_id: null }],
    );
    expect(
      raw.prepare("SELECT COUNT(*) AS n FROM questions WHERE source_journal_id IS NOT NULL OR source_material_id IS NOT NULL OR source_event_id IS NOT NULL").all(),
    ).toEqual([{ n: 0 }]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM debrief_operations").all()).toEqual([{ n: 0 }]);

    // Her data reads back through today's repositories exactly.
    const repos = createRepositories(upgraded);
    const [entry] = await repos.journal.list();
    expect(entry).toMatchObject({ id: "jr-1", totalTime: 1.4, dualReceived: 1.4, dayLandings: 3, aircraftType: "C172S", confidence: 3, materialIds: ["mat-1"] });
    const actions = await repos.actions.list();
    expect(actions.find((a) => a.id === "act-done")).toMatchObject({ status: "completed", completedAt: "2026-08-30T09:00:00.000Z", estimatedMinutes: 20 });
    expect(await repos.questions.get("q-answered")).toMatchObject({ status: "answered", answer: "About 16 degrees, varies by wing", journalId: "jr-1", materialId: "mat-1" });
    expect(parseDailyPlanState(await repos.app.get("daily_plan_session"))).toMatchObject({
      timeBudget: 30,
      suggestedIds: ["action:act-open"],
      decisions: { "action:act-skip": { type: "skip", date: "2026-09-20" } },
    });

    // D6 works on the upgraded file: provenance triggers and the operation ledger.
    await upgraded.execute("DELETE FROM study_materials WHERE id = 'mat-1'");
    expect(await repos.questions.get("q-answered")).toMatchObject({ materialId: null, sourceMaterialId: "mat-1", answer: "About 16 degrees, varies by wing" });
    const operation = {
      operationId: "op-after-upgrade",
      targetId: "jr-2",
      journal: { date: "2026-10-02", title: "Ground reference", eventId: "ev-next" },
      action: { id: "act-new", title: "Practice S-turns" },
      withdrawActionId: null,
      question: { id: "q-new", text: "Wind correction in S-turns?", eventId: "ev-next" },
      withdrawQuestionId: null,
    };
    await upgraded.saveDebriefAtomically!(operation);
    await upgraded.saveDebriefAtomically!(operation);
    expect(await upgraded.select("SELECT id FROM debrief_operations")).toEqual([{ id: "op-after-upgrade" }]);
    expect((await repos.actions.list()).filter((a) => a.id === "act-new")).toHaveLength(1);

    // Reopening again runs nothing twice and changes nothing.
    const afterUse = v9Snapshot(raw, v9Columns);
    raw.close();
    await reopen();
    const again = await openRaw(path);
    expect(again.prepare("SELECT version, COUNT(*) AS n FROM schema_migrations GROUP BY version HAVING n > 1").all()).toEqual([]);
    expect(again.prepare("SELECT COUNT(*) AS n FROM schema_migrations").all()).toEqual([{ n: MIGRATIONS.length }]);
    expect(v9Snapshot(again, v9Columns)).toEqual(afterUse);
    again.close();
  });

  it("still installs fresh", async () => {
    const fresh = await reopen();
    const repos = createRepositories(fresh);
    expect(await fresh.select("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: MIGRATIONS.at(-1)!.version }]);
    expect(await repos.journal.list()).toEqual([]);
    expect(await repos.actions.list()).toEqual([]);
    expect(await fresh.select("SELECT COUNT(*) AS n FROM debrief_operations")).toEqual([{ n: 0 }]);
  });
});
