/**
 * M2-4 / C2: the shared reader contract `src-tauri/fixtures/card-library/cases.json`.
 *
 * The baseline is a synthetic library built through the real C1 write path
 * (ratings, regeneration, suspend/flag, a reset, a deleted set) and dumped to
 * SQL, plus one saved set over the 8 MiB ceiling built in SQL. Each call runs
 * a reader input (optionally continuing a previous call's cursor) and records
 * its full result or refusal code.
 *
 * Here the expected results are checked on node:sqlite and sql.js through
 * their driver methods and through the generic `select` fallback; the native
 * reader must give identical results
 * (`card_library_tests::shared_card_library_contract_native_outcomes`).
 * Regenerate only deliberately: `UPDATE_CARD_LIBRARY_FIXTURE=1 npx vitest run src/data/cardLibraryParity.test.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import type { CardItemAction, CardRating } from "@/domain/types";
import { CardLibraryReadError } from "@/logic/cardLibrary";

import { readLibraryRecentReviews, readLibraryReviewDue } from "./cardLibraryReader";
import type { SqlDatabase, SqlValue } from "./db";
import { cardReviewRepository } from "./repositories/cardReviewRepository";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";

const FIXTURE = `${process.cwd()}/src-tauri/fixtures/card-library/cases.json`;
const T0 = "2026-10-06T15:00:00.000Z";
const NOW = "2026-10-06T16:00:00.000Z";
const MIDNIGHT = "2026-10-07T05:00:00.000Z"; // America/Chicago
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

interface Call {
  name: string;
  reader: "due" | "history";
  input: Record<string, unknown>;
  cursorFrom?: string;
}
interface Contract {
  description: string;
  baseline: string[];
  calls: Call[];
  expected: Record<string, unknown>;
}

const TABLES = [
  "study_materials",
  "ai_study_sets",
  "card_review_generations",
  "card_versions",
  "card_items",
  "card_review_state",
  "card_review_events",
  "card_review_operations",
];

const cards = (label: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ front: `${label} front ${i}`, back: `${label} back ${i}`, sourcePage: i % 2 ? i : null }));

const sqlLiteral = (value: unknown) =>
  value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`;

/** The synthetic library, built through the real C1 transaction with an injected clock. */
async function buildBaseline(): Promise<string[]> {
  vi.useFakeTimers({ toFake: ["Date"] });
  const db = await createNodeSqliteDatabase();
  const reviews = cardReviewRepository(db);
  const material = async (id: string, title: string, topic: string, priority: string, updatedAt: string, set: unknown) => {
    await db.execute(
      "INSERT INTO study_materials (id, title, topic, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, title, topic, priority, T0, updatedAt],
    );
    if (set !== undefined) {
      await db.execute(
        `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
         VALUES (?, 'Synthetic set', '', '[]', ?, '', 'import', '', ?, ?)`,
        [id, typeof set === "string" ? set : JSON.stringify(set), T0, T0],
      );
    }
  };
  const act = async (id: string, ordinal: number, when: string, kind: Partial<CardItemAction> & { action: CardItemAction["action"] }) => {
    vi.setSystemTime(new Date(when));
    const snap = await reviews.getCardReviewSnapshot(id);
    if (snap.current.status !== "ok") throw new Error(`no cards for ${id}`);
    const item = snap.current.items[ordinal]!;
    await reviews.saveAction({
      operationId: crypto.randomUUID(),
      materialId: id,
      versionContentHash: snap.current.contentHash,
      itemId: item.itemId,
      expectedGeneration: snap.generation,
      expectedRevision: snap.states[item.itemId]?.revision ?? 0,
      ...kind,
    } as CardItemAction);
  };
  const rate = (id: string, ordinal: number, rating: CardRating, when: string) => act(id, ordinal, when, { action: "rate", rating });

  await material("m-again", "Again and day", "general", "later", "2026-10-05T10:00:00.000Z", cards("Again", 3));
  await rate("m-again", 0, "again", at(NOW, -20 * MIN)); // due NOW - 10 minutes
  await rate("m-again", 1, "good", at(T0, -2 * DAY)); // due T0 - 1 day
  await material("m-day", "Weather day", "weather", "next_up", "2026-10-04T10:00:00.000Z", cards("Day", 4));
  await rate("m-day", 0, "good", at(T0, -2 * DAY));
  await material("m-future", "Nothing due", "general", "later", "2026-10-03T10:00:00.000Z", cards("Future", 2));
  await rate("m-future", 0, "good", T0);
  await rate("m-future", 1, "easy", T0);
  for (const [i, priority] of ["later", "next_up", "important", "later", "later", "next_up"].entries()) {
    await material(`m-new-${i}`, `New ${String.fromCharCode(70 - i)}`, i % 2 ? "navigation" : "general", priority, `2026-10-0${2 + (i % 3)}T0${i}:00:00.000Z`, cards(`New${i}`, 2 + i));
  }
  await material("m-paused", "Paused and flagged", "general", "later", "2026-10-01T10:00:00.000Z", cards("Paused", 2));
  await act("m-paused", 0, T0, { action: "suspend" });
  await rate("m-paused", 1, "good", at(T0, -2 * DAY));
  await act("m-paused", 1, T0, { action: "flag", reason: "unclear" } as never);
  await material("m-malformed", "Damaged cards", "general", "later", "2026-09-30T10:00:00.000Z", "{not json");
  await material("m-empty", "Guide only", "general", "later", "2026-09-29T10:00:00.000Z", "[]");
  await material("m-regen", "Regenerated", "navigation", "later", "2026-09-28T10:00:00.000Z", cards("RegenA", 3));
  await rate("m-regen", 0, "good", at(T0, -3 * DAY));
  await rate("m-regen", 1, "easy", at(T0, -3 * DAY + MIN));
  await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = 'm-regen'", [JSON.stringify(cards("RegenB", 3))]);
  await rate("m-regen", 0, "again", at(NOW, -15 * MIN));
  await material("m-gone-set", "Set removed", "general", "later", "2026-09-27T10:00:00.000Z", cards("Gone", 2));
  await rate("m-gone-set", 0, "hard", at(T0, -DAY));
  await db.execute("DELETE FROM ai_study_sets WHERE source_material_id = 'm-gone-set'");
  await material("m-reset", "Reset once", "general", "later", "2026-09-26T10:00:00.000Z", cards("Reset", 2));
  await rate("m-reset", 0, "good", at(T0, -DAY));
  vi.setSystemTime(new Date(at(T0, -DAY + MIN)));
  await reviews.saveAction({ action: "reset", operationId: crypto.randomUUID(), materialId: "m-reset", expectedGeneration: 0 });
  await rate("m-reset", 1, "again", at(NOW, -5 * MIN));
  await material("m-big", "Large set", "general", "later", "2026-09-25T10:00:00.000Z", cards("Big", 450));
  await rate("m-big", 449, "good", at(T0, -2 * DAY));
  await material("m-oversize", "Too large", "general", "later", "2026-09-24T10:00:00.000Z", cards("Over", 2));
  await rate("m-oversize", 0, "good", at(T0, -5 * DAY));
  vi.useRealTimers();

  const statements: string[] = [];
  for (const table of TABLES) {
    for (const row of await db.select<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY rowid`)) {
      const columns = Object.keys(row);
      statements.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => sqlLiteral(row[c])).join(", ")})`);
    }
  }
  db.close();
  // A saved set over the absolute 8 MiB ceiling, built in SQL (its history event stays).
  statements.push(
    `UPDATE ai_study_sets SET flashcards_json = '[{"front":"' || hex(zeroblob(4300000)) || '","back":"B","sourcePage":null}]' WHERE source_material_id = 'm-oversize'`,
  );
  return statements;
}

