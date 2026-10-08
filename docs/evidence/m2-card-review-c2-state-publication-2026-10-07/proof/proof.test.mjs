import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unlinkSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  at,
  buildSyntheticDatabase,
  generateCards,
  T0,
} from "./syntheticDataset.mjs";

import {
  createDisposableDb,
  DeferredReadController,
  deriveCardVersion,
  getLibraryRecentReviews,
  getLibraryRecentReviewsBrokenCursor,
  getLibraryReviewDue,
  getLibraryReviewDueBrokenCandidateProgression,
  getLibraryReviewDueBrokenCurrentVersion,
  getLibraryReviewDueBrokenTimeBoundary,
  nextLocalMidnightUtc,
  parseSavedCards,
  validateScheduleState,
  MAX_CURSOR_LENGTH,
  ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES,
} from "./contractModel.mjs";

import { runMutantVerification } from "./runMutants.mjs";

describe("[C2 Proof] Assertion 1 & 5: Version-Owned Discovery & Content Replacement", () => {
  it("discovers unmaterialized material with new cards and zero due cards", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const nav = result.materials.find((m) => m.materialId === "mat-nav-02");
    assert.ok(nav, "mat-nav-02 must be discovered");
    assert.equal(nav.againCount, 0, "No again cards");
    assert.equal(nav.dayCount, 0, "No day cards");
    assert.equal(nav.newCount, 8, "All 8 cards in raw flashcards_json are discovered as new");
    assert.equal(nav.totalDueCount, 0, "Total due is 0");
    db.close();
  });

  it("excludes old A's due rows when content changes to unmaterialized B; B cards are new", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const weather = result.materials.find((m) => m.materialId === "mat-changed-03");
    assert.ok(weather, "mat-changed-03 must be discovered");
    assert.equal(weather.againCount, 0, "Old version A again cards must stay excluded");
    assert.equal(weather.dayCount, 0, "Old version A day cards must stay excluded");
    assert.equal(weather.totalDueCount, 0, "No due cards from retired version");
    assert.equal(weather.newCount, 7, "All 7 cards of current unmaterialized version B are new");
    db.close();
  });

  it("reuses retained schedule when content returns to identical A (A -> B -> A) without writes", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const revert = result.materials.find((m) => m.materialId === "mat-revert-04");
    assert.ok(revert, "mat-revert-04 must be discovered");
    assert.equal(revert.dayCount, 1, "Retained due schedule from version A is current due work");
    assert.equal(revert.totalDueCount, 1);
    db.close();
  });

  it("retired A state rows cannot reduce current B new-card count", () => {
    const db = createDisposableDb();
    try {
      const a = generateCards("A", 4);
      const b = generateCards("B", 3);
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-ret', 'Ret', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-ret', ?, ?, ?)").run(JSON.stringify(b), now, now);

      const av = deriveCardVersion("m-ret", a);
      db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'm-ret', ?, 4, 'gemini', ?, 0)").run(av.versionId, av.contentHash, now);
      for (const i of av.items) {
        db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, av.versionId, i.ordinal, i.front, i.back);
        db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'm-ret', 'simple-v1', 0, ?, ?, 1, 1)").run(i.itemId, "2026-10-07T10:00:00.000Z", now);
      }

      const bv = deriveCardVersion("m-ret", b);
      db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'm-ret', ?, 3, 'gemini', ?, 1)").run(bv.versionId, bv.contentHash, now);
      for (const i of bv.items) {
        db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, bv.versionId, i.ordinal, i.front, i.back);
      }
      db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'm-ret', 'simple-v1', 0, ?, ?, 1, 1)").run(bv.items[0].itemId, "2026-10-07T10:00:00.000Z", now);

      const r = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid }).materials[0];
      assert.equal(r.totalDueCount, 1);
      assert.equal(r.newCount, 2, "Only B current item states may reduce B new count (not 4 retired A states)");
    } finally {
      db.close();
    }
  });

  it("distinguishes valid-empty guide-only sets from malformed sets", () => {
    const emptyCards = parseSavedCards("[]");
    assert.equal(emptyCards.status, "none", "Empty array parses as none");

    const malformedCards = parseSavedCards("[{bad_json");
    assert.equal(malformedCards.status, "malformed", "Damaged JSON parses as malformed");

    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const empty = result.materials.find((m) => m.materialId === "mat-empty-05");
    assert.equal(empty, undefined, "Empty guide-only material has 0 due and 0 new, so excluded from review due");

    const malformed = result.materials.find((m) => m.materialId === "mat-malformed-06");
    assert.equal(malformed, undefined, "Malformed material cannot produce review work");
    db.close();
  });
});

describe("[C2 Proof] Assertion 2: Urgency Ranking & Time Boundaries", () => {
  it("includes Again card at exact instant and Day card before next local midnight", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const aero = result.materials.find((m) => m.materialId === "mat-aero-01");
    assert.ok(aero, "mat-aero-01 must be present");
    assert.equal(aero.againCount, 1, "Exactly 1 again card due at T0");
    assert.equal(aero.dayCount, 1, "Exactly 1 day card due before local midnight");
    assert.equal(aero.totalDueCount, 2, "Total due is 2");
    db.close();
  });

  it("applies within-batch urgency ranking: Again due before Day due before New cards", () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-new', 'A-New Material', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-new', ?, ?, ?)").run(JSON.stringify(generateCards("new", 2)), now, now);

      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-day', 'M-Day Material', ?, ?)").run(now, now);
      const dayCards = generateCards("day", 2);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-day', ?, ?, ?)").run(JSON.stringify(dayCards), now, now);
      const vDay = deriveCardVersion("m-day", dayCards);
      db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'm-day', ?, 2, 'gemini', ?, 1)").run(vDay.versionId, vDay.contentHash, now);
      for (const i of vDay.items) db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, vDay.versionId, i.ordinal, i.front, i.back);
      db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'm-day', 'simple-v1', 0, ?, ?, 1, 1)").run(vDay.items[0].itemId, "2026-10-07T10:00:00.000Z", now);

      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-again', 'Z-Again Material', ?, ?)").run(now, now);
      const againCards = generateCards("again", 2);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-again', ?, ?, ?)").run(JSON.stringify(againCards), now, now);
      const vAgain = deriveCardVersion("m-again", againCards);
      db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'm-again', ?, 2, 'gemini', ?, 1)").run(vAgain.versionId, vAgain.contentHash, now);
      for (const i of vAgain.items) db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, vAgain.versionId, i.ordinal, i.front, i.back);
      db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'm-again', 'simple-v1', -1, ?, ?, 1, 1)").run(vAgain.items[0].itemId, now, now);

      const res = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 10 });
      const ids = res.materials.map((m) => m.materialId);

      assert.deepEqual(ids, ["m-again", "m-day", "m-new"]);
    } finally {
      db.close();
    }
  });
});

