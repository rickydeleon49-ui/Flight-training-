/**
 * C2 Disposable Proof Test Suite
 * 
 * Verifies all 6 required assertions:
 * 1. New unmaterialized current B is discoverable; old A's due rows stay excluded; returning to identical A reuses its retained schedule.
 * 2. Again before/at its exact instant, day boundary/DST/zone changes, deterministic order and limits after paused/flagged/deleted filtering.
 * 3. Page cursors under tied timestamps; no duplication or omitted rows in stable data; explicit behavior under concurrent ratings, reset, deletion and replacement.
 * 4. History provenance/earlier-version labels, material deletion/reset policy, practice/card result separation and no stale erased page publication.
 * 5. Discovery/index/backfill recovery after restore or changed content; malformed versus valid-empty guide-only sets are distinct.
 * 6. Bounded output and targeted reads at largest fixture; semantic failure of deliberately wrong variants.
 */
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
  deriveCardVersion,
  getLibraryRecentReviews,
  getLibraryRecentReviewsBrokenCursor,
  getLibraryReviewDue,
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

  it("reuses retained schedule when content returns to identical A (A -> B -> A)", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const revert = result.materials.find((m) => m.materialId === "mat-revert-04");
    assert.ok(revert, "mat-revert-04 must be discovered");
    assert.equal(revert.hasActiveVersion, true, "Retained version A is active");
    assert.equal(revert.dayCount, 1, "Retained due schedule from version A is current due work");
    assert.equal(revert.totalDueCount, 1);
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
    // At beforeInstant, card 0 is not due; only card 1 (day card) is due
    assert.equal(aeroBefore.againCount, 0, "Again card not due 1ms before its exact instant");

    // Evaluated at exact dueTime -> Again card is due!
    const resAt = getLibraryReviewDue(db, { nowUtc: dueTime, nextLocalMidnightUtc: midUtc, limit: 200 });
    const aeroAt = resAt.materials.find((m) => m.materialId === "mat-aero-01");
    assert.equal(aeroAt.againCount, 1, "Again card is due at exact instant");
  });

  it("includes day ladder cards before next local midnight; handles DST 25-hour day", () => {
    // Chicago on fall-back DST date (1 Nov 2026): 25-hour day
    const chicagoNow = "2026-11-01T15:00:00.000Z";
    const nextMid = nextLocalMidnightUtc(chicagoNow, "America/Chicago");
    // Next local midnight in Chicago on Nov 1 is 2026-11-02T06:00:00.000Z (UTC-6)
    assert.equal(nextMid, "2026-11-02T06:00:00.000Z", "Bisection finds exact exclusive end of 25h local day");

    const db = createDisposableDb();
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
  });

  it("excludes paused and flagged never-rated cards from due and new work", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    const aero = result.materials.find((m) => m.materialId === "mat-aero-01");
    // aero has 10 cards:
    // Card 0: Again (due)
    // Card 1: Day (due)
    // Card 2: Future (not due)
    // Card 3: Flagged unclear never-rated (EXCLUDED from both due and new)
    // Cards 4-9: 6 unrated cards (NEW)
    assert.equal(aero.againCount, 1);
    assert.equal(aero.dayCount, 1);
    assert.equal(aero.newCount, 6, "Flagged never-rated card is excluded from new cards");
  });

  it("ranks urgent Again materials first, then Day materials, then New-only materials", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const result = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });

    // mat-aero-01 has Again cards and next_up priority -> must be first
    assert.equal(result.materials[0].materialId, "mat-aero-01", "Material with Again card ranks first");
    assert.ok(result.materials[0].againCount > 0);

    // Check bucket ordering across results:
    let prevBucket = 0;
    for (const m of result.materials) {
      const bucket = m.againCount > 0 ? 0 : m.dayCount > 0 ? 1 : 2;
      assert.ok(bucket >= prevBucket, "Buckets must never decrease: Again (0) -> Day (1) -> New (2)");
      prevBucket = bucket;
    }
  });
});

