/**
 * M2-3 C1: the card-review read and write contract on the real
 * single-connection drivers — node:sqlite (tests) and sql.js over its WASM
 * build with an in-memory storage map (browser). Every case runs on both.
 *
 * Disposable databases, an injected clock (fake `Date` only) and fixed IANA
 * zones; never a real profile, provider or network. The native rusqlite path
 * is proved by `src-tauri/src/card_reviews_tests.rs`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs, { type BindParams } from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedPracticeTest } from "./testing/practiceTestFixtures";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import type { CardItemAction, CardRating, CardReviewAction, CardReviewSnapshot } from "@/domain/types";
import { cardVersion, type CanonicalCard } from "@/logic/cardIdentity";
import { DAY, MINUTE } from "@/logic/cardScheduler";
import { nextLocalMidnightUtc } from "@/logic/localDay";

import type { SqlDatabase } from "./db";
import { CardReviewError, DatabaseDisabledError, StorageDurabilityError } from "./persistenceErrors";
import { cardReviewRepository, type CardReviewRepository } from "./repositories/cardReviewRepository";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
const STORAGE_KEY = "her-flight-deck.dev-database";
const M = "mat-cards";
const OTHER = "mat-other";
const T0 = "2026-10-06T15:00:00.000Z";
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

const cardsA: CanonicalCard[] = [
  { front: "Synthetic card one: which letter follows A?", back: "B", sourcePage: 1 },
  { front: "Synthetic card two: which letter follows B?", back: "C", sourcePage: 2 },
  { front: "Synthetic card three: which letter follows C?", back: "D", sourcePage: null },
];
const cardsB = cardsA.map((card, i) => ({ ...card, back: `Synthetic regenerated ${i}` }));
const many = (label: string, n: number): CanonicalCard[] =>
  Array.from({ length: n }, (_, i) => ({ front: `${label} ${i}`, back: label, sourcePage: null }));

let stored: Map<string, string>;
let storageFails: boolean;
let tempDirs: string[];
let opened: { close?: () => void }[];

beforeEach(() => {
  stored = new Map();
  storageFails = false;
  tempDirs = [];
  opened = [];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageFails) throw new Error("synthetic quota failure");
      stored.set(key, value);
    },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  for (const db of opened) {
    try {
      db.close?.();
    } catch {
      // already closed
    }
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Kind = "node" | "sqljs";

/** A fresh database on the driver, plus a way to reopen the same storage. */
async function open(kind: Kind): Promise<{ db: SqlDatabase; reopen: () => Promise<SqlDatabase> }> {
  if (kind === "sqljs") {
    const db = await createSqlJsDatabase();
    return { db, reopen: () => createSqlJsDatabase() };
  }
  const dir = mkdtempSync(join(tmpdir(), "card-review-"));
  tempDirs.push(dir);
  const path = join(dir, "cards.db");
  const first: TestDatabase = await createNodeSqliteDatabase(path);
  opened.push(first);
  return {
    db: first,
    reopen: async () => {
      first.close();
      const again = await createNodeSqliteDatabase(path);
      opened.push(again);
      return again;
    },
  };
}

async function seedMaterial(db: SqlDatabase, id: string, cards: CanonicalCard[] | string, provider = "import") {
  await db.execute(
    "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, 'Synthetic airspace letters', ?, ?)",
    [id, T0, T0],
  );
  await db.execute(
    `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
     VALUES (?, 'Synthetic', '', '[]', ?, '', ?, '', ?, ?)`,
    [id, typeof cards === "string" ? cards : JSON.stringify(cards), provider, T0, T0],
  );
}

async function setCards(db: SqlDatabase, id: string, cards: CanonicalCard[] | string) {
  await db.execute("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = ?", [
    typeof cards === "string" ? cards : JSON.stringify(cards),
    id,
  ]);
}

async function counts(db: SqlDatabase, materialId = M) {
  const [row] = await db.select<Record<string, number>>(
    `SELECT
       (SELECT COUNT(*) FROM card_review_state WHERE source_material_id = ?) AS states,
       (SELECT COUNT(*) FROM card_review_events e JOIN card_items i ON i.id = e.item_id JOIN card_versions v ON v.id = i.version_id WHERE v.source_material_id = ?) AS events,
       (SELECT COUNT(*) FROM card_review_operations WHERE source_material_id = ?) AS receipts,
       (SELECT COUNT(*) FROM card_review_operations WHERE source_material_id = ? AND is_erased = 1) AS tombstones,
       (SELECT COUNT(*) FROM card_versions WHERE source_material_id = ?) AS versions,
       (SELECT COALESCE(MAX(generation), 0) FROM card_review_generations WHERE source_material_id = ?) AS generation`,
    [materialId, materialId, materialId, materialId, materialId, materialId],
  );
  return { ...row };
}