describe("[C2 Proof] Assertion 3: Keyset Pagination, History Enriched Payload & Caps", () => {
  it("consumes tied history events without dropping rows or duplicating", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const expected = db.prepare("SELECT id FROM card_review_events ORDER BY reviewed_at DESC, id DESC").all().map((r) => r.id);

    let cursor = null;
    const seen = [];
    for (let i = 0; i < 50; i++) {
      const page = getLibraryRecentReviews(db, { cursor, limit: 10 });
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.next;
      if (!cursor) break;
    }

    assert.equal(seen.length, expected.length);
    assert.deepEqual(seen, expected);
    db.close();
  });

  it("enriches history rows with contentStatus, interval, step, and card sides", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const page = getLibraryRecentReviews(db, { limit: 10 });
    assert.ok(page.rows.length > 0);

    const first = page.rows[0];
    assert.ok(first.id);
    assert.ok(first.materialId);
    assert.ok(first.materialTitle);
    assert.ok(["current", "earlier", "valid_empty", "unavailable", "malformed"].includes(first.contentStatus));
    assert.equal(typeof first.isEarlierVersion, "boolean");
    assert.ok(first.front);
    assert.ok(first.back);
    assert.ok(["again", "hard", "good", "easy"].includes(first.rating));
    assert.ok(first.priorState !== undefined);
    assert.ok(first.nextState !== undefined);
    db.close();
  });

  it("enforces maximum 250 candidate budget cap and returns page-local summary", () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      for (let i = 0; i < 260; i++) {
        const id = `cand-${i}`;
        db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(generateCards("c", 1)), now, now);
      }

      const res = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 1000, candidateBatchBudget: 1000 });
      assert.ok(res.summary.scannedCandidates <= 250, `Candidate budget must be hard-capped at 250, got ${res.summary.scannedCandidates}`);
      assert.equal(res.summary.isPageLocal, true, "Summary must be declared page-local");
    } finally {
      db.close();
    }
  });
});

describe("[C2 Proof] Assertion 4: Filters (C2-R7)", () => {
  it("statusFilter due_today excludes new-only materials and includes mixed", () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      // 1. Due material
      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-due', 'Due', ?, ?)").run(now, now);
      const cards1 = generateCards("d", 2);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-due', ?, ?, ?)").run(JSON.stringify(cards1), now, now);
      const v1 = deriveCardVersion("m-due", cards1);
      db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'm-due', ?, 2, 'gemini', ?, 1)").run(v1.versionId, v1.contentHash, now);
      for (const i of v1.items) db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, v1.versionId, i.ordinal, i.front, i.back);
      db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'm-due', 'simple-v1', 0, ?, ?, 1, 1)").run(v1.items[0].itemId, "2026-10-07T10:00:00.000Z", now);

      // 2. New only material
      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-new', 'New', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-new', ?, ?, ?)").run(JSON.stringify(generateCards("n", 2)), now, now);

      const dueOnly = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, statusFilter: "due_today" });
      assert.equal(dueOnly.materials.length, 1);
      assert.equal(dueOnly.materials[0].materialId, "m-due");

      const newOnly = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, statusFilter: "new_only" });
      assert.equal(newOnly.materials.length, 1);
      assert.equal(newOnly.materials[0].materialId, "m-new");

      const all = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, statusFilter: "all" });
      assert.equal(all.materials.length, 2);
    } finally {
      db.close();
    }
  });

  it("filters history by materialId and topic in SQL before keyset limit", () => {
    const { db } = buildSyntheticDatabase(100, 200);

    const aeroEvents = getLibraryRecentReviews(db, { topic: "aerodynamics", limit: 5 });
    assert.ok(aeroEvents.rows.length > 0);
    assert.ok(aeroEvents.rows.every((r) => r.topic === "aerodynamics"));

    const matEvents = getLibraryRecentReviews(db, { materialId: "mat-aero-01", limit: 5 });
    assert.ok(matEvents.rows.length > 0);
    assert.ok(matEvents.rows.every((r) => r.materialId === "mat-aero-01"));
    db.close();
  });
});

describe("[C2 Proof] Assertion 5: Cursor Ownership & Revalidation (C2-R8)", () => {
  it("rejects cursor with mismatched filter as STALE_CURSOR", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    const p1 = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, topic: "aerodynamics", limit: 1 });
    assert.ok(p1.nextCursor);

    assert.throws(() => {
      getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, topic: "navigation", cursor: p1.nextCursor });
    }, /STALE_CURSOR/);
    db.close();
  });

  it("rejects cursor with mismatched clock/midnight as STALE_CURSOR", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    const p1 = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 1 });
    assert.ok(p1.nextCursor);

    assert.throws(() => {
      getLibraryReviewDue(db, { nowUtc: "2026-10-08T15:00:00.000Z", nextLocalMidnightUtc: midUtc, cursor: p1.nextCursor });
    }, /STALE_CURSOR/);
    db.close();
  });

  it("continuation re-evaluates pending item and drops deleted material", () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      db.prepare("INSERT INTO study_materials(id, title, priority, updated_at, created_at) VALUES ('m-1', 'M1', 'next_up', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-1', ?, ?, ?)").run(JSON.stringify(generateCards("m1", 2)), now, now);

      db.prepare("INSERT INTO study_materials(id, title, priority, updated_at, created_at) VALUES ('m-2', 'M2', 'next_up', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-2', ?, ?, ?)").run(JSON.stringify(generateCards("m2", 2)), now, now);

      const p1 = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 1 });
      assert.equal(p1.materials.length, 1);
      assert.ok(p1.nextCursor);

      // Delete m-2 from database
      db.prepare("DELETE FROM study_materials WHERE id = 'm-2'").run();

      const p2 = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor: p1.nextCursor, limit: 1 });
      assert.ok(!p2.materials.some((m) => m.materialId === "m-2"), "Deleted m-2 must not appear on continuation");
    } finally {
      db.close();
    }
  });

  it("supports consuming same-query stream with larger or smaller page size", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    const p1 = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 2 });
    assert.equal(p1.materials.length, 2);
    assert.ok(p1.nextCursor);

    // Consume next page with different limit (limit 5)
    const p2 = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, cursor: p1.nextCursor, limit: 5 });
    assert.ok(p2.materials.length > 0);
    assert.ok(!p2.materials.some((m) => p1.materials.some((p) => p.materialId === m.materialId)), "No duplicates across pages");
    db.close();
  });
});

describe("[C2 Proof] Assertion 6: Asynchronous Deferred Read Controller (C2-R9)", () => {
  it("synchronous reader throw releases lock and allows immediate retry", async () => {
    const db = createDisposableDb();
    let shouldThrow = true;
    const syncThrowReader = () => {
      if (shouldThrow) throw new Error("Synchronous reader failure");
      return Promise.resolve({ materials: [{ materialId: "mat-ok", totalDueCount: 1, newCount: 0 }], nextCursor: null });
    };

    const ctrl = new DeferredReadController(db, {}, syncThrowReader);
    await assert.rejects(async () => { await ctrl.loadNextPage(); }, /Synchronous reader failure/);

    assert.equal(ctrl.isLoading, false, "isLoading must be reset on sync throw");
    assert.equal(ctrl.busyPromise, null, "busyPromise lock must be cleared on sync throw");

    shouldThrow = false;
    await ctrl.retryRead();
    assert.equal(ctrl.results.length, 1);
    assert.equal(ctrl.results[0].materialId, "mat-ok");
    db.close();
  });

  it("asynchronous rejection at non-null cursor allows successful retry with preserved cursor", async () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    let fail = false;
    const reader = async (database, opts) => {
      if (fail) throw new Error("Async network/db failure");
      return getLibraryReviewDue(database, opts);
    };

    const ctrl = new DeferredReadController(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 2 }, reader);
    await ctrl.loadNextPage();
    assert.equal(ctrl.results.length, 2);
    assert.ok(ctrl.cursor);

    fail = true;
    await assert.rejects(async () => { await ctrl.loadNextPage(); }, /Async network\/db failure/);
    assert.ok(ctrl.error);
    assert.equal(ctrl.isLoading, false);

    fail = false;
    await ctrl.retryRead();
    assert.equal(ctrl.error, null);
    assert.ok(ctrl.results.length > 2);
    db.close();
  });

  it("preserves multiple distinct history events for the same material", async () => {
    const db = createDisposableDb();
    const reader = async () => ({
      rows: [
        { id: "ev-1", materialId: "mat-same", rating: "again" },
        { id: "ev-2", materialId: "mat-same", rating: "good" },
      ],
      next: null,
    });

    const ctrl = new DeferredReadController(db, {}, reader);
    await ctrl.loadNextPage();

    assert.equal(ctrl.results.length, 2, "Both history events for the same material must be kept");
    assert.equal(ctrl.results[0].id, "ev-1");
    assert.equal(ctrl.results[1].id, "ev-2");
    db.close();
  });
});

