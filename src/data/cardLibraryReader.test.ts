/**
 * M2-4 / C2 bounded readers on the real single-connection drivers
 * (node:sqlite and sql.js), with card state written through the real C1
 * transaction under an injected clock. A counting wrapper around `select`
 * records exactly which statements the reader executed. Synthetic,
 * disposable data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import type { CardItemAction, CardRating, LibraryReviewDueInput } from "@/domain/types";
import { CardLibraryReadError } from "@/logic/cardLibrary";

import { readLibraryRecentReviews, readLibraryReviewDue } from "./cardLibraryReader";
import type { SqlDatabase, SqlValue } from "./db";
import { cardLibraryRepository } from "./repositories/cardLibraryRepository";
import { cardReviewRepository } from "./repositories/cardReviewRepository";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";

const T0 = "2026-10-06T15:00:00.000Z";
const NOW = "2026-10-06T16:00:00.000Z";
const MIDNIGHT = "2026-10-07T05:00:00.000Z";
const MIN = 60_000;
const DAY = 86_400_000;
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const cards = (label: string, n: number) => Array.from({ length: n }, (_, i) => ({ front: `${label} ${i}`, back: "B", sourcePage: null }));

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Kind = "node" | "sqljs";
const open = (kind: Kind): Promise<SqlDatabase> => (kind === "node" ? createNodeSqliteDatabase() : createSqlJsDatabase());

async function material(db: SqlDatabase, id: string, set: unknown, o: { topic?: string; priority?: string; updatedAt?: string; title?: string } = {}) {
  await db.execute("INSERT INTO study_materials (id, title, topic, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    o.title ?? `Title ${id}`,
    o.topic ?? "general",
    o.priority ?? "later",
    T0,
    o.updatedAt ?? T0,
  ]);
  if (set !== undefined) {
    await db.execute(
      `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
       VALUES (?, 'Set', '', '[]', ?, '', 'import', '', ?, ?)`,
      [id, typeof set === "string" ? set : JSON.stringify(set), T0, T0],
    );
  }
}

async function act(db: SqlDatabase, id: string, ordinal: number, when: string, kind: { action: CardItemAction["action"]; rating?: CardRating; reason?: string }) {
  vi.setSystemTime(new Date(when));
  const reviews = cardReviewRepository(db);
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
}
const rate = (db: SqlDatabase, id: string, ordinal: number, rating: CardRating, when: string) => act(db, id, ordinal, when, { action: "rate", rating });

function counting(db: SqlDatabase) {
  const statements: string[] = [];
  const query = (sql: string, params: SqlValue[]) => {
    statements.push(sql.replace(/\s+/g, " ").trim());
    return db.select<Record<string, unknown>>(sql, params);
  };
  return { query, statements, rawReads: () => statements.filter((s) => s.startsWith("SELECT flashcards_json")).length };
}

const DUE: LibraryReviewDueInput = { nowUtc: NOW, nextLocalMidnightUtc: MIDNIGHT };
const refusal = async (promise: Promise<unknown>) => promise.then(() => "ok", (e) => (e instanceof CardLibraryReadError ? e.code : `other:${e}`));

async function writeState(db: SqlDatabase) {
  const [row] = await db.select<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM card_versions) AS versions, (SELECT COUNT(*) FROM card_items) AS items,
            (SELECT COUNT(*) FROM card_review_state) AS states, (SELECT COUNT(*) FROM card_review_events) AS events,
            (SELECT COUNT(*) FROM card_review_operations) AS receipts, (SELECT COUNT(*) FROM ai_study_sets) AS sets`,
  );
  return { ...row };
}

describe.each<Kind>(["node", "sqljs"])("library review due on %s", (kind) => {
  it("discovers current cards that were never reviewed, without writing anything", async () => {
    const db = await open(kind);
    await material(db, "m2", cards("Cross-country", 8), { title: "Cross-Country Navigation" });
    const before = await writeState(db);
    const execute = vi.spyOn(db, "execute");
    const result = await cardLibraryRepository(db).readReviewDue(DUE);
    expect(result.materials).toEqual([
      expect.objectContaining({ materialId: "m2", cardCount: 8, newCount: 8, totalDueCount: 0, retainedCardCount: 0 }),
    ]);
    expect(before).toMatchObject({ versions: 0, items: 0, states: 0 });
    expect(await writeState(db)).toEqual(before);
    expect(execute).not.toHaveBeenCalled();
  });

  it("evaluates the current content version only; A -> B -> A restores A's schedule", async () => {
    const db = await open(kind);
    await material(db, "m", cards("A", 3));
    await rate(db, "m", 0, "good", at(T0, -2 * DAY));
    await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = 'm'", [JSON.stringify(cards("B", 3))]);
    const b = await cardLibraryRepository(db).readReviewDue(DUE);
    expect(b.materials[0]).toMatchObject({ totalDueCount: 0, newCount: 3, retainedCardCount: 0 });
    await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = 'm'", [JSON.stringify(cards("A", 3))]);
    const a = await cardLibraryRepository(db).readReviewDue(DUE);
    expect(a.materials[0]).toMatchObject({ dayCount: 1, newCount: 2, retainedCardCount: 1 });
  });

  it("Again is due at its exact instant; day cards before the exclusive midnight; paused and flagged cards are neither", async () => {
    const db = await open(kind);
    await material(db, "m", cards("C", 5));
    await rate(db, "m", 0, "again", at(NOW, -10 * MIN)); // due exactly NOW
    await rate(db, "m", 1, "good", at(MIDNIGHT, -DAY)); // due exactly at midnight
    await rate(db, "m", 2, "good", at(MIDNIGHT, -DAY - 1)); // due 1 ms before
    await act(db, "m", 3, T0, { action: "suspend" });
    await rate(db, "m", 4, "good", at(T0, -2 * DAY));
    await act(db, "m", 4, T0, { action: "flag", reason: "unclear" });
    const repo = cardLibraryRepository(db);
    expect((await repo.readReviewDue(DUE)).materials[0]).toMatchObject({ againCount: 1, dayCount: 1, newCount: 0 });
    const nine = { nowUtc: at(NOW, -MIN), nextLocalMidnightUtc: MIDNIGHT };
    expect((await repo.readReviewDue(nine)).materials[0]).toMatchObject({ againCount: 0, dayCount: 1 });
  });

  it("filters by status and topic after deriving current counts", async () => {
    const db = await open(kind);
    await material(db, "mixed", cards("Mixed", 2), { topic: "weather" });
    await rate(db, "mixed", 0, "good", at(T0, -2 * DAY));
    await material(db, "fresh", cards("Fresh", 2));
    await material(db, "done", cards("Done", 1));
    await rate(db, "done", 0, "easy", T0);
    const repo = cardLibraryRepository(db);
    const ids = async (input: Partial<LibraryReviewDueInput>) => (await repo.readReviewDue({ ...DUE, ...input })).materials.map((m) => m.materialId);
    expect(await ids({})).toEqual(["mixed", "fresh"]);
    expect(await ids({ statusFilter: "due_today" })).toEqual(["mixed"]);
    expect(await ids({ statusFilter: "new_only" })).toEqual(["fresh"]);
    expect(await ids({ topic: "weather" })).toEqual(["mixed"]);
  });

  it("continuation is lossless and duplicate-free through page-size and batch changes", async () => {
    const db = await open(kind);
    for (let i = 0; i < 24; i++) {
      await material(db, `m-${String(i).padStart(2, "0")}`, cards(`M${i}`, 1 + (i % 4)), {
        priority: i % 5 === 0 ? "next_up" : "later",
        updatedAt: `2026-10-0${1 + (i % 5)}T0${i % 10}:00:00.000Z`,
      });
      if (i % 3 === 0) await rate(db, `m-${String(i).padStart(2, "0")}`, 0, "good", at(T0, -2 * DAY));
      if (i % 7 === 0) await rate(db, `m-${String(i).padStart(2, "0")}`, 0, "easy", T0); // no longer actionable when single-card
    }
    const repo = cardLibraryRepository(db);
    const all = (await repo.readReviewDue({ ...DUE, limit: 250 })).materials.map((m) => m.materialId).sort();
    const seen: string[] = [];
    let cursor: string | null = null;
    const limits = [2, 5, 1, 7, 3, 250];
    let page = 0;
    do {
      const result = await repo.readReviewDue({ ...DUE, limit: limits[page % limits.length], candidateBatchBudget: 4, cursor });
      seen.push(...result.materials.map((m) => m.materialId));
      cursor = result.nextCursor;
      page += 1;
    } while (cursor && page < 100);
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(all);
  });

  it("leftover candidates are revalidated: deleted, emptied and no-longer-actionable ones are dropped, the rest continue once", async () => {
    const db = await open(kind);
    for (const id of ["a", "b", "c", "d", "e", "f"]) await material(db, id, cards(id, 1), { updatedAt: T0 });
    const repo = cardLibraryRepository(db);
    const first = await repo.readReviewDue({ ...DUE, limit: 2 });
    expect(first.materials.map((m) => m.materialId)).toEqual(["a", "b"]);
    await db.execute("DELETE FROM study_materials WHERE id = 'c'");
    await db.execute("UPDATE ai_study_sets SET flashcards_json = '[]' WHERE source_material_id = 'd'");
    await act(db, "e", 0, T0, { action: "suspend" });
    const second = await repo.readReviewDue({ ...DUE, limit: 2, cursor: first.nextCursor });
    expect(second.materials.map((m) => m.materialId)).toEqual(["f"]);
    expect(second.nextCursor).toBeNull();
  });

  it("a changed filter or clock refuses an old cursor before any SQL", async () => {
    const db = await open(kind);
    for (const id of ["a", "b", "c"]) await material(db, id, cards(id, 1));
    const first = await cardLibraryRepository(db).readReviewDue({ ...DUE, limit: 1 });
    const { query, statements } = counting(db);
    expect(await refusal(readLibraryReviewDue(query, { ...DUE, nowUtc: at(NOW, 1), cursor: first.nextCursor }))).toBe("STALE_CURSOR");
    expect(await refusal(readLibraryReviewDue(query, { ...DUE, statusFilter: "new_only", cursor: first.nextCursor }))).toBe("STALE_CURSOR");
    expect(await refusal(readLibraryReviewDue(query, { ...DUE, cursor: `${first.nextCursor}x` }))).toBe("INVALID_CURSOR");
    expect(statements).toEqual([]);
  });

  it("an over-8 MiB set is never transferred; its issue links to the encoded Study route and discovery continues", async () => {
    const db = await open(kind);
    await material(db, "over/size", cards("Over", 1), { updatedAt: "2026-10-06T00:00:00.000Z", title: "Huge" });
    await db.execute(
      `UPDATE ai_study_sets SET flashcards_json = '[{"front":"' || hex(zeroblob(4200000)) || '","back":"B","sourcePage":null}]' WHERE source_material_id = 'over/size'`,
    );
    await material(db, "after", cards("After", 2), { updatedAt: "2026-10-05T00:00:00.000Z" });
    const { query, rawReads } = counting(db);
    const result = await readLibraryReviewDue(query, DUE);
    expect(result.issues).toEqual([
      { materialId: "over/size", title: "Huge", code: "PAYLOAD_TOO_LARGE", rawBytes: 8_400_043, allowedBytes: 8_388_608, inspectionTarget: "/study/over%2Fsize" },
    ]);
    expect(result.materials.map((m) => m.materialId)).toEqual(["after"]);
    expect(rawReads()).toBe(1);
    expect(result.summary.rawBytesTransferred).toBeLessThan(1_000);
    expect(result.summary.isComplete).toBe(true);
  }, 60_000);

  it("work reservations: a failed parse stays charged, a valid set reconciles, and the budget stops before the next read", async () => {
    const db = await open(kind);
    await material(db, "bad", "{not json", { updatedAt: "2026-10-06T03:00:00.000Z" });
    await material(db, "ok", cards("Ok", 7), { updatedAt: "2026-10-06T02:00:00.000Z" });
    await material(db, "later", cards("Later", 3), { updatedAt: "2026-10-06T01:00:00.000Z" });
    const { query, rawReads } = counting(db);
    const result = await readLibraryReviewDue(query, { ...DUE, maxBatchCardsBudget: 1_000 });
    expect(result.summary).toMatchObject({ rawReads: 2, attemptedCards: 507, evaluatedCards: 7, scannedCandidates: 2, evaluatedCandidates: 1 });
    expect(rawReads()).toBe(2);
    expect(result.materials.map((m) => m.materialId)).toEqual(["ok"]);
    const next = await readLibraryReviewDue(query, { ...DUE, maxBatchCardsBudget: 1_000, cursor: result.nextCursor });
    expect(next.materials.map((m) => m.materialId)).toEqual(["later"]);
    // A first set larger than the byte budget still gets the single-set lane, alone.
    const lane = await readLibraryReviewDue(query, { ...DUE, maxBatchRawJsonBytesBudget: 1024, maxBatchCardsBudget: 1 });
    expect(lane.summary.rawReads).toBe(1);
    expect(lane.nextCursor).not.toBeNull();
  });

  it("refuses bad inputs before any SQL", async () => {
    const db = await open(kind);
    const { query, statements } = counting(db);
    expect(await refusal(readLibraryReviewDue(query, { nowUtc: "2026-10-06T16:00:00Z", nextLocalMidnightUtc: MIDNIGHT }))).toBe("INVALID_TIME");
    expect(await refusal(readLibraryReviewDue(query, { ...DUE, statusFilter: "soon" as never }))).toBe("INVALID_FILTER");
    expect(await refusal(readLibraryReviewDue(query, { ...DUE, topic: "x".repeat(257) }))).toBe("INVALID_INPUT");
    expect(statements).toEqual([]);
  });
});

describe.each<Kind>(["node", "sqljs"])("library card history on %s", (kind) => {
  async function history(db: SqlDatabase) {
    await material(db, "a", cards("A", 6), { topic: "weather" });
    await material(db, "b", cards("B", 2));
    vi.setSystemTime(new Date(T0));
    for (let i = 0; i < 6; i++) await rate(db, "a", i, "good", T0); // six events at one instant
    await rate(db, "b", 0, "again", at(T0, MIN));
    await rate(db, "b", 1, "hard", at(T0, 2 * MIN));
  }

  it("event IDs, order and cursor stay stable across tied timestamps; filters apply before LIMIT", async () => {
    const db = await open(kind);
    await history(db);
    const repo = cardLibraryRepository(db);
    const full = (await repo.readRecentReviews({ limit: 100 })).rows.map((r) => r.id);
    expect(full).toHaveLength(8);
    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await repo.readRecentReviews({ limit: 3, cursor });
      paged.push(...page.rows.map((r) => r.id));
      cursor = page.next;
    } while (cursor);
    expect(paged).toEqual(full);
    const tied = full.slice(2);
    expect(tied).toEqual([...tied].sort().reverse());
    expect((await repo.readRecentReviews({ limit: 2, materialId: "b" })).rows.map((r) => r.materialId)).toEqual(["b", "b"]);
    expect((await repo.readRecentReviews({ limit: 20, topic: "weather" })).rows).toHaveLength(6);
  });

  it("enrichment-only reads no events and keeps nothing but target records", async () => {
    const db = await open(kind);
    await history(db);
    const { query, statements } = counting(db);
    const result = await readLibraryRecentReviews(query, { enrichmentOnly: true, enrichMaterialIds: ["a", "a", "nope"] });
    expect(statements.some((s) => s.includes("FROM card_review_events"))).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.next).toBeNull();
    expect(result.enrichment?.map((e) => [e.materialId, e.contentStatus, e.reason])).toEqual([
      ["a", "current", null],
      ["nope", "unavailable", "not_found"],
    ]);
  });

  it("a target already on the page is read once; page and targets share one work budget, leaving the rest pending", async () => {
    const db = await open(kind);
    await history(db);
    await material(db, "c", cards("C", 3));
    const { query, rawReads, statements } = counting(db);
    const combined = await readLibraryRecentReviews(query, { limit: 20, enrichMaterialIds: ["b", "c"] });
    expect(rawReads()).toBe(3); // b and c as targets, then a from the page
    expect(statements.filter((s) => s.startsWith("SELECT flashcards_json")).length).toBe(3);
    expect(combined.rows.every((r) => r.contentStatus === "current")).toBe(true);
    const tight = await readLibraryRecentReviews(query, { limit: 20, maxBatchCardsBudget: 501 });
    expect(tight.pendingMaterialIds).toEqual(["a"]);
    expect(tight.rows.filter((r) => r.materialId === "a").every((r) => r.isEarlierVersion === null && r.contentStatus === "pending")).toBe(true);
    const resolved = await readLibraryRecentReviews(query, { enrichmentOnly: true, enrichMaterialIds: tight.pendingMaterialIds });
    expect(resolved.enrichment).toEqual([{ materialId: "a", contentStatus: "current", currentVersionId: expect.any(String), reason: null, inspectionTarget: null }]);
  });

  it("an earlier version is detected from the current saved cards, never from stored flags", async () => {
    const db = await open(kind);
    await history(db);
    await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = 'b'", [JSON.stringify(cards("B2", 2))]);
    const rows = (await cardLibraryRepository(db).readRecentReviews({ materialId: "b" })).rows;
    expect(rows.map((r) => [r.contentStatus, r.isEarlierVersion])).toEqual([
      ["earlier", true],
      ["earlier", true],
    ]);
    const [active] = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM card_versions WHERE source_material_id = 'b' AND is_active = 1");
    expect(active!.n).toBe(1); // the stored flag still says active; the reader ignores it
  });

  it("an unsupported scheduler version keeps its raw audit text but no interval", async () => {
    const db = await open(kind);
    await history(db);
    await db.execute("UPDATE card_review_events SET scheduler_version = 'fsrs-6' WHERE item_id IN (SELECT id FROM card_items WHERE ordinal = 0) AND rating = 'again'");
    const row = (await cardLibraryRepository(db).readRecentReviews({ materialId: "b" })).rows.find((r) => r.rating === "again")!;
    expect(row.schedulerVersion).toBe("fsrs-6");
    expect(row.nextStateRaw).toContain("simple-v1");
    expect(row.nextState).toMatchObject({ step: -1 });
    expect([row.nextSchedule, row.intervalLabel, row.step]).toEqual([null, null, null]);
  });

  it("invalid targets are refused before any SQL", async () => {
    const db = await open(kind);
    const { query, statements } = counting(db);
    expect(await refusal(readLibraryRecentReviews(query, { enrichMaterialIds: Array.from({ length: 251 }, (_, i) => `t${i}`) }))).toBe("INVALID_TARGET");
    expect(await refusal(readLibraryRecentReviews(query, { enrichMaterialIds: "a" as never }))).toBe("INVALID_TARGET");
    expect(await refusal(readLibraryRecentReviews(query, { enrichMaterialIds: ["x".repeat(65)] }))).toBe("INVALID_TARGET");
    expect(statements).toEqual([]);
    // 250 distinct after de-duplication is allowed.
    expect(await refusal(readLibraryRecentReviews(query, { enrichmentOnly: true, enrichMaterialIds: [...Array.from({ length: 250 }, (_, i) => `t${i}`), "t0"] }))).toBe("ok");
  });
});