let opCounter = 0;
const opId = () => {
  opCounter += 1;
  return `c1000000-0000-4000-8000-${opCounter.toString(16).padStart(12, "0")}`;
};

/** A deliberate item action built from an authoritative snapshot. */
function itemAction(
  snapshot: CardReviewSnapshot,
  ordinal: number,
  kind: { action: "rate"; rating: CardRating } | { action: "suspend" | "resume" | "unflag" } | { action: "flag"; reason: "wrong_answer" | "unclear" | "not_in_source" },
): CardItemAction {
  if (snapshot.current.status !== "ok") throw new Error("no current cards");
  const item = snapshot.current.items[ordinal]!;
  return {
    operationId: opId(),
    materialId: snapshot.materialId,
    versionContentHash: snapshot.current.contentHash,
    itemId: item.itemId,
    expectedGeneration: snapshot.generation,
    expectedRevision: snapshot.states[item.itemId]?.revision ?? 0,
    ...kind,
  } as CardItemAction;
}

const reset = (snapshot: CardReviewSnapshot): CardReviewAction => ({
  action: "reset",
  operationId: opId(),
  materialId: snapshot.materialId,
  expectedGeneration: snapshot.generation,
});

/** Rate one current card at a given instant, through a fresh snapshot. */
async function rateAt(repo: CardReviewRepository, materialId: string, ordinal: number, rating: CardRating, when: string) {
  vi.setSystemTime(new Date(when));
  const snapshot = await repo.getCardReviewSnapshot(materialId);
  return repo.saveAction(itemAction(snapshot, ordinal, { action: "rate", rating }));
}

async function itemActionNow(repo: CardReviewRepository, materialId: string, ordinal: number, kind: Parameters<typeof itemAction>[2]) {
  const snapshot = await repo.getCardReviewSnapshot(materialId);
  return repo.saveAction(itemAction(snapshot, ordinal, kind));
}

async function queue(repo: CardReviewRepository, materialId: string, nowUtc: string, timeZone: string, caps: { maxNew?: number; maxTotal?: number } = {}) {
  const snapshot = await repo.getCardReviewSnapshot(materialId);
  if (snapshot.current.status !== "ok") throw new Error("no current cards");
  return repo.getDueQueue({
    materialId,
    currentVersionId: snapshot.current.versionId,
    currentItemIds: snapshot.current.items.map((item) => item.itemId),
    nowUtc,
    nextLocalMidnightUtc: nextLocalMidnightUtc(nowUtc, timeZone),
    ...caps,
  });
}

const refusedWith = (code: string) => (error: unknown) => error instanceof CardReviewError && error.code === code;

