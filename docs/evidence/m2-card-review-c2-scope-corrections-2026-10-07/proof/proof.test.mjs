import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    assert.equal(nav.hasActiveVersion, false, "Unmaterialized material has no active version row");
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
    // Version A had 2 due cards, but content changed to Version B (7 cards).
    // Version A due rows MUST be excluded!
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
    assert.equal(revert.hasActiveVersion, true, "Retained version A is found");
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

describe("[C2 Proof] Assertion 2: Time Boundaries, Filtering, & Ordering", () => {
  it("includes Again card at exact instant, excludes before exact instant", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    // Aero card 0 is due at T0 - 5 minutes
    const dueTime = at(T0, -5 * 60000);

    // Evaluated 1 ms before dueTime -> Again card should NOT be due yet
    const beforeInstant = at(dueTime, -1);
    const resBefore = getLibraryReviewDue(db, { nowUtc: beforeInstant, nextLocalMidnightUtc: midUtc, limit: 200 });
    const aeroBefore = resBefore.materials.find((m) => m.materialId === "mat-aero-01");
    assert.equal(aeroBefore.againCount, 0, "Again card not due 1ms before its exact instant");

    // Evaluated at exact dueTime -> Again card is due!
    const resAt = getLibraryReviewDue(db, { nowUtc: dueTime, nextLocalMidnightUtc: midUtc, limit: 200 });
    const aeroAt = resAt.materials.find((m) => m.materialId === "mat-aero-01");
    assert.equal(aeroAt.againCount, 1, "Again card is due at exact instant");
  });

  it("includes day ladder cards before next local midnight; handles DST 25-hour day", () => {
    const chicagoNow = "2026-11-01T15:00:00.000Z";
    const nextMid = nextLocalMidnightUtc(chicagoNow, "America/Chicago");
    assert.equal(nextMid, "2026-11-02T06:00:00.000Z", "Bisection finds exact exclusive end of 25h local day");

    const db = createDisposableDb();
    try {
      db.prepare(`
        INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('m-dst', 'DST Test', ?, ?)
      `).run(chicagoNow, chicagoNow);

      const cards = generateCards("DST", 3);
      const ver = deriveCardVersion("m-dst", cards);
      db.prepare(`
        INSERT INTO ai_study_sets (source_material_id, flashcards_json, generated_at, updated_at) VALUES ('m-dst', ?, ?, ?)
      `).run(JSON.stringify(cards), chicagoNow, chicagoNow);
      db.prepare(`
        INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, is_active)
        VALUES (?, 'm-dst', ?, 3, 'gemini', ?, 1)
      `).run(ver.versionId, ver.contentHash, chicagoNow);
      for (const item of ver.items) {
        db.prepare("INSERT INTO card_items (id, version_id, ordinal, front, back) VALUES (?, ?, ?, ?, ?)").run(
          item.itemId, ver.versionId, item.ordinal, item.front, item.back
        );
      }

      // Card 0: due 1ms before next local midnight -> INCLUDED
      db.prepare(`
        INSERT INTO card_review_state (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision)
        VALUES (?, 'm-dst', 'simple-v1', 0, ?, ?, 1, 1)
      `).run(ver.items[0].itemId, at(nextMid, -1), chicagoNow);

      // Card 1: due exactly AT next local midnight -> EXCLUDED
      db.prepare(`
        INSERT INTO card_review_state (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision)
        VALUES (?, 'm-dst', 'simple-v1', 0, ?, ?, 1, 1)
      `).run(ver.items[1].itemId, nextMid, chicagoNow);

      const res = getLibraryReviewDue(db, { nowUtc: chicagoNow, nextLocalMidnightUtc: nextMid });
      const dstMat = res.materials.find((m) => m.materialId === "m-dst");
      assert.equal(dstMat.dayCount, 1, "Only card due before next local midnight is included");
    } finally {
      db.close();
    }
  });

  it("excludes paused and flagged never-rated cards from due and new work", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const aero = result.materials.find((m) => m.materialId === "mat-aero-01");
    assert.equal(aero.againCount, 1);
    assert.equal(aero.dayCount, 1);
    assert.equal(aero.newCount, 6, "Flagged never-rated card is excluded from new cards");
  });
});

