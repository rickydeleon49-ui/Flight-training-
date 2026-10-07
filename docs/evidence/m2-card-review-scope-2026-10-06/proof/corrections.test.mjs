// CRS-R1 / CRS-R2 corrections proof (research only; not application code).
//
// [sqlite] executes the corrected exported due-queue query on a disposable
//          node:sqlite database with a representative schema (not migration 12).
// [model]  exercises the corrected in-memory operation model (simulation).
// Neither establishes native atomic writes, browser durability or
// installed-app behavior; production C1 must prove those with real
// transactions.
//
// The reviewer's five diagnostics (docs/evidence/m2-card-review-scope-review-
// 2026-10-06/card-scope-review.test.mjs) are promoted here against the
// corrected query/model; each promoted case is tagged [promoted N].
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { acknowledge, createSession, dueQueue, nextLocalMidnightUtc, PROOF_SCHEMA } from "./cardQuery.mjs";
import { apply, cardVersion, counts, createStore, generationOf, readItem } from "./contractModel.mjs";
import { DAY, MINUTE, schedule } from "./simpleScheduler.mjs";

const material = JSON.parse(readFileSync(new URL("./fixtures/synthetic-material.json", import.meta.url), "utf8"));
const M = material.materialId;
const T0 = "2026-10-06T15:00:00.000Z";
const at = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const cardsA = material.flashcards;
const cardsB = cardsA.map((card, i) => ({ ...card, back: `Synthetic regenerated ${i}` }));
const A = cardVersion(M, cardsA);
const B = cardVersion(M, cardsB);

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(PROOF_SCHEMA);
  return db;
}
function materializeRows(db, version, createdAt = T0) {
  db.prepare("INSERT INTO card_versions VALUES (?, ?, ?, ?, NULL, 0)").run(version.versionId, M, version.contentHash, createdAt);
  const insert = db.prepare("INSERT INTO card_items VALUES (?, ?, ?)");
  for (const item of version.items) insert.run(item.itemId, version.versionId, item.ordinal);
}
function stateRow(db, itemId, { step = 0, dueAt = null, suspended = 0, flag = null } = {}) {
  db.prepare("INSERT INTO card_review_state (item_id, source_material_id, step, due_at, suspended, flag) VALUES (?, ?, ?, ?, ?, ?)").run(
    itemId, M, step, dueAt, suspended, flag,
  );
}
const ids = (queue) => queue.cards.map((card) => card.itemId);