describe.each<Kind>(["node", "sqljs"])("card review contract on %s", (kind) => {
  describe("CRS-R1 version-owned due queue with exact boundaries", () => {
    it("[promoted 1] an Again card is not returned at minute nine and is returned first at minute ten", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const A = await cardVersion(M, cardsA);
      await rateAt(repo, M, 0, "again", T0);
      const nine = await queue(repo, M, at(T0, 9 * MINUTE), "UTC");
      expect(nine.map((c) => [c.itemId, c.kind])).toEqual([
        [A.items[1]!.itemId, "new"],
        [A.items[2]!.itemId, "new"],
      ]);
      const ten = await queue(repo, M, at(T0, 10 * MINUTE), "UTC");
      expect(ten.map((c) => [c.itemId, c.kind])).toEqual([
        [A.items[0]!.itemId, "again"],
        [A.items[1]!.itemId, "new"],
        [A.items[2]!.itemId, "new"],
      ]);
    });

    it("a day-ladder card due exactly at next local midnight is excluded; one millisecond earlier is included", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const A = await cardVersion(M, cardsA);
      const now = "2026-10-07T20:00:00.000Z"; // 15:00 in Chicago
      const boundary = nextLocalMidnightUtc(now, "America/Chicago");
      expect(boundary).toBe("2026-10-08T05:00:00.000Z");
      await rateAt(repo, M, 0, "good", at(boundary, -DAY)); // due exactly at the boundary
      await rateAt(repo, M, 1, "good", at(boundary, -DAY - 1)); // due one millisecond earlier
      vi.setSystemTime(new Date(now));
      const due = await queue(repo, M, now, "America/Chicago", { maxNew: 0 });
      expect(due.map((c) => c.itemId)).toEqual([A.items[1]!.itemId]);
    });

    it("daylight saving: the 25-hour local day in Chicago (1 November 2026) gets the exact exclusive boundary", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const A = await cardVersion(M, cardsA);
      expect(nextLocalMidnightUtc("2026-10-31T17:00:00.000Z", "America/Chicago")).toBe("2026-11-01T05:00:00.000Z");
      const now = "2026-11-01T17:00:00.000Z"; // 11:00 CST, after fall-back
      expect(nextLocalMidnightUtc(now, "America/Chicago")).toBe("2026-11-02T06:00:00.000Z");
      await rateAt(repo, M, 0, "good", "2026-11-01T05:30:00.000Z"); // due 23:30 CST on 1 November
      await rateAt(repo, M, 1, "good", "2026-11-01T06:00:00.000Z"); // due exactly at the boundary
      vi.setSystemTime(new Date(now));
      expect((await queue(repo, M, now, "America/Chicago", { maxNew: 0 })).map((c) => c.itemId)).toEqual([A.items[0]!.itemId]);
    });

    it("[promoted 2] with old A and current materialized B both due, only B is current due work", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      await rateAt(repo, M, 0, "good", at(T0, -2 * DAY));
      await setCards(db, M, cardsB); // a real regeneration
      const B = await cardVersion(M, cardsB);
      await rateAt(repo, M, 0, "good", at(T0, -2 * DAY));
      vi.setSystemTime(new Date(T0));
      const due = await queue(repo, M, T0, "UTC");
      expect(due.map((c) => [c.itemId, c.kind])).toEqual([
        [B.items[0]!.itemId, "due"],
        [B.items[1]!.itemId, "new"],
        [B.items[2]!.itemId, "new"],
      ]);
    });

    it("before B's first materialization, B's cards are new and A's retained due rows are not current work", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      for (const ordinal of [0, 1, 2]) await rateAt(repo, M, ordinal, "good", at(T0, -2 * DAY));
      await setCards(db, M, cardsB);
      const B = await cardVersion(M, cardsB);
      vi.setSystemTime(new Date(T0));
      const [active] = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM card_versions WHERE is_active = 1");
      expect(active!.n).toBe(1); // only A exists and is marked active
      expect((await queue(repo, M, T0, "UTC")).map((c) => [c.itemId, c.kind])).toEqual(B.items.map((item) => [item.itemId, "new"]));
    });

    it("A -> B -> A: when the raw cards return to A, A's retained schedule is current again", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const A = await cardVersion(M, cardsA);
      await rateAt(repo, M, 2, "good", at(T0, -2 * DAY));
      await setCards(db, M, cardsB);
      await rateAt(repo, M, 0, "good", at(T0, -2 * DAY));
      await setCards(db, M, structuredClone(cardsA));
      vi.setSystemTime(new Date(T0));
      const due = await queue(repo, M, T0, "UTC");
      expect(due[0]).toEqual({ itemId: A.items[2]!.itemId, kind: "due", dueAt: at(T0, -DAY), ordinal: 2 });
    });

    it("never-rated suspended and flagged cards are excluded from new work before the caps", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsB);
      const B = await cardVersion(M, cardsB);
      await itemActionNow(repo, M, 0, { action: "suspend" });
      await itemActionNow(repo, M, 1, { action: "flag", reason: "unclear" });
      expect((await queue(repo, M, T0, "UTC", { maxNew: 1 })).map((c) => c.itemId)).toEqual([B.items[2]!.itemId]);
    });

    it("order and limits apply after eligibility, even behind 200 ineligible older rows", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      const old = many("Old", 200);
      await seedMaterial(db, M, old);
      for (let i = 0; i < 200; i++) await rateAt(repo, M, i, "good", "2026-01-01T00:00:00.000Z");
      const currentCards = many("Current", 30);
      await setCards(db, M, currentCards);
      const current = await cardVersion(M, currentCards);
      const now = T0;
      await rateAt(repo, M, 4, "again", at(now, -15 * MINUTE)); // due now - 5 minutes
      await rateAt(repo, M, 5, "again", at(now, -12 * MINUTE)); // due now - 2 minutes
      await rateAt(repo, M, 6, "again", at(now, -5 * MINUTE)); // due now + 5 minutes: not yet
      for (let k = 0; k < 12; k++) {
        const ordinal = 7 + k;
        const dueDaysAgo = ordinal === 17 ? 3 : 12 - k; // 16 and 17 share a due instant
        await rateAt(repo, M, ordinal, "good", at(now, -(dueDaysAgo + 1) * DAY));
      }
      await rateAt(repo, M, 19, "good", at(now, -2 * DAY));
      vi.setSystemTime(new Date(now));
      await itemActionNow(repo, M, 19, { action: "suspend" });
      await rateAt(repo, M, 20, "good", at(now, -2 * DAY));
      vi.setSystemTime(new Date(now));
      await itemActionNow(repo, M, 20, { action: "flag", reason: "wrong_answer" });

      const due = await queue(repo, M, now, "UTC");
      const ids = due.map((c) => c.itemId);
      const kinds = due.map((c) => c.kind);
      expect(due).toHaveLength(20);
      expect(ids.slice(0, 2)).toEqual([current.items[4]!.itemId, current.items[5]!.itemId]);
      expect(kinds.slice(0, 2)).toEqual(["again", "again"]);
      expect(kinds.filter((k) => k === "due")).toHaveLength(12);
      expect(due.filter((c) => c.kind === "new").map((c) => c.ordinal)).toEqual([0, 1, 2, 3, 21, 22]);
      expect(due.filter((c) => c.kind === "due").map((c) => c.ordinal).slice(-3)).toEqual([16, 17, 18]);
      const [oldRows] = await db.select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM card_review_state s JOIN card_items i ON i.id = s.item_id WHERE i.version_id != ?",
        [current.versionId],
      );
      expect(oldRows!.n).toBe(200);
      expect([6, 19, 20].some((n) => ids.includes(current.items[n]!.itemId))).toBe(false);
    }, 60_000); // 230 real writes; sql.js stores the whole database after each one
  });

  describe("CRS-R2 persistent reset generation on real transactions", () => {
    it("[promoted 3] reset racing a queued rating: the pre-reset revision-0 rating is refused, nothing written", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const captured = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "rate", rating: "good" });
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      const before = await counts(db);
      await expect(repo.saveAction(captured)).rejects.toSatisfy(refusedWith("STALE_GENERATION"));
      expect(await counts(db)).toEqual(before);
      expect(before.generation).toBe(1);
    });

    it("[promoted 4] a pre-reset revision-1 request stays refused after a new-generation rating reaches revision 1", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      await rateAt(repo, M, 0, "good", T0);
      const captured = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "rate", rating: "easy" });
      expect(captured.expectedRevision).toBe(1);
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      await rateAt(repo, M, 0, "good", at(T0, MINUTE));
      const snapshot = await repo.getCardReviewSnapshot(M);
      if (snapshot.current.status !== "ok") throw new Error("expected cards");
      expect(snapshot.states[snapshot.current.items[0]!.itemId]!.revision).toBe(1);
      const before = await counts(db);
      await expect(repo.saveAction(captured)).rejects.toSatisfy(refusedWith("STALE_GENERATION"));
      expect(await counts(db)).toEqual(before);
    });

    it("[promoted 5] repeated resets succeed; tombstones are skipped and keep routing metadata", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const rated = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "rate", rating: "good" });
      await repo.saveAction(rated);
      const firstReset = reset(await repo.getCardReviewSnapshot(M));
      await repo.saveAction(firstReset);
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      const [tomb] = await db.select<Record<string, unknown>>(
        "SELECT action, source_material_id, generation, request_hash, is_erased, result_json FROM card_review_operations WHERE operation_id = ?",
        [rated.operationId],
      );
      expect(tomb).toMatchObject({ action: "rate", source_material_id: M, generation: 0, is_erased: 1, result_json: null });
      expect(String(tomb!.request_hash)).toMatch(/^[0-9a-f]{64}$/);
      await expect(repo.saveAction(firstReset)).rejects.toSatisfy(refusedWith("OPERATION_ERASED"));
      expect((await counts(db)).generation).toBe(2);
    });

    it("a committed reset replayed after reopen and after new work returns its stored result and erases nothing", async () => {
      const { db, reopen } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const resetAction = reset(await repo.getCardReviewSnapshot(M));
      const first = await repo.saveAction(resetAction);
      await rateAt(repo, M, 0, "good", at(T0, MINUTE));
      const handle = await reopen();
      const reopened = cardReviewRepository(handle);
      const before = await counts(handle);
      expect(await reopened.saveAction(resetAction)).toEqual(first);
      expect(await counts(handle)).toEqual(before);
      expect(before).toMatchObject({ generation: 1, states: 1, events: 1 });
    });

    it("reusing a reset operation ID with a changed payload conflicts; a stale-generation reset is refused", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const resetAction = reset(await repo.getCardReviewSnapshot(M));
      await repo.saveAction(resetAction);
      const before = await counts(db);
      await expect(repo.saveAction({ ...resetAction, expectedGeneration: 1 })).rejects.toSatisfy(refusedWith("OPERATION_CONFLICT"));
      await expect(repo.saveAction({ ...resetAction, operationId: opId() })).rejects.toSatisfy(refusedWith("STALE_GENERATION"));
      expect(await counts(db)).toEqual(before);
    });

    it("fresh work after refresh is accepted, and a new intentional reset applies again", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      await rateAt(repo, M, 0, "good", T0);
      expect((await counts(db)).events).toBe(1);
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      expect(await counts(db)).toMatchObject({ generation: 2, events: 0, states: 0 });
    });

    it("reset touches only its material: another material's cards and all practice data remain", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      await seedMaterial(db, OTHER, cardsA);
      await seedPracticeTest(db, {
        sourceMaterialId: M,
        title: "Synthetic test",
        model: "synthetic",
        questions: [{ question: "Synthetic?", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null }],
      });
      const practice = practiceSessionRepository(db);
      const version = (await practice.getActiveVersion(M))!;
      await practice.saveSessionAction({
        action: "start_or_resume",
        operationId: "d1000000-0000-4000-8000-000000000001",
        materialId: M,
        versionId: version.version.id,
      });
      const practiceCounts = async () =>
        (
          await db.select<Record<string, number>>(
            `SELECT (SELECT COUNT(*) FROM practice_test_versions) AS versions, (SELECT COUNT(*) FROM practice_attempts) AS attempts,
                    (SELECT COUNT(*) FROM practice_session_operations) AS receipts, (SELECT COUNT(*) FROM ai_study_sets) AS sets`,
          )
        )[0];
      await rateAt(repo, M, 0, "good", T0);
      const otherRated = await rateAt(repo, OTHER, 0, "good", T0);
      const otherBefore = await counts(db, OTHER);
      const practiceBefore = await practiceCounts();
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      expect(await counts(db, OTHER)).toEqual(otherBefore);
      expect(await practiceCounts()).toEqual(practiceBefore);
      const [receipt] = await db.select<{ is_erased: number }>(
        "SELECT is_erased FROM card_review_operations WHERE source_material_id = ? AND action = 'rate'",
        [OTHER],
      );
      expect(receipt!.is_erased).toBe(0);
      expect("revision" in otherRated && otherRated.revision).toBe(1);
    });

    it("reset is strictly typed: item fields on a reset, or a missing generation on an item action, are invalid", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const snapshot = await repo.getCardReviewSnapshot(M);
      const withItem = { ...reset(snapshot), itemId: "0".repeat(64) } as unknown as CardReviewAction;
      await expect(repo.saveAction(withItem)).rejects.toSatisfy(refusedWith("INVALID_ARGUMENT"));
      const { expectedGeneration, ...missing } = itemAction(snapshot, 0, { action: "rate", rating: "good" });
      void expectedGeneration;
      await expect(repo.saveAction(missing as unknown as CardReviewAction)).rejects.toSatisfy(refusedWith("INVALID_ARGUMENT"));
      const extra = { ...itemAction(snapshot, 0, { action: "suspend" }), rating: "good" } as unknown as CardReviewAction;
      await expect(repo.saveAction(extra)).rejects.toSatisfy(refusedWith("INVALID_ARGUMENT"));
      expect(await counts(db)).toMatchObject({ states: 0, events: 0, receipts: 0, versions: 0 });
    });

    it("reset keeps the snapshot of the current raw cards and prunes retained older versions", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      await rateAt(repo, M, 0, "good", T0);
      await setCards(db, M, cardsB);
      const B = await cardVersion(M, cardsB);
      await rateAt(repo, M, 0, "good", at(T0, MINUTE));
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      expect(await db.select("SELECT id, first_reviewed_at, is_active FROM card_versions WHERE source_material_id = ?", [M])).toEqual([
        { id: B.versionId, first_reviewed_at: null, is_active: 1 },
      ]);
      expect(await counts(db)).toMatchObject({ states: 0, events: 0 });
    });

    it("reset of a material whose saved cards are damaged prunes every snapshot", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      await rateAt(repo, M, 0, "good", T0);
      await setCards(db, M, "{not json");
      const snapshot = await repo.getCardReviewSnapshot(M);
      expect(snapshot.current).toEqual({ status: "malformed" });
      await repo.saveAction(reset(snapshot));
      expect(await counts(db)).toMatchObject({ versions: 0, states: 0, events: 0, generation: 1 });
    });
  });

  describe("item actions, replay and refusals", () => {
    it("first suspend before any rating creates the snapshot with no review time and no event", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const result = await itemActionNow(repo, M, 1, { action: "suspend" });
      expect(result).toMatchObject({ action: "suspend", revision: 1, dueAt: null, reviewedAt: null, suspended: true, flag: null });
      expect(await db.select("SELECT created_at, first_reviewed_at, is_active, card_count, provider FROM card_versions")).toEqual([
        { created_at: T0, first_reviewed_at: null, is_active: 1, card_count: 3, provider: "import" },
      ]);
      expect((await counts(db)).events).toBe(0);
      vi.setSystemTime(new Date(at(T0, MINUTE)));
      await itemActionNow(repo, M, 1, { action: "resume" });
      await rateAt(repo, M, 1, "easy", at(T0, 2 * MINUTE));
      expect(await db.select("SELECT created_at, first_reviewed_at FROM card_versions")).toEqual([
        { created_at: T0, first_reviewed_at: at(T0, 2 * MINUTE) },
      ]);
    });

    it("a flagged card refuses ratings until unflagged, without changing its schedule", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const rated = await rateAt(repo, M, 0, "good", T0);
      await itemActionNow(repo, M, 0, { action: "flag", reason: "not_in_source" });
      vi.setSystemTime(new Date(at(T0, DAY)));
      await expect(itemActionNow(repo, M, 0, { action: "rate", rating: "good" })).rejects.toSatisfy(refusedWith("CARD_FLAGGED"));
      const unflagged = await itemActionNow(repo, M, 0, { action: "unflag" });
      expect("dueAt" in unflagged && "dueAt" in rated && unflagged.dueAt === rated.dueAt).toBe(true);
      await itemActionNow(repo, M, 0, { action: "suspend" });
      await expect(itemActionNow(repo, M, 0, { action: "rate", rating: "good" })).rejects.toSatisfy(refusedWith("CARD_SUSPENDED"));
      expect((await counts(db)).events).toBe(1);
    });

    it("same-ID replay after reopen returns the stored result once; a changed payload conflicts", async () => {
      const { db, reopen } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const action = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "rate", rating: "good" });
      const first = await repo.saveAction(action);
      const handle = await reopen();
      const reopened = cardReviewRepository(handle);
      vi.setSystemTime(new Date(at(T0, 5 * MINUTE)));
      expect(await reopened.saveAction(action)).toEqual(first);
      expect(await counts(handle)).toMatchObject({ events: 1, receipts: 1 });
      await expect(reopened.saveAction({ ...action, rating: "easy" } as CardReviewAction)).rejects.toSatisfy(refusedWith("OPERATION_CONFLICT"));
      expect(await reopened.getOperationStatus(action)).toMatchObject({ state: "applied", sameRequest: true, result: first });
    });

    it("a stale revision and stale content are refused without writing", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const stale = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "rate", rating: "good" });
      await rateAt(repo, M, 0, "good", T0);
      const before = await counts(db);
      await expect(repo.saveAction(stale)).rejects.toSatisfy(refusedWith("STALE_REVISION"));
      const old = itemAction(await repo.getCardReviewSnapshot(M), 1, { action: "rate", rating: "good" });
      await setCards(db, M, cardsB);
      await expect(repo.saveAction(old)).rejects.toSatisfy(refusedWith("STALE_CONTENT"));
      expect(await counts(db)).toEqual(before);
    });

    it("malformed saved cards read as malformed and refuse item actions; empty cards read as none", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const prepared = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "suspend" });
      for (const damaged of [
        "{not json",
        JSON.stringify([{ front: "", back: "B", sourcePage: null }]),
        JSON.stringify([{ front: "F", back: "B" }]),
        JSON.stringify([{ front: "F", back: "B", sourcePage: 0 }]),
        JSON.stringify(many("Too many", 501)),
      ]) {
        await setCards(db, M, damaged);
        expect((await repo.getCardReviewSnapshot(M)).current).toEqual({ status: "malformed" });
        await expect(repo.saveAction({ ...prepared, operationId: opId() })).rejects.toSatisfy(refusedWith("MALFORMED_CARDS"));
      }
      await setCards(db, M, "[]");
      expect((await repo.getCardReviewSnapshot(M)).current).toEqual({ status: "none" });
      await expect(repo.saveAction({ ...prepared, operationId: opId() })).rejects.toSatisfy(refusedWith("NOT_FOUND"));
      expect(await counts(db)).toMatchObject({ versions: 0, states: 0, receipts: 0 });
    });

    it("clock rollback: a rating earlier than the last review is refused with nothing written", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      await rateAt(repo, M, 0, "good", T0);
      const before = await counts(db);
      await expect(rateAt(repo, M, 0, "good", at(T0, -MINUTE))).rejects.toSatisfy(refusedWith("CLOCK_BEHIND_LAST_REVIEW"));
      expect(await counts(db)).toEqual(before);
      await expect(rateAt(repo, M, 0, "good", T0)).resolves.toMatchObject({ revision: 2 });
    });

    it("deleting the material cascades its card history; tombstones refuse a late replay", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const rated = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "rate", rating: "good" });
      await repo.saveAction(rated);
      await repo.saveAction(reset(await repo.getCardReviewSnapshot(M)));
      await itemActionNow(repo, M, 1, { action: "flag", reason: "unclear" });
      await db.execute("DELETE FROM study_materials WHERE id = ?", [M]);
      expect(await counts(db)).toEqual({ states: 0, events: 0, receipts: 3, tombstones: 3, versions: 0, generation: 0 });
      const [items] = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM card_items");
      expect(items!.n).toBe(0);
      await expect(repo.saveAction(rated)).rejects.toSatisfy(refusedWith("OPERATION_ERASED"));
    });

    it("a repository over a driver without the atomic method refuses with UNSUPPORTED_DRIVER and writes nothing", async () => {
      const { db } = await open(kind);
      await seedMaterial(db, M, cardsA);
      const snapshot = await cardReviewRepository(db).getCardReviewSnapshot(M);
      const limited: SqlDatabase = { select: db.select.bind(db), execute: db.execute.bind(db) };
      await expect(cardReviewRepository(limited).saveAction(reset(snapshot))).rejects.toSatisfy(refusedWith("UNSUPPORTED_DRIVER"));
      expect(await counts(db)).toMatchObject({ receipts: 0, generation: 0 });
    });

    it("reads never write", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      await seedMaterial(db, M, cardsA);
      const executeSpy = vi.spyOn(db, "execute");
      const writeSpy = vi.spyOn(db, "saveCardReviewAtomically" as never);
      await queue(repo, M, T0, "UTC");
      await repo.getRecentReviews(M);
      await repo.getOperationStatus(reset(await repo.getCardReviewSnapshot(M)));
      expect(executeSpy).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(await counts(db)).toMatchObject({ versions: 0, states: 0 });
    });
  });

  describe("scale", () => {
    it("a 500-card set queues correctly and 10,000 events page in 20s with earlier versions labelled", async () => {
      const { db } = await open(kind);
      const repo = cardReviewRepository(db);
      const big = many("Big", 500);
      await seedMaterial(db, M, big);
      await rateAt(repo, M, 499, "good", at(T0, -2 * DAY));
      const version = await cardVersion(M, big);
      // 9,999 more synthetic history rows for the same card (bulk seeded; the
      // paging read is what is measured, not the write path).
      await db.execute(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 9999)
         INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
         SELECT printf('e%08d', i), ?, 0, 'good', strftime('%Y-%m-%dT%H:%M:%fZ', '2025-01-01', '+' || (i / 7) || ' minutes'), 'simple-v1', 'null', '{}' FROM n`,
        [version.items[499]!.itemId],
      );
      vi.setSystemTime(new Date(T0));
      const due = await queue(repo, M, T0, "UTC");
      expect(due).toHaveLength(11);
      expect(due[0]).toMatchObject({ kind: "due", ordinal: 499 });
      expect(due.slice(1).map((c) => c.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      await setCards(db, M, cardsA); // the 500-card history is now an earlier version
      const seen = new Set<string>();
      let cursor = null;
      let pages = 0;
      let previous: string | null = null;
      do {
        const page: Awaited<ReturnType<CardReviewRepository["getRecentReviews"]>> = await repo.getRecentReviews(M, cursor);
        expect(page.rows.length).toBeLessThanOrEqual(20);
        for (const row of page.rows) {
          const key = `${row.reviewedAt}|${row.id}`;
          if (previous !== null) expect(key < previous).toBe(true);
          previous = key;
          seen.add(row.id);
          expect(row.earlierVersion).toBe(true);
        }
        cursor = page.next;
        pages += 1;
      } while (cursor);
      expect(seen.size).toBe(10_000);
      expect(pages).toBe(500);
    }, 60_000); // 500 page reads over 10,000 rows
  });
});

describe("browser storage durability for card reviews (sql.js)", () => {
  it("storage refusal restores the durable bytes; the same ID then saves afresh", async () => {
    const db = await createSqlJsDatabase();
    const repo = cardReviewRepository(db);
    await seedMaterial(db, M, cardsA);
    const before = stored.get(STORAGE_KEY);
    const action = itemAction(await repo.getCardReviewSnapshot(M), 0, { action: "rate", rating: "good" });
    storageFails = true;
    await expect(repo.saveAction(action)).rejects.toBeInstanceOf(StorageDurabilityError);
    expect(stored.get(STORAGE_KEY)).toBe(before);
    expect(await counts(db)).toMatchObject({ versions: 0, states: 0, events: 0, receipts: 0 });
    storageFails = false;
    await expect(repo.saveAction(action)).resolves.toMatchObject({ revision: 1 });
    expect(await counts(db)).toMatchObject({ versions: 1, states: 1, events: 1, receipts: 1 });
  });

  it("a reset whose recovery fails disables the adapter and keeps every saved row", async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const db = await createSqlJsDatabase();
    const repo = cardReviewRepository(db);
    await seedMaterial(db, M, cardsA);
    await rateAt(repo, M, 0, "good", T0);
    const before = await counts(db);
    const storedBefore = stored.get(STORAGE_KEY);
    const resetAction = reset(await repo.getCardReviewSnapshot(M));

    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic export failure");
    });
    const originalExec = SQL.Database.prototype.exec;
    vi.spyOn(SQL.Database.prototype, "exec").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (/^\s*PRAGMA foreign_keys\s*;?\s*$/i.test(sql)) return [{ columns: ["foreign_keys"], values: [[0]] }];
      return originalExec.call(this, sql, params);
    });
    await expect(repo.saveAction(resetAction)).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(repo.saveAction(resetAction)).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(db.select("SELECT 1")).rejects.toBeInstanceOf(DatabaseDisabledError);
    expect(stored.get(STORAGE_KEY)).toBe(storedBefore);
    vi.restoreAllMocks();

    const reopened = await createSqlJsDatabase();
    expect(await counts(reopened)).toEqual(before);
    expect(await cardReviewRepository(reopened).saveAction(resetAction)).toEqual({ action: "reset", materialId: M, generation: 1 });
  });
});

describe("schema upgrade and ceiling (node:sqlite)", () => {
  it("a schema-11 database upgrades through 12 to the latest schema with empty card tables (generation 0 everywhere)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "card-upgrade-"));
    tempDirs.push(dir);
    const path = join(dir, "eleven.db");
    const { DatabaseSync } = await import(/* @vite-ignore */ "node:sqlite");
    const raw = new DatabaseSync(path);
    const { MIGRATIONS } = await import("./migrations");
    raw.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of MIGRATIONS.filter((m) => m.version <= 11)) {
      raw.exec(migration.sql);
      raw.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(migration.version, migration.description, T0);
    }
    raw.exec(`INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('${M}', 'Synthetic', '${T0}', '${T0}')`);
    raw.prepare(
      `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
       VALUES (?, 'S', '', '[]', ?, '', 'gemini', 'synthetic', ?, ?)`,
    ).run(M, JSON.stringify(cardsA), T0, T0);
    raw.close();

    const db = await createNodeSqliteDatabase(path);
    opened.push(db);
    expect(await db.select("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: MIGRATIONS.at(-1)!.version }]);
    const snapshot = await cardReviewRepository(db).getCardReviewSnapshot(M);
    expect(snapshot).toMatchObject({ generation: 0, states: {}, current: { status: "ok" } });
    expect(await counts(db)).toMatchObject({ versions: 0, receipts: 0 });
  });

  it("a database from a newer format (one past the latest schema) is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "card-ceiling-"));
    tempDirs.push(dir);
    const path = join(dir, "future.db");
    const { MIGRATIONS } = await import("./migrations");
    const first = await createNodeSqliteDatabase(path);
    await first.execute("INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, 'future', ?)", [
      MIGRATIONS.at(-1)!.version + 1,
      T0,
    ]);
    first.close();
    await expect(createNodeSqliteDatabase(path)).rejects.toThrow(/newer format/);
  });
});
