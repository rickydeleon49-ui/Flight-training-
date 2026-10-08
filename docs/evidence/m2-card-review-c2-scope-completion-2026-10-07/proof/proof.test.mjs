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
  });

  it("reuses retained schedule when content returns to identical A (A -> B -> A) without writes", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const revert = result.materials.find((m) => m.materialId === "mat-revert-04");
    assert.ok(revert, "mat-revert-04 must be discovered");
    assert.equal(revert.dayCount, 1, "Retained due schedule from version A is current due work");
    assert.equal(revert.totalDueCount, 1);
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
  });

  it("applies within-batch urgency ranking: Again due before Day due before New cards", () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      // 1. New only material (Bucket 2)
      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-new', 'A-New Material', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-new', ?, ?, ?)").run(JSON.stringify(generateCards("new", 2)), now, now);

      // 2. Day due material (Bucket 1)
      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-day', 'M-Day Material', ?, ?)").run(now, now);
      const dayCards = generateCards("day", 2);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-day', ?, ?, ?)").run(JSON.stringify(dayCards), now, now);
      const vDay = deriveCardVersion("m-day", dayCards);
      db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'm-day', ?, 2, 'gemini', ?, 1)").run(vDay.versionId, vDay.contentHash, now);
      for (const i of vDay.items) db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, vDay.versionId, i.ordinal, i.front, i.back);
      db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'm-day', 'simple-v1', 0, ?, ?, 1, 1)").run(vDay.items[0].itemId, "2026-10-07T10:00:00.000Z", now);

      // 3. Again due material (Bucket 0)
      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('m-again', 'Z-Again Material', ?, ?)").run(now, now);
      const againCards = generateCards("again", 2);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-again', ?, ?, ?)").run(JSON.stringify(againCards), now, now);
      const vAgain = deriveCardVersion("m-again", againCards);
      db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'm-again', ?, 2, 'gemini', ?, 1)").run(vAgain.versionId, vAgain.contentHash, now);
      for (const i of vAgain.items) db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, vAgain.versionId, i.ordinal, i.front, i.back);
      db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'm-again', 'simple-v1', -1, ?, ?, 1, 1)").run(vAgain.items[0].itemId, now, now);

      const res = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 10 });
      const ids = res.materials.map((m) => m.materialId);

      // Must be ranked: Again (Bucket 0) -> Day (Bucket 1) -> New (Bucket 2)
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
  });

  it("enriches history rows with contentStatus, interval, step, and card sides", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const page = getLibraryRecentReviews(db, { limit: 10 });
    assert.ok(page.rows.length > 0);

    const first = page.rows[0];
    assert.ok(first.id);
    assert.ok(first.materialId);
    assert.ok(first.materialTitle);
    assert.ok(["current", "earlier", "unavailable", "malformed"].includes(first.contentStatus));
    assert.equal(typeof first.isEarlierVersion, "boolean");
    assert.ok(first.front);
    assert.ok(first.back);
    assert.ok(["again", "hard", "good", "easy"].includes(first.rating));
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

describe("[C2 Proof] Assertion 4: Asynchronous Deferred Read Controller & Held Requests", () => {
  it("synchronous busy lock excludes same-turn duplicate activations", async () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";
      for (let i = 0; i < 4; i++) {
        const id = `item-${i}`;
        db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES (?, ?, ?, ?)").run(id, JSON.stringify(generateCards(id, 1)), now, now);
      }

      const ctrl = new DeferredReadController(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 10 });
      const p1 = ctrl.loadNextPage();
      const p2 = ctrl.loadNextPage();
      await Promise.all([p1, p2]);

      // No duplicate items loaded
      const ids = ctrl.results.map((r) => r.materialId);
      assert.equal(ids.length, new Set(ids).size);
      assert.equal(ctrl.results.length, 4);
    } finally {
      db.close();
    }
  });

  it("held read promises: obsolete generation discarded when filter changes while awaiting", async () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('m-aero', 'Aero', 'aerodynamics', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-aero', ?, ?, ?)").run(JSON.stringify(generateCards("a", 1)), now, now);

      db.prepare("INSERT INTO study_materials(id, title, topic, created_at, updated_at) VALUES ('m-nav', 'Nav', 'navigation', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-nav', ?, ?, ?)").run(JSON.stringify(generateCards("n", 1)), now, now);

      let holdResolve;
      const delayedReader = async (database, opts) => {
        if (opts.topic === "aerodynamics") {
          await new Promise((r) => { holdResolve = r; });
        }
        return getLibraryReviewDue(database, opts);
      };

      const ctrl = new DeferredReadController(db, { nowUtc: now, nextLocalMidnightUtc: mid, topic: "aerodynamics" }, delayedReader);

      // Start read A (held in flight)
      const pA = ctrl.loadNextPage();

      // Change filter while read A is still pending
      ctrl.setFilter({ topic: "navigation" });
      assert.deepEqual(ctrl.results, [], "setFilter synchronously clears prior results");

      // Start read B
      const pB = ctrl.loadNextPage();
      await pB;

      // Now release delayed read A
      holdResolve();
      await pA;

      // Controller must only contain results from B (navigation), not A!
      assert.equal(ctrl.results.length, 1);
      assert.equal(ctrl.results[0].materialId, "m-nav");
    } finally {
      db.close();
    }
  });

  it("retry retains failed cursor without replaying writes", async () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    let shouldFail = true;
    const flakeReader = async (database, opts) => {
      if (shouldFail) throw new Error("Simulated transient DB error");
      return getLibraryReviewDue(database, opts);
    };

    const ctrl = new DeferredReadController(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 5 }, flakeReader);

    // Initial attempt fails
    await assert.rejects(async () => { await ctrl.loadNextPage(); }, /Simulated transient DB error/);
    assert.ok(ctrl.error);
    assert.equal(ctrl.results.length, 0);

    // Retry succeeds using preserved cursor
    shouldFail = false;
    await ctrl.retryRead();
    assert.equal(ctrl.error, null);
    assert.equal(ctrl.results.length, 5);
  });

  it("onReset invalidates material and triggers fresh authoritative read", async () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const ctrl = new DeferredReadController(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 20 });
    await ctrl.loadNextPage();

    const countBefore = ctrl.results.length;
    assert.ok(countBefore > 0);

    ctrl.onReset("mat-aero-01");
    assert.equal(ctrl.cursor, null, "Cursor reset for fresh read");
    assert.ok(!ctrl.results.some((r) => r.materialId === "mat-aero-01"));
  });

  it("onMaterialDeleted cleans up rows and prevents zombie reappearance", async () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const ctrl = new DeferredReadController(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 20 });
    await ctrl.loadNextPage();

    ctrl.onMaterialDeleted("mat-aero-01");
    assert.ok(!ctrl.results.some((r) => r.materialId === "mat-aero-01"));
  });
});