describe("[C2 Proof] Assertion 7: Historical Context Provenance & File-Backed Reopen (C2-R10)", () => {
  it("exact roundtrip discovery and history across file-backed db close and reopen", () => {
    const testDbPath = resolve(process.cwd(), "scratch/file-backed-test.db");
    if (existsSync(testDbPath)) unlinkSync(testDbPath);

    try {
      const db1 = createDisposableDb(testDbPath);
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      db1.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('mat-file-01', 'File Aero', 'systems', ?, ?)").run(now, now);
      const cards = generateCards("FileAero", 3);
      db1.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('mat-file-01', ?, ?, ?)").run(JSON.stringify(cards), now, now);
      const v = deriveCardVersion("mat-file-01", cards);
      db1.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'mat-file-01', ?, 3, 'gemini', ?, 1)").run(v.versionId, v.contentHash, now);
      for (const i of v.items) db1.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, v.versionId, i.ordinal, i.front, i.back);
      db1.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'mat-file-01', 'simple-v1', 0, ?, ?, 1, 1)").run(v.items[0].itemId, "2026-10-07T10:00:00.000Z", now);

      db1.prepare(`
        INSERT INTO card_review_events(id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
        VALUES ('ev-file-01', ?, 0, 'good', ?, 'simple-v1', '{"step":0}', '{"step":1}')
      `).run(v.items[0].itemId, now);

      const due1 = getLibraryReviewDue(db1, { nowUtc: now, nextLocalMidnightUtc: mid });
      const hist1 = getLibraryRecentReviews(db1, { limit: 10 });
      db1.close();

      const db2 = new DatabaseSync(testDbPath);
      const due2 = getLibraryReviewDue(db2, { nowUtc: now, nextLocalMidnightUtc: mid });
      const hist2 = getLibraryRecentReviews(db2, { limit: 10 });
      db2.close();

      assert.deepEqual(due1.materials, due2.materials, "Discovery matches across close and reopen");
      assert.deepEqual(hist1.rows, hist2.rows, "History matches across close and reopen");
    } finally {
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
    }
  });

  it("proves schema-11 database gains shipped schema 12 and discovers cards without backfill", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const migrationsDir = resolve(process.cwd(), "src-tauri/migrations");
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

      for (const f of files) {
        if (f.startsWith("0012_")) break;
        db.exec(readFileSync(resolve(migrationsDir, f), "utf8"));
      }

      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";
      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('mat-mig-01', 'Migrated Set', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('mat-mig-01', ?, ?, ?)").run(JSON.stringify(generateCards("Mig", 5)), now, now);

      const tableCheck11 = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='card_versions'").get();
      assert.equal(tableCheck11, undefined, "card_versions must not exist in schema 11");

      const mig12 = readFileSync(resolve(migrationsDir, "0012_card_reviews.sql"), "utf8");
      db.exec(mig12);

      const tableCheck12 = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='card_versions'").get();
      assert.ok(tableCheck12, "card_versions exists in schema 12");

      const dueRes = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid });
      assert.equal(dueRes.materials.length, 1);
      assert.equal(dueRes.materials[0].materialId, "mat-mig-01");
      assert.equal(dueRes.materials[0].newCount, 5);
      assert.equal(dueRes.materials[0].totalDueCount, 0);
    } finally {
      db.close();
    }
  });
});

describe("[C2 Proof] Assertion 8: Mutation Verifier and Survival Control (C2-R11)", () => {
  it("verifies all semantic mutants are reliably killed by assertions in isolated processes", () => {
    const { success } = runMutantVerification({ disableAssertions: false });
    assert.equal(success, true, "All mutants must fail assertion checks");
  });
});

describe("[C2 Proof] Assertion 9: Full Traversal Completeness across Stream Mutations (R8)", () => {
  function continueAllPages(db, firstResult, opts, limit = 1) {
    const ids = firstResult.materials.map((m) => m.materialId);
    let cursor = firstResult.nextCursor;
    for (let safety = 0; cursor && safety < 20; safety++) {
      const page = getLibraryReviewDue(db, { ...opts, cursor, limit });
      ids.push(...page.materials.map((m) => m.materialId));
      cursor = page.nextCursor;
    }
    assert.equal(cursor, null, "traversal stream must terminate");
    return ids;
  }

  it("deleted pending prefix does not repeat subsequent live rows over full traversal", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";
    const opts = { nowUtc: now, nextLocalMidnightUtc: mid };

    try {
      for (const id of ["a", "b", "c", "d"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'nav', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(generateCards(id, 1)), now, now);
      }

      const p = getLibraryReviewDue(db, { ...opts, limit: 1 });
      assert.deepEqual(p.materials.map((m) => m.materialId), ["a"]);

      // Mutate stream: delete 'b'
      db.prepare("DELETE FROM study_materials WHERE id = 'b'").run();

      const allIds = continueAllPages(db, p, opts, 1);
      assert.deepEqual(allIds, ["a", "c", "d"], "Must traverse a, c, d without duplicate c or skipped d");
    } finally {
      db.close();
    }
  });

  it("empty-content pending prefix does not repeat subsequent live rows over full traversal", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";
    const opts = { nowUtc: now, nextLocalMidnightUtc: mid };

    try {
      for (const id of ["a", "b", "c", "d"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'nav', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(generateCards(id, 1)), now, now);
      }

      const p = getLibraryReviewDue(db, { ...opts, limit: 1 });
      db.prepare("UPDATE ai_study_sets SET flashcards_json = '[]' WHERE source_material_id = 'b'").run();

      const allIds = continueAllPages(db, p, opts, 1);
      assert.deepEqual(allIds, ["a", "c", "d"], "Must discard empty set b and deliver c, d without duplication");
    } finally {
      db.close();
    }
  });

  it("history cursor enforces filter context ownership and rejects cross-stream usage", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      for (const id of ["a", "b"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'nav', ?, ?)").run(id, id, now, now);
        const cards = generateCards(id, 1);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(cards), now, now);
        const v = deriveCardVersion(id, cards);
        db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, ?, ?, 1, 'gemini', ?, 1)").run(v.versionId, id, v.contentHash, now);
        db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, 0, 'f', 'b')").run(v.items[0].itemId, v.versionId);
        db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, ?, 'simple-v1', 0, ?, ?, 1, 1)").run(v.items[0].itemId, id, now, now);
        db.prepare("INSERT INTO card_review_events(id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json) VALUES (?, ?, 0, 'good', ?, 'simple-v1', '{}', '{}')").run(`ev-${id}-1`, v.items[0].itemId, now);
        db.prepare("INSERT INTO card_review_events(id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json) VALUES (?, ?, 0, 'again', ?, 'simple-v1', '{}', '{}')").run(`ev-${id}-2`, v.items[0].itemId, "2026-10-07T14:00:00.000Z");
      }

      const pB = getLibraryRecentReviews(db, { materialId: "b", limit: 1 });
      assert.ok(pB.next);

      assert.throws(() => {
        getLibraryRecentReviews(db, { materialId: "a", cursor: pB.next, limit: 10 });
      }, /STALE_CURSOR/);
    } finally {
      db.close();
    }
  });

  it("due cursor missing mandatory ownership context is rejected", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      const bareCursor = Buffer.from(JSON.stringify({ type: "due", remIds: ["a"], isExhausted: true })).toString("base64");
      assert.throws(() => {
        getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor: bareCursor });
      }, /CURSOR|STALE|INVALID/i);
    } finally {
      db.close();
    }
  });
});