const DUE = { nowUtc: NOW, nextLocalMidnightUtc: MIDNIGHT };
const CALLS: Call[] = [
  { name: "due-all-first", reader: "due", input: { ...DUE, limit: 4 } },
  { name: "due-all-second", reader: "due", input: { ...DUE, limit: 4 }, cursorFrom: "due-all-first" },
  { name: "due-all-third", reader: "due", input: { ...DUE, limit: 4 }, cursorFrom: "due-all-second" },
  { name: "due-small-batch-first", reader: "due", input: { ...DUE, candidateBatchBudget: 3, limit: 2 } },
  { name: "due-small-batch-second", reader: "due", input: { ...DUE, candidateBatchBudget: 3, limit: 2 }, cursorFrom: "due-small-batch-first" },
  { name: "due-small-batch-third", reader: "due", input: { ...DUE, candidateBatchBudget: 3, limit: 2 }, cursorFrom: "due-small-batch-second" },
  { name: "due-tight-budget-first", reader: "due", input: { ...DUE, maxBatchCardsBudget: 600 } },
  { name: "due-tight-budget-second", reader: "due", input: { ...DUE, maxBatchCardsBudget: 600 }, cursorFrom: "due-tight-budget-first" },
  { name: "due-single-set-lane", reader: "due", input: { ...DUE, maxBatchCardsBudget: 1, maxBatchRawJsonBytesBudget: 1024 } },
  { name: "due-today", reader: "due", input: { ...DUE, statusFilter: "due_today" } },
  { name: "due-new-only", reader: "due", input: { ...DUE, statusFilter: "new_only" } },
  { name: "due-topic-weather", reader: "due", input: { ...DUE, topic: "weather" } },
  { name: "due-next-morning", reader: "due", input: { nowUtc: "2026-10-07T14:00:00.000Z", nextLocalMidnightUtc: "2026-10-08T05:00:00.000Z" } },
  { name: "due-stale-cursor", reader: "due", input: { ...DUE, limit: 4, statusFilter: "due_today" }, cursorFrom: "due-all-first" },
  { name: "due-invalid-cursor", reader: "due", input: { ...DUE, cursor: "not base64!" } },
  { name: "due-noncanonical-cursor", reader: "due", input: { ...DUE, cursor: "e30=" } },
  { name: "due-invalid-time", reader: "due", input: { nowUtc: "2026-10-06T16:00:00Z", nextLocalMidnightUtc: MIDNIGHT } },
  { name: "due-invalid-filter", reader: "due", input: { ...DUE, statusFilter: "overdue" } },
  { name: "due-empty-topic", reader: "due", input: { ...DUE, topic: "" } },
  { name: "history-first", reader: "history", input: { limit: 3 } },
  { name: "history-second", reader: "history", input: { limit: 3 }, cursorFrom: "history-first" },
  { name: "history-third", reader: "history", input: { limit: 3 }, cursorFrom: "history-second" },
  { name: "history-default", reader: "history", input: {} },
  { name: "history-material", reader: "history", input: { materialId: "m-regen" } },
  { name: "history-topic", reader: "history", input: { topic: "navigation" } },
  { name: "history-tight-budget", reader: "history", input: { maxBatchCardsBudget: 600 } },
  {
    name: "history-enrichment-only",
    reader: "history",
    input: { enrichmentOnly: true, enrichMaterialIds: ["m-regen", "m-gone-set", "m-oversize", "m-missing", "m-malformed", "m-empty", "m-regen"] },
  },
  {
    name: "history-enrichment-filtered",
    reader: "history",
    input: { limit: 0, topic: "navigation", enrichMaterialIds: ["m-regen", "m-day"] },
  },
  {
    name: "history-enrichment-budget",
    reader: "history",
    input: { enrichmentOnly: true, maxBatchCardsBudget: 600, enrichMaterialIds: ["m-big", "m-regen", "m-again"] },
  },
  { name: "history-combined", reader: "history", input: { limit: 3, enrichMaterialIds: ["m-big", "m-new-0"] } },
  { name: "history-stale-cursor", reader: "history", input: { limit: 3, topic: "general" }, cursorFrom: "history-first" },
  { name: "history-too-many-targets", reader: "history", input: { enrichMaterialIds: Array.from({ length: 251 }, (_, i) => `t-${i}`) } },
  { name: "history-invalid-target", reader: "history", input: { enrichMaterialIds: ["ok", ""] } },
  { name: "history-invalid-material", reader: "history", input: { materialId: "x".repeat(65) } },
  { name: "due-wrong-cursor-type", reader: "due", input: { ...DUE }, cursorFrom: "history-first" },
];

