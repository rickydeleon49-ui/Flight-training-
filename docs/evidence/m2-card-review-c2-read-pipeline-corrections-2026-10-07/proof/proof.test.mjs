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