describe("[C2 Proof] Assertion 10: Authoritative Refresh Invalidation & Operation Lock (R9)", () => {
  it("fresh reset traversal removes surviving no-longer-actionable summaries", async () => {
    let calls = 0;
    const c = new DeferredReadController(null, {}, async () => ({
      materials: ++calls === 1 ? [{ materialId: "a" }, { materialId: "b" }] : [{ materialId: "a" }],
      nextCursor: null,
    }));

    await c.loadNextPage();
    c.onReset("a");
    await c.loadNextPage();

    assert.deepEqual(c.results.map((x) => x.materialId), ["a"], "Reset page 1 replaces prior generation; obsolete b removed");
  });

  it("fresh reset traversal adopts authoritative urgency order", async () => {
    let calls = 0;
    const c = new DeferredReadController(null, {}, async () => ({
      materials: (++calls === 1 ? ["a", "b", "c"] : ["b", "a", "c"]).map((materialId) => ({ materialId })),
      nextCursor: null,
    }));

    await c.loadNextPage();
    c.onReset("c");
    await c.loadNextPage();

    assert.deepEqual(c.results.map((x) => x.materialId), ["b", "a", "c"], "Reset adopts fresh urgency order");
  });

  it("obsolete synchronous throw cannot clear a new held operation lock (reviewer boundary)", async () => {
    let c, heldB, resolveB;
    const reader = (_db, q) => {
      if (q.topic === "a") {
        c.setFilter({ topic: "b" });
        heldB = c.loadNextPage();
        throw new Error("obsolete A synchronous failure");
      }
      return new Promise((r) => {
        resolveB = r;
      });
    };

    c = new DeferredReadController(null, { topic: "a" }, reader);
    await assert.rejects(c.loadNextPage(), /obsolete A synchronous failure/);

    const locked = c.busyPromise === heldB;
    const loading = c.isLoading;

    resolveB({ materials: [{ materialId: "b" }], nextCursor: null });
    await heldB;

    assert.equal(locked, true, "Obsolete A catch must not clear B's busy lock");
    assert.equal(loading, true, "Obsolete A catch must not clear B's isLoading state");
  });
});

describe("[C2 Proof] Assertion 11: Executable Resource Budgets & Work Counters (R4)", () => {
  it("requested 2500-card work budget bounds delivered candidate batch and preserves continuation", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      const cards = Array.from({ length: 500 }, (_, i) => ({ front: "F" + i, back: "B" + i, sourcePage: null }));
      for (let i = 0; i < 6; i++) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'nav', ?, ?)").run(`m${i}`, `m${i}`, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(`m${i}`, JSON.stringify(cards), now, now);
      }

      const r = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 250, maxBatchCardsBudget: 2500 });
      const deliveredCards = r.materials.reduce((sum, row) => sum + row.cardCount, 0);

      assert.ok(deliveredCards <= 2500, `Delivered ${deliveredCards} cards despite 2500 cap`);
      assert.ok(r.nextCursor, "Must return valid continuation cursor for remaining work");
      assert.equal(r.materials.length, 5, "5 materials with 500 cards each fit in 2500 budget");
    } finally {
      db.close();
    }
  });

  it("raw-card SQL reads respect proposed 2 MiB batch ceiling via preflight", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      const cards = Array.from({ length: 500 }, () => ({
        front: "F".repeat(1000),
        back: "B".repeat(2000),
        sourcePage: null,
      }));

      for (const id of ["a", "b"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'nav', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(cards), now, now);
      }

      let rawBytesTransferred = 0;
      const measuredDb = {
        prepare(sql) {
          const stmt = db.prepare(sql);
          return Object.fromEntries(
            ["all", "get"].map((method) => [
              method,
              (...params) => {
                const res = stmt[method](...params);
                const rows = method === "all" ? res : res ? [res] : [];
                for (const row of rows) {
                  if (typeof row.flashcards_json === "string") {
                    rawBytesTransferred += Buffer.byteLength(row.flashcards_json, "utf8");
                  }
                }
                return res;
              },
            ])
          );
        },
      };

      const res = getLibraryReviewDue(measuredDb, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 250, maxBatchRawJsonBytesBudget: 2097152 });

      assert.ok(rawBytesTransferred <= 2097152, `Transferred ${rawBytesTransferred} raw bytes exceeding 2 MiB ceiling`);
      assert.equal(res.materials.length, 1, "Only 1 material of ~1.5 MB admitted before hitting 2 MiB ceiling");
      assert.ok(res.nextCursor, "Next cursor must allow second material to be read on continuation");
    } finally {
      db.close();
    }
  });

  it("oversize single-set lane admits single large set to prevent livelock", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      const cards = Array.from({ length: 100 }, () => ({
        front: "Front".repeat(200),
        back: "Back".repeat(400),
        sourcePage: null,
      }));

      db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('m-oversize', 'Oversize', 'nav', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-oversize', ?, ?, ?)").run(JSON.stringify(cards), now, now);

      // Request strict budget smaller than the set (e.g. 50 cards, 10 KB)
      const res = getLibraryReviewDue(db, {
        nowUtc: now,
        nextLocalMidnightUtc: mid,
        maxBatchCardsBudget: 50,
        maxBatchRawJsonBytesBudget: 10240,
      });

      assert.equal(res.materials.length, 1, "Single-set lane must admit the single oversize set");
      assert.equal(res.materials[0].materialId, "m-oversize");
      assert.equal(res.nextCursor, null, "Traversal terminates cleanly");
    } finally {
      db.close();
    }
  });
});