async function runCalls(read: (reader: Call["reader"], input: Record<string, unknown>) => Promise<unknown>, calls: Call[]) {
  const results: Record<string, unknown> = {};
  for (const call of calls) {
    const input = { ...call.input };
    if (call.cursorFrom) {
      const previous = results[call.cursorFrom] as Record<string, unknown>;
      input.cursor = previous.nextCursor ?? previous.next ?? null;
    }
    try {
      results[call.name] = JSON.parse(JSON.stringify(await read(call.reader, input)));
    } catch (error) {
      if (!(error instanceof CardLibraryReadError)) throw error;
      results[call.name] = { error: error.code };
    }
  }
  return results;
}

async function loadBaseline(db: SqlDatabase, baseline: string[]) {
  for (const statement of baseline) await db.execute(statement);
}

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const updating = process.env.UPDATE_CARD_LIBRARY_FIXTURE === "1";

describe("shared card library reader contract", () => {
  it.runIf(updating)("regenerates the fixture from the TypeScript reader", async () => {
    const baseline = await buildBaseline();
    const db = await createNodeSqliteDatabase();
    await loadBaseline(db, baseline);
    const expected = await runCalls(
      (reader, input) => (reader === "due" ? db.readLibraryReviewDue!(input as never) : db.readLibraryRecentReviews!(input as never)),
      CALLS,
    );
    db.close();
    const contract: Contract = {
      description:
        "Shared M2-4/C2 library reader contract. Build the registered schema, apply `baseline` on one connection, then run each call in order (a `cursorFrom` call continues that call's nextCursor/next). Each expected value is the full JSON result, or {error: CODE}. TypeScript: readLibraryReviewDue/readLibraryRecentReviews; native: card_library::read_library_review_due/read_library_recent_reviews. Generated by src/data/cardLibraryParity.test.ts; every value is synthetic.",
      baseline,
      calls: CALLS,
      expected,
    };
    writeFileSync(FIXTURE, `${JSON.stringify(contract, null, 1)}\n`);
  }, 120_000);

  const contract: Contract | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

  it.skipIf(updating)("covers every reader boundary the contract names", () => {
    expect(contract).not.toBeNull();
    const expected = contract!.expected as Record<string, Record<string, unknown>>;
    expect(Object.keys(expected)).toEqual(contract!.calls.map((c) => c.name));
    const codes = new Set(Object.values(expected).map((r) => r.error).filter(Boolean));
    expect(codes).toEqual(new Set(["STALE_CURSOR", "INVALID_CURSOR", "INVALID_TIME", "INVALID_FILTER", "INVALID_INPUT", "INVALID_TARGET"]));
    expect((expected["due-all-third"]!.summary as { isComplete: boolean }).isComplete).toBe(true);
    expect(expected["due-all-third"]!.nextCursor).toBeNull();
    expect(JSON.stringify(expected)).toContain("PAYLOAD_TOO_LARGE");
  });

  for (const engine of ["node:sqlite driver", "sql.js driver", "select fallback"] as const) {
    it.skipIf(updating)(`${engine} gives every expected result`, async () => {
      const db = engine === "sql.js driver" ? await createSqlJsDatabase() : await createNodeSqliteDatabase();
      await loadBaseline(db, contract!.baseline);
      const select = (sql: string, params: SqlValue[]) => db.select<Record<string, unknown>>(sql, params);
      const actual = await runCalls((reader, input) => {
        if (engine === "select fallback") {
          return reader === "due" ? readLibraryReviewDue(select, input as never) : readLibraryRecentReviews(select, input as never);
        }
        return reader === "due" ? db.readLibraryReviewDue!(input as never) : db.readLibraryRecentReviews!(input as never);
      }, contract!.calls);
      expect(actual).toEqual(contract!.expected);
      (db as { close?: () => void }).close?.();
    }, 120_000);
  }
});