describe("[sqlite] CRS-R1 version-owned due queue with exact boundaries", () => {
  it("[promoted 1] an Again card is not returned at minute nine and is returned first at minute ten", () => {
    const db = database();
    try {
      materializeRows(db, A);
      const again = schedule(null, "again", T0);
      stateRow(db, A.items[0].itemId, { step: again.step, dueAt: again.dueAt });
      const nine = dueQueue(db, { materialId: M, current: A, nowUtc: at(T0, 9 * MINUTE), timeZone: "UTC" });
      assert.deepEqual(ids(nine), [A.items[1].itemId, A.items[2].itemId]); // only the two new cards
      const ten = dueQueue(db, { materialId: M, current: A, nowUtc: at(T0, 10 * MINUTE), timeZone: "UTC" });
      assert.deepEqual(ten.cards.map((c) => [c.itemId, c.kind]), [
        [A.items[0].itemId, "again"],
        [A.items[1].itemId, "new"],
        [A.items[2].itemId, "new"],
      ]);
    } finally {
      db.close();
    }
  });

  it("a day-ladder card due exactly at next local midnight is excluded; one millisecond earlier is included", () => {
    const db = database();
    try {
      materializeRows(db, A);
      const now = "2026-10-06T20:00:00.000Z"; // 15:00 in Chicago (UTC-5)
      const boundary = nextLocalMidnightUtc(now, "America/Chicago");
      assert.equal(boundary, "2026-10-07T05:00:00.000Z");
      stateRow(db, A.items[0].itemId, { dueAt: boundary });
      stateRow(db, A.items[1].itemId, { dueAt: at(boundary, -1) });
      stateRow(db, A.items[2].itemId, { dueAt: at(boundary, DAY) });
      const queue = dueQueue(db, { materialId: M, current: A, nowUtc: now, timeZone: "America/Chicago" });
      assert.deepEqual(ids(queue), [A.items[1].itemId]);
    } finally {
      db.close();
    }
  });

  it("[promoted 2] with old A and current materialized B both due, only B is current due work", () => {
    const db = database();
    try {
      materializeRows(db, A);
      materializeRows(db, B);
      stateRow(db, A.items[0].itemId, { dueAt: T0 });
      stateRow(db, B.items[0].itemId, { dueAt: T0 });
      const queue = dueQueue(db, { materialId: M, current: B, nowUtc: at(T0, MINUTE), timeZone: "UTC" });
      assert.deepEqual(ids(queue), B.items.map((item) => item.itemId)); // B0 due, then B1, B2 new
      assert.equal(queue.cards[0].kind, "due");
    } finally {
      db.close();
    }
  });

  it("before B's first materialization, B's cards are new and A's retained due rows are not current work", () => {
    const db = database();
    try {
      materializeRows(db, A); // the only snapshot; its stored rows look active
      db.prepare("UPDATE card_versions SET is_active = 1").run();
      for (const item of A.items) stateRow(db, item.itemId, { dueAt: T0 });
      const queue = dueQueue(db, { materialId: M, current: B, nowUtc: at(T0, MINUTE), timeZone: "UTC" });
      assert.deepEqual(queue.cards.map((c) => [c.itemId, c.kind]), B.items.map((item) => [item.itemId, "new"]));
    } finally {
      db.close();
    }
  });

  it("A -> B -> A: when the raw cards return to A, A's retained schedule is current again", () => {
    const db = database();
    try {
      materializeRows(db, A);
      materializeRows(db, B);
      stateRow(db, A.items[2].itemId, { dueAt: T0 });
      const backToA = cardVersion(M, structuredClone(cardsA));
      const queue = dueQueue(db, { materialId: M, current: backToA, nowUtc: at(T0, MINUTE), timeZone: "UTC" });
      assert.deepEqual(queue.cards[0], { itemId: A.items[2].itemId, kind: "due", dueAt: T0, ordinal: 2 });
    } finally {
      db.close();
    }
  });

  it("never-rated suspended and flagged cards are excluded from new work before the caps", () => {
    const db = database();
    try {
      materializeRows(db, B);
      stateRow(db, B.items[0].itemId, { step: -1, suspended: 1 });
      stateRow(db, B.items[1].itemId, { step: -1, flag: "unclear" });
      const queue = dueQueue(db, { materialId: M, current: B, nowUtc: T0, timeZone: "UTC", maxNew: 1 });
      assert.deepEqual(ids(queue), [B.items[2].itemId]);
    } finally {
      db.close();
    }
  });

  it("order and limits apply after eligibility, even behind many ineligible older rows", () => {
    const db = database();
    try {
      // 200 old-version rows due long ago would fill any LIMIT taken before filtering.
      const old = cardVersion(M, Array.from({ length: 200 }, (_, i) => ({ front: `Old ${i}`, back: "Old", sourcePage: null })));
      materializeRows(db, old);
      old.items.forEach((item) => stateRow(db, item.itemId, { dueAt: "2026-01-01T00:00:00.000Z" }));
      const current = cardVersion(M, Array.from({ length: 30 }, (_, i) => ({ front: `Current ${i}`, back: "Now", sourcePage: null })));
      materializeRows(db, current);
      const it_ = current.items;
      const now = T0;
      // Eligible Again (exact instant passed), out of ordinal order by due instant.
      stateRow(db, it_[5].itemId, { step: -1, dueAt: at(now, -2 * MINUTE) });
      stateRow(db, it_[4].itemId, { step: -1, dueAt: at(now, -5 * MINUTE) });
      // Again not yet eligible.
      stateRow(db, it_[6].itemId, { step: -1, dueAt: at(now, 5 * MINUTE) });
      // Twelve day-ladder due cards; two share a due instant (tie -> ordinal).
      for (let k = 0; k < 12; k++) stateRow(db, it_[7 + k].itemId, { dueAt: at(now, -(12 - k) * DAY) });
      db.prepare("UPDATE card_review_state SET due_at = ? WHERE item_id IN (?, ?)").run(at(now, -3 * DAY), it_[17].itemId, it_[16].itemId);
      // Excluded despite being due.
      stateRow(db, it_[19].itemId, { dueAt: at(now, -DAY), suspended: 1 });
      stateRow(db, it_[20].itemId, { dueAt: at(now, -DAY), flag: "wrong_answer" });
      const queue = dueQueue(db, { materialId: M, current, nowUtc: now, timeZone: "UTC" });
      const kinds = queue.cards.map((c) => c.kind);
      assert.equal(queue.cards.length, 20);
      assert.deepEqual(kinds.slice(0, 2), ["again", "again"]);
      assert.deepEqual(ids(queue).slice(0, 2), [it_[4].itemId, it_[5].itemId]); // by due instant
      assert.equal(kinds.filter((k) => k === "due").length, 12);
      assert.equal(kinds.filter((k) => k === "new").length, 6); // min(10, 20 - 14)
      const dueOrdinals = queue.cards.filter((c) => c.kind === "due").map((c) => c.ordinal);
      assert.deepEqual(dueOrdinals.slice(-3), [16, 17, 18]); // tie at -3 days broken by ordinal, then -1 day
      assert.deepEqual(queue.cards.filter((c) => c.kind === "new").map((c) => c.ordinal), [0, 1, 2, 3, 21, 22]);
      assert.ok(!ids(queue).some((id) => old.items.some((item) => item.itemId === id)));
      assert.ok(![6, 19, 20].some((n) => ids(queue).includes(it_[n].itemId)));
    } finally {
      db.close();
    }
  });

  it("daylight saving: the 25-hour local day in Chicago (1 November 2026) gets the exact exclusive boundary", () => {
    const db = database();
    try {
      materializeRows(db, A);
      assert.equal(nextLocalMidnightUtc("2026-10-31T17:00:00.000Z", "America/Chicago"), "2026-11-01T05:00:00.000Z"); // CDT
      const now = "2026-11-01T17:00:00.000Z"; // 11:00 CST, after fall-back
      const boundary = nextLocalMidnightUtc(now, "America/Chicago");
      assert.equal(boundary, "2026-11-02T06:00:00.000Z"); // CST midnight, 25 h after the previous one
      stateRow(db, A.items[0].itemId, { dueAt: "2026-11-02T05:30:00.000Z" }); // 23:30 CST on 1 November
      stateRow(db, A.items[1].itemId, { dueAt: boundary });
      assert.deepEqual(ids(dueQueue(db, { materialId: M, current: A, nowUtc: now, timeZone: "America/Chicago", maxNew: 0 })), [A.items[0].itemId]);
    } finally {
      db.close();
    }
  });

  it("session membership counts unique presented cards; a replayed acknowledgement does not advance twice", () => {
    const session = createSession({ cards: A.items.map((item) => ({ itemId: item.itemId })) });
    const result = { itemId: A.items[0].itemId };
    acknowledge(session, result);
    acknowledge(session, result); // same-ID replay of the same acknowledgement
    assert.deepEqual([session.completed.size, session.position], [1, 1]);
    acknowledge(session, { itemId: A.items[2].itemId }); // not the card being shown
    assert.equal(session.position, 1);
  });
});