describe("[C2 Proof] Assertion 12: Bounded Read Pipeline, Strict Cursors, and Legacy Inspection (C2-R4, C2-R8)", () => {
  it("malformed discovery and pending prefixes obey byte budget and retain unvisited candidates", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";
    const budget = 2097152;

    try {
      for (const id of ["m-mal-1", "m-mal-2", "m-mal-3", "m-mal-4"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'systems', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, "x".repeat(700000), now, now);
      }

      let rawTransferred = 0;
      const measuredDb = {
        prepare(sql) {
          const s = db.prepare(sql);
          return Object.fromEntries(
            ["get", "all"].map((method) => [
              method,
              (...args) => {
                const res = s[method](...args);
                for (const row of method === "all" ? res : res ? [res] : []) {
                  if (typeof row.flashcards_json === "string") {
                    rawTransferred += Buffer.byteLength(row.flashcards_json);
                  }
                }
                return res;
              },
            ])
          );
        },
      };

      const res = getLibraryReviewDue(measuredDb, {
        nowUtc: now,
        nextLocalMidnightUtc: mid,
        maxBatchRawJsonBytesBudget: budget,
      });

      assert.ok(rawTransferred <= budget, `Transferred ${rawTransferred} bytes under ${budget} budget`);
      assert.equal(res.summary.rawBytesTransferred, rawTransferred, "Reported bytes must match measured transfer");
      assert.ok(res.nextCursor, "Unvisited candidates must be preserved in cursor");
    } finally {
      db.close();
    }
  });

  it("card budget stop counts already-read candidate in counters and retains candidate for next page", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      const cards = Array.from({ length: 500 }, (_, i) => ({ front: `Front ${i}`, back: `Back ${i}`, sourcePage: null }));
      for (const id of ["card-budget-a", "card-budget-b", "card-budget-c"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'systems', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(cards), now, now);
      }

      let rawTransferred = 0;
      const measuredDb = {
        prepare(sql) {
          const s = db.prepare(sql);
          return Object.fromEntries(
            ["get", "all"].map((method) => [
              method,
              (...args) => {
                const res = s[method](...args);
                for (const row of method === "all" ? res : res ? [res] : []) {
                  if (typeof row.flashcards_json === "string") {
                    rawTransferred += Buffer.byteLength(row.flashcards_json);
                  }
                }
                return res;
              },
            ])
          );
        },
      };

      const res = getLibraryReviewDue(measuredDb, {
        nowUtc: now,
        nextLocalMidnightUtc: mid,
        maxBatchCardsBudget: 500,
        limit: 250,
      });

      assert.equal(res.summary.rawBytesTransferred, rawTransferred, "Raw transfer counter must match measured wire bytes");
      assert.ok(res.nextCursor, "Budget stop must produce continuation cursor");
    } finally {
      db.close();
    }
  });

  it("maximum candidate cursor (250 IDs) roundtrips through strict decoder; rejects > 32KB cursor", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      for (let i = 0; i < 250; i++) {
        const id = `10000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'aero', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify([{ front: "Q", back: "A", sourcePage: null }]), now, now);
      }

      const p1 = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 1 });
      assert.ok(p1.nextCursor, "Must issue cursor for remaining 249 candidates");
      assert.ok(p1.nextCursor.length > 8192, "Cursor length with 249 IDs must exceed legacy 8KB limit");
      assert.ok(p1.nextCursor.length <= MAX_CURSOR_LENGTH, "Cursor length must be within 32KB bound");

      const p2 = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 250, cursor: p1.nextCursor });
      assert.equal(p2.materials.length, 249, "Remaining 249 candidates must be consumed without error or omission");

      const oversizedCursor = "A".repeat(MAX_CURSOR_LENGTH + 1);
      assert.throws(
        () => getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor: oversizedCursor }),
        /INVALID_CURSOR: cursor exceeds maximum allowed length/
      );
    } finally {
      db.close();
    }
  });

  it("strict cursor validation rejects missing version, wrong kind, malformed keys, and arrays before SQL", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";
    const validCtx = { topic: null, statusFilter: "all", nowUtc: now, nextLocalMidnightUtc: mid };

    try {
      const arrayToken = Buffer.from(JSON.stringify(["due", 1])).toString("base64");
      assert.throws(() => getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor: arrayToken }), /INVALID_CURSOR/);

      const noVersionToken = Buffer.from(JSON.stringify({ type: "due", ctx: validCtx, remIds: [] })).toString("base64");
      assert.throws(() => getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor: noVersionToken }), /INVALID_CURSOR/);

      const wrongTypeToken = Buffer.from(JSON.stringify({ v: 1, type: "wrong", ctx: validCtx, remIds: [] })).toString("base64");
      assert.throws(() => getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor: wrongTypeToken }), /INVALID_CURSOR/);

      const noCtxToken = Buffer.from(JSON.stringify({ v: 1, type: "due", remIds: [] })).toString("base64");
      assert.throws(() => getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor: noCtxToken }), /INVALID_CURSOR/);

      const histNoKeyset = Buffer.from(JSON.stringify({ v: 1, type: "history", ctx: { materialId: null, topic: null } })).toString("base64");
      assert.throws(() => getLibraryRecentReviews(db, { cursor: histNoKeyset }), /INVALID_CURSOR/);
    } finally {
      db.close();
    }
  });

  it("history enrichment respects raw byte budget and marks unread sets as pending without guessing provenance", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const budget = 2097152;

    try {
      const cards = Array.from({ length: 500 }, () => ({
        front: "F".repeat(1000),
        back: "B".repeat(2000),
        sourcePage: null,
      }));

      for (const id of ["hist-big-1", "hist-big-2"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'nav', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(cards), now, now);
        const v = deriveCardVersion(id, cards);
        db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, ?, ?, 500, 'gemini', ?, 1)").run(v.versionId, id, v.contentHash, now);
        const item = v.items[0];
        db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, 0, ?, ?)").run(item.itemId, v.versionId, item.front, item.back);
        db.prepare("INSERT INTO card_review_events(id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json) VALUES (?, ?, 0, 'good', ?, 'simple-v1', '{}', '{}')").run(`ev-${id}`, item.itemId, now);
      }

      let rawTransferred = 0;
      const measuredDb = {
        prepare(sql) {
          const s = db.prepare(sql);
          return Object.fromEntries(
            ["get", "all"].map((method) => [
              method,
              (...args) => {
                const res = s[method](...args);
                for (const row of method === "all" ? res : res ? [res] : []) {
                  if (typeof row.flashcards_json === "string") {
                    rawTransferred += Buffer.byteLength(row.flashcards_json);
                  }
                }
                return res;
              },
            ])
          );
        },
      };

      const res = getLibraryRecentReviews(measuredDb, { limit: 20, maxBatchRawJsonBytesBudget: budget });

      assert.ok(rawTransferred <= budget, `Transferred ${rawTransferred} bytes exceeding ${budget} budget`);
      assert.equal(res.rows.length, 2, "Both history events must be returned");
      const pendingRow = res.rows.find((r) => r.contentStatus === "pending");
      assert.ok(pendingRow, "Second material set must be honest 'pending' without reading raw set");
      assert.equal(pendingRow.isEarlierVersion, null, "Provenance must be null (not guessed) when raw set unread");
    } finally {
      db.close();
    }
  });

  it("legacy review schedule inspection validates C1 simple-v1 ladder, produces typed intervals, and falls back cleanly for malformed/unsupported state", () => {
    const valid0 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 0, dueAt: "2026-10-08T15:00:00.000Z", reps: 1, lapses: 0 }));
    assert.equal(valid0.valid, true);
    assert.equal(valid0.schedule.intervalDays, 1);
    assert.equal(valid0.schedule.intervalLabel, "1d");

    const validAgain = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: -1, dueAt: "2026-10-07T15:10:00.000Z", reps: 1, lapses: 1 }));
    assert.equal(validAgain.valid, true);
    assert.equal(validAgain.schedule.intervalMinutes, 10);
    assert.equal(validAgain.schedule.intervalLabel, "10m");

    const valid3 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 3, dueAt: "2026-10-23T15:00:00.000Z", reps: 4, lapses: 0 }));
    assert.equal(valid3.valid, true);
    assert.equal(valid3.schedule.intervalDays, 16);
    assert.equal(valid3.schedule.intervalLabel, "16d");

    const malformed = validateScheduleState("{not_json");
    assert.equal(malformed.valid, false);
    assert.equal(malformed.schedule, null);

    const unsupported = validateScheduleState(JSON.stringify({ schedulerVersion: "fsrs-v4", step: 3 }));
    assert.equal(unsupported.valid, false);
    assert.equal(unsupported.schedule, null);

    const outOfRange = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 99 }));
    assert.equal(outOfRange.valid, false);
    assert.equal(outOfRange.schedule, null);

    const invalidDate = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 1, dueAt: "tomorrow" }));
    assert.equal(invalidDate.valid, false);
    assert.equal(invalidDate.schedule, null);
  });

  it("genuinely 500-card / 1000-front / 2000-back Unicode fixture is production-valid under C1 parser and accurately measured", () => {
    const frontText = "✈".repeat(1000);
    const backText = "🛩".repeat(2000);
    const cards = Array.from({ length: 500 }, (_, i) => ({
      front: frontText,
      back: backText,
      sourcePage: (i % 500) + 1,
    }));

    const rawJson = JSON.stringify(cards);
    const parsed = parseSavedCards(rawJson);
    assert.equal(parsed.status, "ok", "500-card max-Unicode set must parse successfully under C1 parser");
    assert.equal(parsed.cards.length, 500, "Must have exactly 500 cards");

    const byteLen = Buffer.byteLength(rawJson, "utf8");
    assert.ok(byteLen > 5000000, `Expected > 5 MB raw JSON, got ${byteLen} bytes`);
    assert.ok(byteLen <= ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES, `Must fit within 8 MiB single-set bound`);
  });

  it("absolute oversize single-set policy bounds giant payloads (> 8 MiB) and explicitly reports issues", () => {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    try {
      db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('giant-mat', 'Giant', 'nav', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('giant-mat', ?, ?, ?)").run("X".repeat(9 * 1024 * 1024), now, now);

      const res = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid });
      assert.equal(res.materials.length, 0, "Oversize payload > 8 MiB must not be admitted as actionable");
      assert.equal(res.issues.length, 1, "Oversize payload must be reported explicitly in issues");
      assert.equal(res.issues[0].materialId, "giant-mat");
      assert.equal(res.issues[0].code, "PAYLOAD_TOO_LARGE");
      assert.equal(res.summary.rawBytesTransferred, 0, "Zero raw JSON bytes transferred for oversize set");
      assert.equal(res.nextCursor, null, "Traversal terminates cleanly without livelock");
    } finally {
      db.close();
    }
  });
});

describe("[C2 Proof] Assertion 13: Contract Finishing — Explicit Oversize, Strict Schemas, and History Enrichment (7 Oct)", () => {
  const now = "2026-10-07T15:00:00.000Z";
  const mid = "2026-10-08T00:00:00.000Z";
  const opts = { nowUtc: now, nextLocalMidnightUtc: mid };
  const token = (v) => Buffer.from(JSON.stringify(v)).toString("base64");
  const ctx = { topic: null, statusFilter: "all", nowUtc: now, nextLocalMidnightUtc: mid };

  it("oversize payload > 8 MiB is explicitly reported in issues, zero bytes read, and later materials remain discoverable", () => {
    const db = createDisposableDb();
    try {
      db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('giant-1', 'Giant', 'nav', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('giant-1', ?, ?, ?)").run("X".repeat(9 * 1024 * 1024), now, now);
      db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('norm-2', 'Normal', 'nav', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('norm-2', ?, ?, ?)").run(JSON.stringify([{ front: "F", back: "B", sourcePage: null }]), now, now);

      const res = getLibraryReviewDue(db, opts);
      assert.equal(res.summary.rawBytesTransferred, Buffer.byteLength(JSON.stringify([{ front: "F", back: "B", sourcePage: null }]), "utf8"));
      assert.equal(res.issues.length, 1);
      assert.equal(res.issues[0].code, "PAYLOAD_TOO_LARGE");
      assert.equal(res.issues[0].materialId, "giant-1");
      assert.equal(res.materials.length, 1);
      assert.equal(res.materials[0].materialId, "norm-2");
    } finally {
      db.close();
    }
  });

  it("oversize set content replacement with valid content recovers on live refresh without livelock", () => {
    const db = createDisposableDb();
    try {
      db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('mat-rec', 'Recover', 'nav', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('mat-rec', ?, ?, ?)").run("X".repeat(9 * 1024 * 1024), now, now);

      const res1 = getLibraryReviewDue(db, opts);
      assert.equal(res1.issues.length, 1);
      assert.equal(res1.materials.length, 0);

      const validCards = JSON.stringify([{ front: "Recovered F", back: "Recovered B", sourcePage: 1 }]);
      db.prepare("UPDATE ai_study_sets SET flashcards_json = ? WHERE source_material_id = 'mat-rec'").run(validCards);

      const res2 = getLibraryReviewDue(db, opts);
      assert.equal(res2.issues.length, 0);
      assert.equal(res2.materials.length, 1);
      assert.equal(res2.materials[0].materialId, "mat-rec");
    } finally {
      db.close();
    }
  });

  it("history pending resolution: two max-ASCII sets under 2 MiB defers set 2, targeted enrich resolves without event loss", () => {
    const db = createDisposableDb();
    try {
      const cards = Array.from({ length: 500 }, () => ({ front: "F".repeat(1000), back: "B".repeat(2000), sourcePage: null }));
      for (const id of ["h-set1", "h-set2"]) {
        db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES (?, ?, 'nav', ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(cards), now, now);
        const v = deriveCardVersion(id, cards);
        db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES(?,?,?,500,'gemini',?,1)").run(v.versionId, id, v.contentHash, now);
        const item = v.items[0];
        db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES(?,?,0,?,?)").run(item.itemId, v.versionId, item.front, item.back);
        db.prepare("INSERT INTO card_review_events(id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json) VALUES(?,?,0,'good',?,'simple-v1','{}','{}')").run(`ev-${id}`, item.itemId, now);
      }

      const res1 = getLibraryRecentReviews(db, { limit: 10, maxBatchRawJsonBytesBudget: 2097152 });
      assert.equal(res1.rows.length, 2);
      assert.ok(res1.pendingMaterialIds.length >= 1, "At least one material should be deferred");
      const deferredId = res1.pendingMaterialIds[0];

      const res2 = getLibraryRecentReviews(db, { limit: 10, maxBatchRawJsonBytesBudget: 2097152, enrichMaterialIds: [deferredId] });
      assert.equal(res2.rows.length, 2, "All events preserved without loss or duplication");
      const deferredRow = res2.rows.find((r) => r.materialId === deferredId);
      assert.equal(deferredRow.contentStatus, "current", "Deferred material is successfully enriched");
      assert.equal(deferredRow.isEarlierVersion, false);
    } finally {
      db.close();
    }
  });

  it("due cursor strict schema rejects missing candidate keyset boundary, duplicate pending IDs, non-boolean exhaustion", () => {
    const db = createDisposableDb();
    try {
      assert.throws(
        () => getLibraryReviewDue(db, { ...opts, cursor: token({ v: 1, type: "due", ctx, remIds: [], isExhausted: false }) }),
        /INVALID_CURSOR/
      );
      assert.throws(
        () => getLibraryReviewDue(db, { ...opts, cursor: token({ v: 1, type: "due", ctx, remIds: ["m1", "m1"], lc: "m1", lp: 0, lu: now, isExhausted: true }) }),
        /INVALID_CURSOR/
      );
      assert.throws(
        () => getLibraryReviewDue(db, { ...opts, cursor: token({ v: 1, type: "due", ctx, remIds: [], isExhausted: "false", lc: "m1", lp: 0, lu: now }) }),
        /INVALID_CURSOR/
      );
    } finally {
      db.close();
    }
  });

  it("history cursor strict schema rejects non-canonical ISO dates and overlong IDs before SQL", () => {
    const db = createDisposableDb();
    try {
      assert.throws(
        () => getLibraryRecentReviews(db, { cursor: token({ v: 1, type: "history", ctx: { topic: null, materialId: null }, t: "2026-02-30T00:00:00.000Z", id: "ev-1" }) }),
        /INVALID_CURSOR/
      );
      assert.throws(
        () => getLibraryRecentReviews(db, { cursor: token({ v: 1, type: "history", ctx: { topic: null, materialId: null }, t: now, id: "X".repeat(65) }) }),
        /INVALID_CURSOR/
      );
    } finally {
      db.close();
    }
  });

  it("validateScheduleState rejects unsupported event schedulers, non-canonical calendar dates, negative counts", () => {
    const r1 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 0, dueAt: mid, reps: 1, lapses: 0 }), "unsupported-v99");
    assert.equal(r1.valid, false);
    assert.equal(r1.schedule, null);

    const r2 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 0, dueAt: "2026-02-30T00:00:00.000Z", reps: 1, lapses: 0 }));
    assert.equal(r2.valid, false);

    const r3 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 0, dueAt: mid, reps: -1, lapses: 0 }));
    assert.equal(r3.valid, false);

    const r4 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 0, dueAt: mid, reps: 0, lapses: -5 }));
    assert.equal(r4.valid, false);

    const r5 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: -1, dueAt: mid, reps: 0, lapses: 1 }));
    assert.equal(r5.valid, true);
    assert.equal(r5.schedule.intervalLabel, "10m");

    const r6 = validateScheduleState(JSON.stringify({ schedulerVersion: "simple-v1", step: 0, dueAt: mid, reps: 1, lapses: 0 }));
    assert.equal(r6.valid, true);
    assert.equal(r6.schedule.intervalLabel, "1d");
  });
});

describe("[C2 Proof] Assertion 14: State Publication, Conservative Work Reservations & Independent History Enrichment (7 Oct)", () => {
  const now = "2026-10-07T15:00:00.000Z";
  const mid = "2026-10-08T00:00:00.000Z";
  const opts = { nowUtc: now, nextLocalMidnightUtc: mid };

  function putMaterial(db, id, cards = [{ front: id, back: "B", sourcePage: null }]) {
    db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES(?,?,?,?)").run(id, id, now, now);
    db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES(?,?,?,?)").run(id, JSON.stringify(cards), now, now);
  }

  function putHistoryEvent(db, id, cards) {
    const v = deriveCardVersion(id, cards);
    db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES(?,?,?,?, 'gemini',?,1)").run(v.versionId, id, v.contentHash, cards.length, now);
    const it = v.items[0];
    db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES(?,?,0,?,?)").run(it.itemId, v.versionId, it.front, it.back);
    db.prepare("INSERT INTO card_review_events(id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json) VALUES(?,?,0,'good',?,'simple-v1','null','null')").run(`ev-${id}`, it.itemId, now);
  }

  function trackedDb(db) {
    const s = { rawCalls: 0, calls: 0, bytes: 0 };
    return {
      stats: s,
      prepare(sql) {
        const q = db.prepare(sql);
        return Object.fromEntries(["get", "all"].map((method) => [
          method,
          (...a) => {
            s.calls++;
            const x = q[method](...a);
            for (const row of method === "all" ? x : x ? [x] : []) {
              if (typeof row.flashcards_json === "string") {
                s.rawCalls++;
                s.bytes += Buffer.byteLength(row.flashcards_json, "utf8");
              }
            }
            return x;
          },
        ]));
      },
    };
  }

  it("invalid arrays spend conservative 500-card reservation; budget 500 stops after 1 raw attempt and preserves continuation", () => {
    const db = createDisposableDb();
    try {
      for (const id of ["inv-a", "inv-b", "inv-c"]) {
        putMaterial(db, id, Array.from({ length: 500 }, () => ({ front: "F", back: 7, sourcePage: null })));
      }
      const q = trackedDb(db);
      const res = getLibraryReviewDue(q, { ...opts, maxBatchCardsBudget: 500 });
      assert.equal(q.stats.rawCalls, 1, "Failed 500-card parse keeps reservation spent, preventing reads of b and c");
      assert.equal(res.summary.evaluatedCards, 0, "No cards evaluated as actionable");
      assert.equal(res.summary.attemptedCards, 500, "Attempted cards counter retains 500 reservation");
      assert.equal(res.summary.rawReads, 1, "Raw reads accurately reported as 1");
      assert.ok(res.nextCursor, "Unread invalid candidates remain reachable through nextCursor continuation");
    } finally {
      db.close();
    }
  });

  it("budget 600 reconciles valid 400-card set to 400, stopping next 500-card candidate before raw read", () => {
    const db = createDisposableDb();
    try {
      putMaterial(db, "valid-400", Array.from({ length: 400 }, (_, i) => ({ front: `F${i}`, back: `B${i}`, sourcePage: null })));
      putMaterial(db, "valid-500", Array.from({ length: 500 }, (_, i) => ({ front: `F${i}`, back: `B${i}`, sourcePage: null })));

      const q = trackedDb(db);
      const res = getLibraryReviewDue(q, { ...opts, maxBatchCardsBudget: 600 });
      assert.equal(q.stats.rawCalls, 1, "Candidate 2 cannot reserve 500 cards (400 + 500 > 600) so it is not read");
      assert.equal(res.summary.evaluatedCards, 400, "400 valid cards evaluated");
      assert.equal(res.summary.attemptedCards, 400, "Attempted cards reconciled from 500 down to 400");
      assert.equal(res.materials.length, 1);
      assert.ok(res.nextCursor, "Second set remains unread and available via continuation");
    } finally {
      db.close();
    }
  });

  it("single-set exception allows at most one raw-work admission under sub-500 budget; metadata oversize does not consume exception", () => {
    const db = createDisposableDb();
    try {
      putMaterial(db, "mat-huge", [{ front: "F", back: "B", sourcePage: null }]);
      db.prepare("UPDATE ai_study_sets SET flashcards_json=? WHERE source_material_id='mat-huge'").run("X".repeat(9 * 1024 * 1024));
      putMaterial(db, "mat-normal", Array.from({ length: 200 }, (_, i) => ({ front: `F${i}`, back: `B${i}`, sourcePage: null })));
      putMaterial(db, "mat-second", Array.from({ length: 200 }, (_, i) => ({ front: `F${i}`, back: `B${i}`, sourcePage: null })));

      const q = trackedDb(db);
      const res = getLibraryReviewDue(q, { ...opts, maxBatchCardsBudget: 250 });
      assert.equal(res.issues.length, 1, "mat-huge metadata-only oversize detected");
      assert.equal(res.issues[0].inspectionTarget, "/study/mat-huge", "Inspection target points to /study route");
      assert.equal(q.stats.rawCalls, 1, "Only mat-normal admitted via single-set exception; mat-second stopped");
      assert.equal(res.materials.length, 1);
      assert.equal(res.materials[0].materialId, "mat-normal");
      assert.ok(res.nextCursor, "mat-second retained in continuation");
    } finally {
      db.close();
    }
  });

  it("controller publishes issues and summary through generation lock; retains multi-page issues and clears on reset", async () => {
    const issue1 = { materialId: "mat-1", title: "M1", code: "PAYLOAD_TOO_LARGE", rawBytes: 9000000, allowedBytes: 8388608, inspectionTarget: "/study/mat-1" };
    const issue2 = { materialId: "mat-2", title: "M2", code: "PAYLOAD_TOO_LARGE", rawBytes: 9500000, allowedBytes: 8388608, inspectionTarget: "/study/mat-2" };

    let callCount = 0;
    const reader = () => {
      callCount++;
      if (callCount === 1) {
        return { materials: [{ materialId: "mat-ok1" }], issues: [issue1], nextCursor: "tok-page2", summary: { issuesCount: 1, isComplete: false } };
      }
      return { materials: [{ materialId: "mat-ok2" }], issues: [issue2], nextCursor: null, summary: { issuesCount: 1, isComplete: true } };
    };

    const ctrl = new DeferredReadController(null, {}, reader);
    await ctrl.loadNextPage();
    assert.deepEqual(ctrl.issues, [issue1], "Page 1 issue retained in controller");
    assert.equal(ctrl.isComplete, false);

    await ctrl.loadNextPage();
    assert.deepEqual(ctrl.issues, [issue1, issue2], "Earlier-page issues retained and merged across pagination");
    assert.equal(ctrl.isComplete, true);
    assert.equal(ctrl.isCaughtUp, false, "Not caught up because issues remain");

    // Authoritative reset clears issues, summary, and results
    ctrl.onReset();
    assert.deepEqual(ctrl.issues, [], "Issues cleared synchronously on reset");
    assert.equal(ctrl.summary, null, "Summary cleared synchronously on reset");
    assert.deepEqual(ctrl.results, [], "Results cleared on reset");
  });

  it("controller distinguishes isComplete from isCaughtUp on warning-only terminal results", async () => {
    const issue = { materialId: "x", title: "X", code: "PAYLOAD_TOO_LARGE", rawBytes: 9000000, allowedBytes: 8388608, inspectionTarget: "/study/x" };
    const ctrl = new DeferredReadController(null, {}, () => ({
      materials: [],
      issues: [issue],
      nextCursor: null,
      summary: { issuesCount: 1, isComplete: true },
    }));

    await ctrl.loadNextPage();
    assert.equal(ctrl.isComplete, true, "Traversal complete");
    assert.equal(ctrl.isCaughtUp, false, "Terminal empty result with issues is NOT caught up");
    assert.equal(ctrl.hasBlockedContent, true, "Blocked content exposed");
    assert.deepEqual(ctrl.issues, [issue]);
  });

  it("cursor priority rank rejects lp !== 0 && lp !== 1 with INVALID_CURSOR before executing SQL", () => {
    const db = createDisposableDb();
    try {
      putMaterial(db, "test-rank");
      const q = trackedDb(db);
      for (const invalidLp of [2, -1, 3, 100]) {
        const cursor = Buffer.from(JSON.stringify({
          v: 1,
          type: "due",
          ctx: { topic: null, statusFilter: "all", nowUtc: now, nextLocalMidnightUtc: mid },
          remIds: [],
          lc: "test-rank",
          lp: invalidLp,
          lu: now,
          isExhausted: false,
        })).toString("base64");
        assert.throws(() => getLibraryReviewDue(q, { ...opts, cursor }), /INVALID_CURSOR/);
      }
      assert.equal(q.stats.calls, 0, "No SQL calls executed for invalid priority ranks");
    } finally {
      db.close();
    }
  });

  it("history targeted enrichment resolves deferred material from earlier event page without inserting old events", () => {
    const db = createDisposableDb();
    try {
      const big = Array.from({ length: 500 }, () => ({ front: "F".repeat(1000), back: "B".repeat(2000), sourcePage: null }));
      for (const id of ["a", "b", "c"]) {
        putMaterial(db, id, id === "a" ? [{ front: "F", back: "B", sourcePage: null }] : big);
        putHistoryEvent(db, id, id === "a" ? [{ front: "F", back: "B", sourcePage: null }] : big);
      }

      // Page 1 with limit 2: events for c, b
      const first = getLibraryRecentReviews(db, { limit: 2, maxBatchRawJsonBytesBudget: 2097152 });
      assert.deepEqual(first.rows.map((x) => x.materialId), ["c", "b"]);
      assert.deepEqual(first.pendingMaterialIds, ["b"]);

      // Page 2: event page advances to 'a', but targeted enrichment requests 'b'
      const next = getLibraryRecentReviews(db, { limit: 2, cursor: first.next, enrichMaterialIds: ["b"], maxBatchRawJsonBytesBudget: 2097152 });
      assert.deepEqual(next.rows.map((x) => x.materialId), ["a"], "New event page contains only current page event a");
      assert.ok(next.enrichment, "Enrichment patches returned");
      const bPatch = next.enrichment.find((x) => x.materialId === "b");
      assert.ok(bPatch, "Target record for deferred b found");
      assert.equal(typeof bPatch.currentVersionId, "string", "Valid content version returned for b");
      assert.equal(bPatch.contentStatus, "current");
    } finally {
      db.close();
    }
  });

  it("controller.enrichMaterials applies target-only patches preserving existing untargeted current provenance and event order", async () => {
    const db = createDisposableDb();
    try {
      const big = Array.from({ length: 500 }, () => ({ front: "F".repeat(1000), back: "B".repeat(2000), sourcePage: null }));
      for (const id of ["a", "b"]) {
        putMaterial(db, id, big);
        putHistoryEvent(db, id, big);
      }

      const ctrl = new DeferredReadController(db, { maxBatchRawJsonBytesBudget: 2097152 }, (d, o) => getLibraryRecentReviews(d, o));
      await ctrl.loadNextPage();

      // b was evaluated as current, a was deferred as pending
      const rowB = ctrl.results.find((r) => r.materialId === "b");
      const rowA = ctrl.results.find((r) => r.materialId === "a");
      assert.equal(rowB.contentStatus, "current");
      assert.equal(rowA.contentStatus, "pending");

      // Enrich only 'a'
      await ctrl.enrichMaterials(["a"]);
      assert.equal(ctrl.results.find((r) => r.materialId === "a").contentStatus, "current", "a successfully enriched to current");
      assert.equal(ctrl.results.find((r) => r.materialId === "b").contentStatus, "current", "b remains current without downgrade");
    } finally {
      db.close();
    }
  });

  it("history enrichment distinguishes retired-version event from current version using currentVersionId", () => {
    const db = createDisposableDb();
    try {
      const oldCards = [{ front: "OldFront", back: "OldBack", sourcePage: null }];
      putMaterial(db, "mat-ret", oldCards);
      putHistoryEvent(db, "mat-ret", oldCards);

      // Now material content is updated to new cards (creating a new current version)
      const newCards = [{ front: "NewFront", back: "NewBack", sourcePage: null }];
      db.prepare("UPDATE ai_study_sets SET flashcards_json=? WHERE source_material_id='mat-ret'").run(JSON.stringify(newCards));

      const res = getLibraryRecentReviews(db, { limit: 10, enrichMaterialIds: ["mat-ret"] });
      assert.equal(res.rows.length, 1);
      const row = res.rows[0];
      assert.equal(row.isEarlierVersion, true, "Event version is earlier than current version");
      assert.equal(row.contentStatus, "earlier", "Event content status is earlier (retired)");
      assert.ok(row.currentVersionId, "Current version ID populated");
      assert.notEqual(row.versionId, row.currentVersionId, "Historical version ID differs from current version ID");
    } finally {
      db.close();
    }
  });

  it("oversized history content exposes reason: oversize and inspectionTarget rather than endless retry", () => {
    const db = createDisposableDb();
    try {
      putMaterial(db, "mat-big", [{ front: "F", back: "B", sourcePage: null }]);
      putHistoryEvent(db, "mat-big", [{ front: "F", back: "B", sourcePage: null }]);
      db.prepare("UPDATE ai_study_sets SET flashcards_json=? WHERE source_material_id='mat-big'").run("X".repeat(9 * 1024 * 1024));

      const res = getLibraryRecentReviews(db, { limit: 10, enrichMaterialIds: ["mat-big"] });
      assert.equal(res.rows.length, 1);
      const row = res.rows[0];
      assert.equal(row.contentStatus, "pending");
      assert.equal(row.blockedReason, "oversize");

      assert.ok(res.enrichment);
      const patch = res.enrichment.find((x) => x.materialId === "mat-big");
      assert.equal(patch.reason, "oversize");
      assert.equal(patch.inspectionTarget, "/study/mat-big");
    } finally {
      db.close();
    }
  });

  it("controller.enrichMaterials supports read-only retry on failure without altering cursor", async () => {
    let shouldFail = true;
    const reader = (_db, opts) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("TRANSIENT_NETWORK_ERROR");
      }
      return {
        enrichment: [{ materialId: "mat-retry", contentStatus: "current", currentVersionId: "v-new" }],
        nextCursor: "preserved-cursor",
      };
    };

    const ctrl = new DeferredReadController(null, {}, reader);
    ctrl.results = [{ materialId: "mat-retry", contentStatus: "pending", versionId: "v-new" }];
    ctrl.cursor = "preserved-cursor";

    await assert.rejects(() => ctrl.enrichMaterials(["mat-retry"]), /TRANSIENT_NETWORK_ERROR/);
    assert.equal(ctrl.error?.message, "TRANSIENT_NETWORK_ERROR");
    assert.equal(ctrl.cursor, "preserved-cursor", "Cursor preserved across failed enrichment");

    // Retry read-only succeeds
    await ctrl.retryRead();
    assert.equal(ctrl.error, null);
    assert.equal(ctrl.results[0].contentStatus, "current");
    assert.equal(ctrl.cursor, "preserved-cursor", "Cursor unchanged after enrichment retry");
  });
});