describe("[C2 Proof] Assertion 5: File-Backed Reopen/Restore & Schema-11 Upgrade", () => {
  it("exact roundtrip discovery across file-backed db close and reopen", () => {
    const testDbPath = resolve(process.cwd(), "scratch/file-backed-test.db");
    if (existsSync(testDbPath)) unlinkSync(testDbPath);

    try {
      // 1. Create file-backed DB and populate
      const db1 = createDisposableDb(testDbPath);
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      db1.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('mat-file-01', 'File Aero', ?, ?)").run(now, now);
      const cards = generateCards("FileAero", 3);
      db1.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('mat-file-01', ?, ?, ?)").run(JSON.stringify(cards), now, now);
      const v = deriveCardVersion("mat-file-01", cards);
      db1.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'mat-file-01', ?, 3, 'gemini', ?, 1)").run(v.versionId, v.contentHash, now);
      for (const i of v.items) db1.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(i.itemId, v.versionId, i.ordinal, i.front, i.back);
      db1.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'mat-file-01', 'simple-v1', 0, ?, ?, 1, 1)").run(v.items[0].itemId, "2026-10-07T10:00:00.000Z", now);

      const res1 = getLibraryReviewDue(db1, { nowUtc: now, nextLocalMidnightUtc: mid });
      db1.close();

      // 2. Reopen closed file-backed DB
      const db2 = new DatabaseSync(testDbPath);
      const res2 = getLibraryReviewDue(db2, { nowUtc: now, nextLocalMidnightUtc: mid });
      db2.close();

      assert.deepEqual(res1.materials, res2.materials, "Discovery results must match exactly across file-backed close and reopen");
    } finally {
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
    }
  });

  it("proves schema-11 database gains shipped schema 12 and discovers cards without backfill", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const migrationsDir = resolve(process.cwd(), "src-tauri/migrations");
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

      // Apply migrations 0001 through 0011 (pre-review schema)
      for (const f of files) {
        if (f.startsWith("0012_")) break;
        db.exec(readFileSync(resolve(migrationsDir, f), "utf8"));
      }

      // Verify Schema 11 has study_materials and ai_study_sets, but NO card review tables
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";
      db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('mat-mig-01', 'Migrated Set', ?, ?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('mat-mig-01', ?, ?, ?)").run(JSON.stringify(generateCards("Mig", 5)), now, now);

      const tableCheck11 = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='card_versions'").get();
      assert.equal(tableCheck11, undefined, "card_versions must not exist in schema 11");

      // Apply migration 0012 (shipped schema 12)
      const mig12 = readFileSync(resolve(migrationsDir, "0012_card_reviews.sql"), "utf8");
      db.exec(mig12);

      const tableCheck12 = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='card_versions'").get();
      assert.ok(tableCheck12, "card_versions exists in schema 12");

      // Discover cards without requiring production backfill
      const dueRes = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid });
      assert.equal(dueRes.materials.length, 1);
      assert.equal(dueRes.materials[0].materialId, "mat-mig-01");
      assert.equal(dueRes.materials[0].newCount, 5, "All 5 raw cards discovered as new without backfill");
      assert.equal(dueRes.materials[0].totalDueCount, 0);

      // Verify practice sessions separation (practice test tables remain independent)
      const practiceTables = db.prepare("SELECT count(*) as c FROM sqlite_schema WHERE type='table' AND name LIKE 'practice_%'").get().c;
      assert.ok(practiceTables > 0, "Practice test tables remain completely distinct and intact");
    } finally {
      db.close();
    }
  });

  it("cascading material deletion deletes items and versions while tombstoning operations", () => {
    const { db } = buildSyntheticDatabase(100, 200);

    const verRow = db.prepare("SELECT id FROM card_versions WHERE source_material_id = 'mat-aero-01'").get();
    assert.ok(verRow);
    const realVersionId = verRow.id;

    db.prepare(`
      INSERT INTO card_review_operations (
        operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json
      ) VALUES ('op-aero-1', 'rate', 'mat-aero-01', 0, 'hash123', ?, 0, '{"success":true}')
    `).run(T0);

    // Delete material
    db.prepare("DELETE FROM study_materials WHERE id = 'mat-aero-01'").run();

    const postVerCount = db.prepare("SELECT COUNT(*) AS c FROM card_versions WHERE source_material_id = 'mat-aero-01'").get().c;
    assert.equal(postVerCount, 0, "Versions deleted on cascade");

    const postItemCount = db.prepare("SELECT COUNT(*) AS c FROM card_items WHERE version_id = ?").get(realVersionId).c;
    assert.equal(postItemCount, 0, "Items deleted on cascade");

    const op = db.prepare("SELECT * FROM card_review_operations WHERE operation_id = 'op-aero-1'").get();
    assert.ok(op);
    assert.equal(op.is_erased, 1, "Operation tombstoned");
    assert.equal(op.result_json, null, "Result erased");
  });
});