describe("[model] CRS-R2 persistent reset generation", () => {
  const RESET = (id, expectedGeneration, materialId = M) => ({ action: "reset", operationId: id, materialId, expectedGeneration });
  const item = (action, id, { itemId = A.items[0].itemId, expectedRevision = 0, expectedGeneration = 0, version = A, materialId = M, extra = {} } = {}) => ({
    action, operationId: id, materialId, versionContentHash: version.contentHash, itemId, expectedGeneration, expectedRevision, ...extra,
  });
  const rate = (id, options = {}) => item("rate", id, { ...options, extra: { rating: "good" } });
  const fresh = () => createStore({ [M]: cardsA, other: cardsA });

  it("[promoted 3] an uncommitted pre-reset revision-0 rating is refused after reset, with nothing written", () => {
    const store = fresh();
    const captured = rate("b1000000-0000-4000-8000-000000000001", { expectedGeneration: generationOf(store, M) });
    apply(store, RESET("b1000000-0000-4000-8000-0000000000f1", 0), T0);
    const before = counts(store);
    assert.throws(() => apply(store, captured, at(T0, MINUTE)), (e) => e.code === "STALE_GENERATION");
    assert.deepEqual(counts(store), before);
  });

  it("[promoted 4] a pre-reset revision-1 request stays refused after a new-generation rating reaches revision 1", () => {
    const store = fresh();
    apply(store, rate("b1000000-0000-4000-8000-000000000002"), T0);
    const captured = rate("b1000000-0000-4000-8000-000000000003", { expectedRevision: 1, expectedGeneration: 0 });
    apply(store, RESET("b1000000-0000-4000-8000-0000000000f2", 0), at(T0, MINUTE));
    apply(store, rate("b1000000-0000-4000-8000-000000000004", { expectedGeneration: 1 }), at(T0, 2 * MINUTE));
    assert.equal(readItem(store, A.items[0].itemId).revision, 1);
    const before = counts(store);
    assert.throws(() => apply(store, captured, at(T0, 3 * MINUTE)), (e) => e.code === "STALE_GENERATION");
    assert.deepEqual(counts(store), before);
  });

  it("[promoted 5] repeated resets succeed; already tombstoned receipts are skipped safely and keep routing metadata", () => {
    const store = fresh();
    apply(store, rate("b1000000-0000-4000-8000-000000000005"), T0);
    apply(store, RESET("b1000000-0000-4000-8000-0000000000f3", 0), at(T0, MINUTE));
    assert.doesNotThrow(() => apply(store, RESET("b1000000-0000-4000-8000-0000000000f4", 1), at(T0, 2 * MINUTE)));
    assert.equal(generationOf(store, M), 2);
    const tomb = store.receipts.get("b1000000-0000-4000-8000-000000000005");
    assert.deepEqual(
      { erased: tomb.erased, result: tomb.result, materialId: tomb.materialId, generation: tomb.generation, action: tomb.action, hashed: /^[0-9a-f]{64}$/.test(tomb.requestHash) },
      { erased: true, result: null, materialId: M, generation: 0, action: "rate", hashed: true },
    );
    // The first reset was itself tombstoned by the second: replay is refused, nothing advances.
    assert.throws(() => apply(store, RESET("b1000000-0000-4000-8000-0000000000f3", 0), at(T0, 3 * MINUTE)), (e) => e.code === "OPERATION_ERASED");
    assert.equal(generationOf(store, M), 2);
  });

  it("an identical committed-reset replay after new work returns its stored result and erases nothing", () => {
    const store = fresh();
    const reset = RESET("b1000000-0000-4000-8000-0000000000f5", 0);
    const first = apply(store, reset, T0);
    apply(store, rate("b1000000-0000-4000-8000-000000000006", { expectedGeneration: 1 }), at(T0, MINUTE));
    const before = counts(store);
    assert.deepEqual(apply(store, reset, at(T0, 2 * MINUTE)), first);
    assert.deepEqual(counts(store), before);
    assert.equal(generationOf(store, M), 1);
    assert.equal(readItem(store, A.items[0].itemId).revision, 1);
  });

  it("reusing a reset operation ID with a changed payload conflicts; a stale-generation reset is refused", () => {
    const store = fresh();
    apply(store, RESET("b1000000-0000-4000-8000-0000000000f6", 0), T0);
    const before = counts(store);
    assert.throws(() => apply(store, RESET("b1000000-0000-4000-8000-0000000000f6", 1), T0), (e) => e.code === "OPERATION_CONFLICT");
    assert.throws(() => apply(store, RESET("b1000000-0000-4000-8000-0000000000f7", 0), T0), (e) => e.code === "STALE_GENERATION");
    assert.deepEqual(counts(store), before);
  });

  it("fresh work after refresh with the current generation is accepted, and a new intentional reset applies again", () => {
    const store = fresh();
    apply(store, RESET("b1000000-0000-4000-8000-0000000000f8", 0), T0);
    const generation = generationOf(store, M);
    apply(store, rate("b1000000-0000-4000-8000-000000000007", { expectedGeneration: generation }), at(T0, MINUTE));
    assert.equal(store.events.length, 1);
    apply(store, RESET("b1000000-0000-4000-8000-0000000000f9", generation), at(T0, 2 * MINUTE));
    assert.deepEqual([generationOf(store, M), store.events.length], [2, 0]);
  });

  it("reset touches only its material: another material's state, events, receipts and generation remain", () => {
    const store = fresh();
    const other = cardVersion("other", cardsA);
    apply(store, rate("b1000000-0000-4000-8000-000000000008", { materialId: "other", version: other, itemId: other.items[0].itemId }), T0);
    apply(store, rate("b1000000-0000-4000-8000-000000000009"), T0);
    apply(store, RESET("b1000000-0000-4000-8000-0000000000fa", 0), at(T0, MINUTE));
    assert.equal(readItem(store, other.items[0].itemId).revision, 1);
    assert.equal(store.events.filter((e) => e.materialId === "other").length, 1);
    assert.equal(store.receipts.get("b1000000-0000-4000-8000-000000000008").erased, false);
    assert.equal(generationOf(store, "other"), 0);
  });

  it("reset is strictly typed: item fields on a reset, or a missing generation on an item action, are invalid", () => {
    const store = fresh();
    assert.throws(() => apply(store, { ...RESET("b1000000-0000-4000-8000-0000000000fb", 0), itemId: A.items[0].itemId }, T0), (e) => e.code === "INVALID_ARGUMENT");
    const { expectedGeneration, ...missing } = rate("b1000000-0000-4000-8000-00000000000a");
    void expectedGeneration;
    assert.throws(() => apply(store, missing, T0), (e) => e.code === "INVALID_ARGUMENT");
    assert.deepEqual(counts(store), { states: 0, events: 0, receipts: 0 });
  });

  it("reset keeps the snapshot of the current raw cards and prunes retained older versions", () => {
    const store = fresh();
    apply(store, rate("b1000000-0000-4000-8000-00000000000b"), T0);
    store.rawCards.set(M, cardsB); // regenerated
    apply(store, rate("b1000000-0000-4000-8000-00000000000c", { version: B, itemId: B.items[0].itemId }), at(T0, MINUTE));
    apply(store, RESET("b1000000-0000-4000-8000-0000000000fc", 0), at(T0, 2 * MINUTE));
    const remaining = [...store.versions.entries()].filter(([, v]) => v.materialId === M).map(([id, v]) => [id, v.firstReviewedAt]);
    assert.deepEqual(remaining, [[B.versionId, null]]);
    assert.equal([...store.state.values()].filter((v) => v.materialId === M).length, 0);
  });
});