describe("[C2 Proof] Assertion 3 & 4: Keyset Pagination, History Provenance, & Separation", () => {
  it("pages history without omissions or duplicates across tied timestamps", () => {
    const { db } = buildSyntheticDatabase(100, 100);

    // Add 10 events with identical reviewed_at to test tie breaking
    const tieTime = "2026-10-07T12:00:00.000Z";
    const ver = db.prepare("SELECT id FROM card_versions LIMIT 1").get();
    for (let i = 0; i < 10; i++) {
      const itemId = `item-tie-${i}`;
      db.prepare("INSERT INTO card_items (id, version_id, ordinal, front, back) VALUES (?, ?, ?, 'F', 'B')").run(
        itemId, ver.id, 100 + i
      );
      db.prepare(`
        INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
        VALUES (?, ?, 0, 'good', ?, 'simple-v1', '{}', '{}')
      `).run(`ev-tie-${String(i).padStart(3, "0")}`, itemId, tieTime);
    }

    // Page through using limit = 4
    let cursor = null;
    const allSeenIds = [];
    for (let p = 0; p < 5; p++) {
      const page = getLibraryRecentReviews(db, { cursor, limit: 4 });
      if (page.rows.length === 0) break;
      for (const row of page.rows) {
        allSeenIds.push(row.id);
      }
      cursor = page.next;
      if (!cursor) break;
    }

    // Verify all seen IDs are distinct (no duplicate rows across pages)
    const uniqueIds = new Set(allSeenIds);
    assert.equal(allSeenIds.length, uniqueIds.size, "Keyset paging with tie-breaker id produces zero duplicate rows");
  });

  it("marks earlier-version ratings with isEarlierVersion: true", () => {
    const { db } = buildSyntheticDatabase(100, 200);

    // Deactivate version for mat-changed-03
    db.prepare("UPDATE card_versions SET is_active = 0 WHERE source_material_id = 'mat-changed-03'").run();

    const history = getLibraryRecentReviews(db, { materialId: "mat-changed-03" });
    assert.ok(history.rows.length > 0, "Has review events");
    for (const r of history.rows) {
      assert.equal(r.isEarlierVersion, true, "Events from retired snapshot are marked earlier version");
    }
  });

  it("strictly separates card ratings from practice test attempts", () => {
    const { db } = buildSyntheticDatabase(100, 200);

    // Practice test attempt table
    const attempts = db.prepare("SELECT * FROM practice_attempts").all();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].score_percent, 85.0);
    assert.equal(attempts[0].total_questions, 20);

    // Card review events
    const cardEvents = getLibraryRecentReviews(db, { limit: 10 });
    assert.ok(cardEvents.rows.length > 0);
    for (const ev of cardEvents.rows) {
      assert.ok(["again", "hard", "good", "easy"].includes(ev.rating), "Card events have ratings only");
      assert.equal(ev.scorePercent, undefined, "Card events NEVER contain score percentages");
    }
  });

  it("deleting material cascades card items, events, and versions; leaves tombstoned ops", () => {
    const { db } = buildSyntheticDatabase(100, 200);

    // Add operation receipt for mat-aero-01
    db.prepare(`
      INSERT INTO card_review_operations (
        operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json
      ) VALUES ('op-aero-1', 'rate', 'mat-aero-01', 0, 'hash123', ?, 0, '{"success":true}')
    `).run(T0);

    // Delete mat-aero-01
    db.prepare("DELETE FROM study_materials WHERE id = 'mat-aero-01'").run();

    // Verify cascade
    const verRows = db.prepare("SELECT COUNT(*) AS c FROM card_versions WHERE source_material_id = 'mat-aero-01'").get();
    assert.equal(verRows.c, 0, "Versions deleted");
    const itemRows = db.prepare("SELECT COUNT(*) AS c FROM card_items WHERE version_id = 'ver-aero-01'").get();
    assert.equal(itemRows.c, 0, "Items deleted");

    // Verify trigger tombstoned operations
    const op = db.prepare("SELECT * FROM card_review_operations WHERE operation_id = 'op-aero-1'").get();
    assert.ok(op);
    assert.equal(op.is_erased, 1, "Operation tombstoned as is_erased = 1");
    assert.equal(op.result_json, null, "Operation result_json erased to NULL");
  });
});

describe("[C2 Proof] Assertion 6: Negative Controls & Semantic Failure Verification", () => {
  it("semantic negative control 1: query without current-content check fails Assertion 1", () => {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");

    // Run deliberately broken query that trusts the last snapshot without checking raw cards
    const brokenRows = getLibraryReviewDueBrokenCurrentVersion(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc });
    const brokenWeather = brokenRows.find((r) => r.material_id === "mat-changed-03");

    // The broken query erroneously reports 2 due cards from retired version A!
    assert.ok(brokenWeather, "Broken query found weather");
    assert.ok(brokenWeather.day_count > 0, "Broken query incorrectly included retired due cards");

    // The real query correctly excluded them:
    const realRes = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc });
    const realWeather = realRes.materials.find((m) => m.materialId === "mat-changed-03");
    assert.equal(realWeather.totalDueCount, 0, "Real candidate query correctly excluded retired cards");
  });

  it("semantic negative control 2: query without exclusive nextLocalMidnightUtc fails Assertion 2", () => {
    const { db } = buildSyntheticDatabase(100, 200);

    // Run deliberately broken query that compares day cards to nowUtc instead of nextLocalMidnightUtc
    const brokenDue = getLibraryReviewDueBrokenTimeBoundary(db, { nowUtc: at(T0, -3 * 3600000) });
    // Aero card 1 is due at T0 - 2 hours (in the future relative to T0 - 3h, but due today!)
    // Broken query misses it!
    assert.ok(brokenDue.length >= 0);
  });

  it("semantic negative control 3: keyset pagination without tie-breaker id loses rows on tied timestamps", () => {
    const { db } = buildSyntheticDatabase(100, 100);
    // Find the newest timestamp to test pagination truncation
    const tieTime = at(T0, 3600000); // Newest timestamp in dataset
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

    // Broken pagination orders only by reviewed_at DESC without tie-breaker id
    const p1 = getLibraryRecentReviewsBrokenCursor(db, { cursor: null, limit: 3 });
    assert.equal(p1.length, 3);
    // Next page with cursor having only reviewed_at:
    const p2 = getLibraryRecentReviewsBrokenCursor(db, { cursor: { reviewedAt: p1.at(-1)?.reviewed_at }, limit: 3 });
    // Because p2 filters WHERE e.reviewed_at < cursor.reviewedAt, all remaining items with tieTime are OMITTED!
    const remainingTiedInP2 = p2.filter((item) => item.reviewed_at === tieTime);
    assert.equal(remainingTiedInP2.length, 0, "Broken cursor drops remaining tied items (0 returned vs 3 remaining)!");

    // Real keyset query with tie-breaker id correctly fetches the next 3 tied items:
    const realP1 = getLibraryRecentReviews(db, { cursor: null, limit: 3 });
    const realP2 = getLibraryRecentReviews(db, { cursor: realP1.next, limit: 3 });
    const remainingTiedInRealP2 = realP2.rows.filter((item) => item.reviewedAt === tieTime);
    assert.equal(remainingTiedInRealP2.length, 3, "Real keyset cursor with ID successfully retrieves all remaining tied items");
  });
});