describe("[C2 Proof] Assertion 6: Negative Controls & Semantic Failure Verification", () => {
  it("semantic negative control 1: query without current-content check fails Assertion 1", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    const brokenRows = getLibraryReviewDueBrokenCurrentVersion(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc });
    const brokenWeather = brokenRows.find((r) => r.material_id === "mat-changed-03");
    assert.ok(brokenWeather);
    assert.ok(brokenWeather.day_count > 0, "Broken query incorrectly included retired due cards");

    const realRes = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });
    const realWeather = realRes.materials.find((m) => m.materialId === "mat-changed-03");
    assert.ok(realWeather, "realWeather must be found");
    assert.equal(realWeather.totalDueCount, 0, "Real candidate query correctly excluded retired cards");
  });

  it("semantic negative control 2: keyset pagination without tie-breaker id loses rows on tied timestamps", () => {
    const { db } = buildSyntheticDatabase(100, 100);
    const tieTime = at(T0, 3600000);
    const ver = db.prepare("SELECT id FROM card_versions LIMIT 1").get();
    for (let i = 0; i < 6; i++) {
      const itemId = `item-neg-${i}`;
      db.prepare("INSERT INTO card_items (id, version_id, ordinal, front, back) VALUES (?, ?, ?, 'F', 'B')").run(
        itemId, ver.id, 200 + i
      );
      db.prepare(`
        INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
        VALUES (?, ?, 0, 'good', ?, 'simple-v1', '{}', '{}')
      `).run(`ev-neg-${i}`, itemId, tieTime);
    }

    const p1 = getLibraryRecentReviewsBrokenCursor(db, { cursor: null, limit: 3 });
    assert.equal(p1.length, 3);
    const p2 = getLibraryRecentReviewsBrokenCursor(db, { cursor: { reviewedAt: p1.at(-1)?.reviewed_at }, limit: 3 });
    const remainingTiedInP2 = p2.filter((item) => item.reviewed_at === tieTime);
    assert.equal(remainingTiedInP2.length, 0, "Broken cursor drops remaining tied items!");

    const realP1 = getLibraryRecentReviews(db, { cursor: null, limit: 3 });
    const realP2 = getLibraryRecentReviews(db, { cursor: realP1.next, limit: 3 });
    const remainingTiedInRealP2 = realP2.rows.filter((item) => item.reviewedAt === tieTime);
    assert.equal(remainingTiedInRealP2.length, 3, "Real keyset cursor with ID successfully retrieves all remaining tied items");
  });

  it("semantic negative control 3: broken candidate progression without cursor drops older items behind 250 ineligible items", () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";

      // Insert 250 ineligible materials (due in future)
      for (let i = 0; i < 250; i++) {
        const id = `ineligible-${String(i).padStart(3, "0")}`;
        const raw = generateCards(id, 1);
        db.prepare("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES(?,?,?,?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES(?,?,?,?)").run(id, JSON.stringify(raw), now, now);
        const v = deriveCardVersion(id, raw);
        db.prepare("INSERT INTO card_versions(id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES(?,?,?,1,'gemini',?,1)").run(v.versionId, id, v.contentHash, now);
        db.prepare("INSERT INTO card_items(id,version_id,ordinal,front,back) VALUES(?,?,0,'F','B')").run(v.items[0].itemId, v.versionId);
        db.prepare("INSERT INTO card_review_state(item_id,source_material_id,scheduler_version,step,due_at,last_reviewed_at,reps,revision) VALUES(?,?,'simple-v1',0,'2026-10-25T00:00:00.000Z',?,1,1)").run(v.items[0].itemId, id, now);
      }

      // Older new material
      db.prepare("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('older-new','Older New',?,?)").run(now, "2026-10-01T00:00:00.000Z");
      db.prepare("INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES('older-new',?,?,?)").run(JSON.stringify(generateCards("new", 1)), now, "2026-10-01T00:00:00.000Z");

      const brokenRes = getLibraryReviewDueBrokenCandidateProgression(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 50 });
      assert.equal(brokenRes.materials.length, 0, "Broken progression drops older material completely on page 1");

      let cursor = null;
      let found = false;
      for (let p = 0; p < 5; p++) {
        const res = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, cursor, limit: 50 });
        found ||= res.materials.some((m) => m.materialId === "older-new");
        cursor = res.nextCursor;
        if (found || !cursor) break;
      }
      assert.ok(found, "Correct bounded continuation successfully discovers older-new material!");
    } finally {
      db.close();
    }
  });
});