describe("[model] handoff details", () => {
  it("first suspend works on a never-rated card: the snapshot is created without a review time or fabricated event", () => {
    const store = createStore({ [M]: cardsA });
    const base = { materialId: M, versionContentHash: A.contentHash, itemId: A.items[1].itemId, expectedGeneration: 0 };
    const result = apply(store, { ...base, action: "suspend", operationId: "c1000000-0000-4000-8000-000000000001", expectedRevision: 0 }, T0);
    assert.deepEqual([result.dueAt, result.reviewedAt, result.suspended], [null, null, true]);
    assert.deepEqual(store.versions.get(A.versionId), { materialId: M, contentHash: A.contentHash, itemIds: A.items.map((i) => i.itemId), createdAt: T0, firstReviewedAt: null });
    assert.equal(store.events.length, 0);
    apply(store, { ...base, action: "resume", operationId: "c1000000-0000-4000-8000-000000000002", expectedRevision: 1 }, at(T0, MINUTE));
    apply(store, { ...base, action: "rate", operationId: "c1000000-0000-4000-8000-000000000003", expectedRevision: 2, rating: "easy" }, at(T0, 2 * MINUTE));
    assert.equal(store.versions.get(A.versionId).createdAt, T0);
    assert.equal(store.versions.get(A.versionId).firstReviewedAt, at(T0, 2 * MINUTE));
  });

  it("a flagged card refuses ratings until unflagged, without changing its schedule", () => {
    const store = createStore({ [M]: cardsA });
    const base = { materialId: M, versionContentHash: A.contentHash, itemId: A.items[0].itemId, expectedGeneration: 0 };
    apply(store, { ...base, action: "rate", operationId: "c1000000-0000-4000-8000-000000000004", expectedRevision: 0, rating: "good" }, T0);
    const scheduled = readItem(store, base.itemId).schedule;
    apply(store, { ...base, action: "flag", operationId: "c1000000-0000-4000-8000-000000000005", expectedRevision: 1, reason: "not_in_source" }, T0);
    assert.throws(() => apply(store, { ...base, action: "rate", operationId: "c1000000-0000-4000-8000-000000000006", expectedRevision: 2, rating: "good" }, at(T0, DAY)), (e) => e.code === "CARD_FLAGGED");
    apply(store, { ...base, action: "unflag", operationId: "c1000000-0000-4000-8000-000000000007", expectedRevision: 2 }, at(T0, DAY));
    assert.deepEqual(readItem(store, base.itemId).schedule, scheduled);
  });

  it("an item action against changed raw cards is refused as stale content", () => {
    const store = createStore({ [M]: cardsA });
    store.rawCards.set(M, cardsB);
    assert.throws(
      () => apply(store, { action: "rate", operationId: "c1000000-0000-4000-8000-000000000008", materialId: M, versionContentHash: A.contentHash, itemId: A.items[0].itemId, expectedGeneration: 0, expectedRevision: 0, rating: "good" }, T0),
      (e) => e.code === "STALE_CONTENT",
    );
    assert.deepEqual(counts(store), { states: 0, events: 0, receipts: 0 });
  });
});