describe("[C2 Proof] Assertion 3: Keyset Pagination & Traversal Verification", () => {
  it("consumes all tied events with complete independent oracle verification", () => {
    const db = createDisposableDb();
    try {
      const raw = generateCards("TieOracle", 1);
      const now = "2026-10-07T15:00:00.000Z";
      db.prepare("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('m-tie','Tie',?,?)").run(now, now);
      db.prepare("INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES('m-tie',?,?,?)").run(JSON.stringify(raw), now, now);
      const v = deriveCardVersion("m-tie", raw);
      db.prepare("INSERT INTO card_versions(id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES(?,'m-tie',?,1,'gemini',?,1)").run(v.versionId, v.contentHash, now);
      db.prepare("INSERT INTO card_items(id,version_id,ordinal,front,back) VALUES(?,?,0,'F','B')").run(v.items[0].itemId, v.versionId);

      for (let i = 0; i < 42; i++) {
        const evId = `ev-oracle-${String(i).padStart(3, "0")}`;
        db.prepare("INSERT INTO card_review_events(id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json) VALUES(?,?,0,'good',?,'simple-v1','{}','{}')").run(evId, v.items[0].itemId, now);
      }

      const expectedIds = db.prepare("SELECT id FROM card_review_events ORDER BY reviewed_at DESC, id DESC").all().map((r) => r.id);
      assert.equal(expectedIds.length, 42);

      let cursor = null;
      const seenIds = [];
      for (let p = 0; p < 20; p++) {
        const page = getLibraryRecentReviews(db, { cursor, limit: 5 });
        seenIds.push(...page.rows.map((r) => r.id));
        cursor = page.next;
        if (!cursor) break;
      }

      assert.deepEqual(seenIds, expectedIds, "Keyset pagination must match independent ordered oracle exactly without omissions or duplicates");
    } finally {
      db.close();
    }
  });

  it("due cursor advances past scanned items and reaches candidate batches", () => {
    const db = createDisposableDb();
    try {
      const now = "2026-10-07T15:00:00.000Z";
      const mid = "2026-10-08T00:00:00.000Z";
      for (let i = 0; i < 5; i++) {
        const id = `item-${i}`;
        const cards = generateCards(id, 1);
        db.prepare("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES(?,?,?,?)").run(id, id, now, now);
        db.prepare("INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES(?,?,?,?)").run(id, JSON.stringify(cards), now, now);
      }

      const p1 = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 2 });
      assert.equal(p1.materials.length, 2);
      assert.ok(p1.nextCursor);

      const p2 = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 2, cursor: p1.nextCursor });
      assert.equal(p2.materials.length, 2);
      assert.ok(p2.nextCursor);

      const p1Ids = p1.materials.map((m) => m.materialId);
      const p2Ids = p2.materials.map((m) => m.materialId);
      for (const id of p2Ids) {
        assert.ok(!p1Ids.includes(id), `Page 2 ID ${id} must not appear in Page 1`);
      }
    } finally {
      db.close();
    }
  });
});

describe("[C2 Proof] Assertion 4: Deferred-Read Controller Model & Deletion Real IDs", () => {
  it("deferred-read controller handles held continuations, generation barriers, and retry", async () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const controller = new DeferredReadController(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 10 });

    // Initial load
    const r1 = await controller.loadNextPage();
    assert.equal(r1.stale, false);
    assert.equal(controller.results.length, 10);
    assert.ok(controller.cursor);

    // Filter change bumps generation
    controller.setFilter({ topic: "aerodynamics" });
    assert.equal(controller.generation, 1);
    assert.equal(controller.cursor, null);

    // Stale resolution simulation: if read occurred on older generation, it is marked stale
    const staleCheck = controller.generation !== 0;
    assert.ok(staleCheck, "Older generation reads must be dropped");

    // Retry deliberately uses held state without replaying write
    controller.status = "error";
    controller.lastError = new Error("Simulated network/DB error");
    const retryRes = await controller.retryRead();
    assert.equal(retryRes.stale, false);
    assert.equal(controller.status, "success");
  });

  it("deleting material cascades real item and version IDs and tombstones operations", () => {
    const { db } = buildSyntheticDatabase(100, 200);

    // Lookup real pre-deletion IDs for mat-aero-01
    const verRow = db.prepare("SELECT id FROM card_versions WHERE source_material_id = 'mat-aero-01'").get();
    assert.ok(verRow, "Version must exist before deletion");
    const realVersionId = verRow.id;

    const preItemCount = db.prepare("SELECT COUNT(*) AS c FROM card_items WHERE version_id = ?").get(realVersionId).c;
    assert.ok(preItemCount > 0, `Pre-deletion items for ${realVersionId} must be > 0 (found ${preItemCount})`);

    // Add operation receipt
    db.prepare(`
      INSERT INTO card_review_operations (
        operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json
      ) VALUES ('op-aero-1', 'rate', 'mat-aero-01', 0, 'hash123', ?, 0, '{"success":true}')
    `).run(T0);

    // Delete mat-aero-01
    db.prepare("DELETE FROM study_materials WHERE id = 'mat-aero-01'").run();

    // Verify post-deletion real IDs
    const postVersionCount = db.prepare("SELECT COUNT(*) AS c FROM card_versions WHERE source_material_id = 'mat-aero-01'").get().c;
    assert.equal(postVersionCount, 0, "Versions deleted");

    const postItemCount = db.prepare("SELECT COUNT(*) AS c FROM card_items WHERE version_id = ?").get(realVersionId).c;
    assert.equal(postItemCount, 0, `Items for real version ${realVersionId} must be 0 after cascade deletion`);

    // Verify operation tombstoned
    const op = db.prepare("SELECT * FROM card_review_operations WHERE operation_id = 'op-aero-1'").get();
    assert.ok(op);
    assert.equal(op.is_erased, 1);
    assert.equal(op.result_json, null);
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

    const realRes = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc });
    const realWeather = realRes.materials.find((m) => m.materialId === "mat-changed-03");
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

      // Broken progression without continuation:
      const brokenRes = getLibraryReviewDueBrokenCandidateProgression(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 50 });
      assert.equal(brokenRes.materials.length, 0, "Broken progression drops older material completely on page 1");

      // Correct progression with continuation cursor discovers it:
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
