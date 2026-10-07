// M2-3 card review scheduler proof (research only; not application code).
//
// Labels: [pure] = scheduler arithmetic; [model] = in-memory contract
// simulation; [fsrs] = observed behavior of the pinned ts-fsrs 5.4.2 package.
// None of these establishes native atomic writes, browser persistence or
// installed-app behavior.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createEmptyCard, fsrs, generatorParameters, Rating, State } from "ts-fsrs";

import { apply, cardVersion, ContractRefusal, createStore, dueItems, erase } from "./contractModel.mjs";
import {
  DAY,
  isDue,
  LADDER_DAYS,
  localDate,
  MINUTE,
  schedule,
  SchedulerRefusal,
} from "./simpleScheduler.mjs";

const material = JSON.parse(readFileSync(new URL("./fixtures/synthetic-material.json", import.meta.url), "utf8"));
const T0 = "2026-10-06T15:00:00.000Z";
const at = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const gap = (fromIso, toIso) => Date.parse(toIso) - Date.parse(fromIso);

describe("[pure] simple-v1 scheduler", () => {
  it("first exposure: Again 10 minutes; Hard and Good 1 day; Easy 3 days", () => {
    const delays = Object.fromEntries(["again", "hard", "good", "easy"].map((r) => [r, gap(T0, schedule(null, r, T0).dueAt)]));
    assert.deepEqual(delays, { again: 10 * MINUTE, hard: 1 * DAY, good: 1 * DAY, easy: 3 * DAY });
  });

  it("intervals are bounded: nonzero minimum, and repeated Easy never passes 180 days", () => {
    let state = null;
    let now = T0;
    const seen = [];
    for (let i = 0; i < 12; i++) {
      state = schedule(state, "easy", now);
      seen.push(gap(now, state.dueAt));
      now = state.dueAt;
    }
    assert.equal(Math.max(...seen), 180 * DAY);
    assert.equal(seen.at(-1), 180 * DAY);
    assert.ok(Math.min(...seen) > 0);
  });

  it("repeat failure: Again on a ladder card counts one lapse, a second Again does not count again", () => {
    let state = schedule(null, "good", T0); // step 0
    state = schedule(state, "good", state.dueAt); // step 1
    const failedAt = state.dueAt;
    state = schedule(state, "again", failedAt);
    assert.deepEqual([state.step, state.lapses, gap(failedAt, state.dueAt)], [-1, 1, 10 * MINUTE]);
    state = schedule(state, "again", state.dueAt);
    assert.deepEqual([state.step, state.lapses], [-1, 1]);
    const back = state.dueAt;
    state = schedule(state, "good", back);
    assert.deepEqual([state.step, gap(back, state.dueAt)], [0, LADDER_DAYS[0] * DAY]);
  });

  it("overdue: a card reviewed 20 days late moves one rung, counted from the review time", () => {
    let state = schedule(schedule(null, "good", T0), "good", at(T0, DAY)); // step 1, due +3 days
    const late = at(state.dueAt, 20 * DAY);
    state = schedule(state, "good", late);
    assert.deepEqual([state.step, gap(late, state.dueAt)], [2, LADDER_DAYS[2] * DAY]);
  });

  it("clock rollback: a review earlier than the last saved review is refused", () => {
    const state = schedule(null, "good", T0);
    assert.throws(() => schedule(state, "good", at(T0, -MINUTE)), (e) => e instanceof SchedulerRefusal && e.code === "CLOCK_BEHIND_LAST_REVIEW");
    // Same instant is not a rollback.
    assert.doesNotThrow(() => schedule(state, "good", T0));
  });

  it("deterministic: identical prior state, rating and time give identical, serializable output", () => {
    const prior = schedule(null, "good", T0);
    const runs = [1, 2, 3].map(() => schedule(JSON.parse(JSON.stringify(prior)), "hard", at(T0, 2 * DAY)));
    assert.deepEqual(runs[0], runs[1]);
    assert.deepEqual(runs[1], runs[2]);
    assert.deepEqual(JSON.parse(JSON.stringify(runs[0])), runs[0]);
  });

  it("refuses state from an unknown scheduler version instead of guessing", () => {
    assert.throws(() => schedule({ schedulerVersion: "fsrs-6", step: 0, reps: 1, lapses: 0, lastReviewedAt: T0, dueAt: T0 }, "good", at(T0, DAY)), (e) => e.code === "UNSUPPORTED_SCHEDULER_VERSION");
  });
});

describe("[pure] stored instants versus local calendar display", () => {
  // 23:50 on 6 October in Chicago (UTC-5 in October) is 04:50Z on 7 October.
  const lateEvening = "2026-10-07T04:50:00.000Z";

  it("local midnight: a 1-day card reviewed late evening is due all of the next local day, not before", () => {
    const state = schedule(null, "good", lateEvening);
    assert.equal(state.dueAt, "2026-10-08T04:50:00.000Z"); // absolute instant, exactly 24 h later
    assert.equal(localDate(state.dueAt, "America/Chicago"), "2026-10-07");
    assert.equal(isDue(state, "2026-10-07T04:59:00.000Z", "America/Chicago"), false); // 23:59 same evening
    assert.equal(isDue(state, "2026-10-07T13:00:00.000Z", "America/Chicago"), true); // 08:00 next morning
  });

  it("time zone change: the same stored instant is judged by the zone the computer is in now; nothing is rewritten", () => {
    const state = schedule(null, "good", lateEvening);
    const stored = JSON.stringify(state);
    const now = "2026-10-07T13:00:00.000Z";
    assert.equal(isDue(state, now, "America/Chicago"), true); // local 7 Oct, due 7 Oct
    assert.equal(isDue(state, now, "Asia/Tokyo"), false); // local 7 Oct 22:00, due 8 Oct 13:50
    assert.equal(JSON.stringify(state), stored);
  });

  it("a card waiting after Again is not due until its exact instant, even on the same local day", () => {
    const state = schedule(null, "again", T0);
    assert.equal(isDue(state, at(T0, 9 * MINUTE), "America/Chicago"), false);
    assert.equal(isDue(state, at(T0, 10 * MINUTE), "America/Chicago"), true);
  });
});

describe("[model] content-addressed card identity", () => {
  it("is stable across calls and gives each of the three synthetic cards a distinct item ID", () => {
    const a = cardVersion(material.materialId, material.flashcards);
    const b = cardVersion(material.materialId, structuredClone(material.flashcards));
    assert.deepEqual(a, b);
    assert.equal(new Set(a.items.map((item) => item.itemId)).size, 3);
  });

  it("changing one card's text creates a new version whose items share no ID with the old one", () => {
    const old = cardVersion(material.materialId, material.flashcards);
    const edited = structuredClone(material.flashcards);
    edited[1].back = "Synthetic replacement";
    const replacement = cardVersion(material.materialId, edited);
    assert.notEqual(replacement.versionId, old.versionId);
    assert.equal(replacement.items.filter((item) => old.items.some((o) => o.itemId === item.itemId)).length, 0);
  });

  it("reordering creates a new version; A -> B -> A returns to the original version and history", () => {
    const original = cardVersion(material.materialId, material.flashcards);
    const reordered = cardVersion(material.materialId, [...material.flashcards].reverse());
    assert.notEqual(reordered.versionId, original.versionId);
    assert.equal(cardVersion(material.materialId, material.flashcards).versionId, original.versionId);
  });

  it("matches the golden vectors computed independently in Python (fixtures/identity-golden.json)", () => {
    const golden = JSON.parse(readFileSync(new URL("./fixtures/identity-golden.json", import.meta.url), "utf8"));
    const version = cardVersion(material.materialId, material.flashcards);
    assert.deepEqual(
      { contentHash: version.contentHash, versionId: version.versionId, itemIds: version.items.map((item) => item.itemId) },
      { contentHash: golden.contentHash, versionId: golden.versionId, itemIds: golden.itemIds },
    );
  });

  it("the same cards under another material are a different version", () => {
    assert.notEqual(cardVersion("other-material", material.flashcards).versionId, cardVersion(material.materialId, material.flashcards).versionId);
  });
});

describe("[model] operation contract at the proposed boundary", () => {
  const [first] = cardVersion(material.materialId, material.flashcards).items;
  const rate = (id, rating, expectedRevision = 0) => ({ action: "rate", operationId: id, itemId: first.itemId, rating, expectedRevision });

  it("same operation ID and payload applies once and replays the stored result", () => {
    const store = createStore();
    const once = apply(store, rate("a1000000-0000-4000-8000-000000000001", "good"), T0);
    const replay = apply(store, rate("a1000000-0000-4000-8000-000000000001", "good"), at(T0, 5 * MINUTE));
    assert.deepEqual(replay, once);
    assert.equal(store.events.length, 1);
    assert.equal(store.state.get(first.itemId).revision, 1);
  });

  it("reusing an operation ID with a changed payload conflicts without writing", () => {
    const store = createStore();
    apply(store, rate("a1000000-0000-4000-8000-000000000002", "good"), T0);
    assert.throws(() => apply(store, rate("a1000000-0000-4000-8000-000000000002", "easy"), T0), (e) => e.code === "OPERATION_CONFLICT");
    assert.equal(store.events.length, 1);
  });

  it("a stale expected revision is refused; a new deliberate action with the current revision applies", () => {
    const store = createStore();
    apply(store, rate("a1000000-0000-4000-8000-000000000003", "good", 0), T0);
    assert.throws(() => apply(store, rate("a1000000-0000-4000-8000-000000000004", "again", 0), at(T0, DAY)), (e) => e.code === "STALE_REVISION");
    assert.equal(store.events.length, 1);
    apply(store, rate("a1000000-0000-4000-8000-000000000005", "again", 1), at(T0, DAY));
    assert.equal(store.events.length, 2);
  });

  it("suspension removes a card from due work, refuses ratings and keeps history; resumption restores it", () => {
    const store = createStore();
    apply(store, rate("a1000000-0000-4000-8000-000000000006", "good"), T0);
    const due = (s) => isDue(s, at(T0, 2 * DAY), "UTC");
    assert.deepEqual(dueItems(store, due), [first.itemId]);
    apply(store, { action: "suspend", operationId: "a1000000-0000-4000-8000-000000000007", itemId: first.itemId, expectedRevision: 1 }, at(T0, DAY));
    assert.deepEqual(dueItems(store, due), []);
    assert.throws(() => apply(store, rate("a1000000-0000-4000-8000-000000000008", "good", 2), at(T0, 2 * DAY)), (e) => e.code === "CARD_SUSPENDED");
    assert.equal(store.events.length, 1);
    apply(store, { action: "resume", operationId: "a1000000-0000-4000-8000-000000000009", itemId: first.itemId, expectedRevision: 2 }, at(T0, 2 * DAY));
    assert.deepEqual(dueItems(store, due), [first.itemId]);
  });

  it("explicit erasure leaves non-content tombstones, so a late replay cannot restore erased state", () => {
    const store = createStore();
    const op = rate("a1000000-0000-4000-8000-00000000000a", "good");
    apply(store, op, T0);
    erase(store, [first.itemId]);
    assert.throws(() => apply(store, op, at(T0, MINUTE)), (e) => e.code === "OPERATION_ERASED");
    assert.equal(store.state.has(first.itemId), false);
    assert.equal(store.events.length, 0);
  });

  it("a rating whose clock is behind the last review is refused without an event", () => {
    const store = createStore();
    apply(store, rate("a1000000-0000-4000-8000-00000000000b", "good"), T0);
    assert.throws(() => apply(store, rate("a1000000-0000-4000-8000-00000000000c", "good", 1), at(T0, -DAY)), (e) => e instanceof ContractRefusal && e.code === "CLOCK_BEHIND_LAST_REVIEW");
    assert.equal(store.events.length, 1);
    assert.equal(store.state.get(first.itemId).revision, 1);
  });
});

describe("[fsrs] pinned ts-fsrs 5.4.2 behavior with injected time", () => {
  const params = generatorParameters({ enable_fuzz: false, maximum_interval: 180 });
  const f = fsrs(params);
  const t0 = new Date(T0);

  it("first exposure uses minute learning steps: Again 1, Hard 6, Good 10 minutes; Easy goes straight to review", () => {
    const card = createEmptyCard(t0);
    const outcome = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((r) => {
      const next = f.next(card, t0, r).card;
      return [State[next.state], (next.due - t0) / MINUTE];
    });
    assert.deepEqual(outcome.slice(0, 3), [["Learning", 1], ["Learning", 6], ["Learning", 10]]);
    assert.equal(outcome[3][0], "Review");
    assert.ok(outcome[3][1] >= DAY / MINUTE);
  });

  it("is deterministic with fuzz off, and its parameters round-trip through JSON", () => {
    const card = createEmptyCard(t0);
    assert.deepEqual(f.next(card, t0, Rating.Good), f.next(card, t0, Rating.Good));
    const restored = fsrs(JSON.parse(JSON.stringify(params)));
    assert.deepEqual(restored.next(card, t0, Rating.Easy).card, f.next(card, t0, Rating.Easy).card);
  });

  it("maximum_interval is not a hard ceiling: ordering rules push repeated Easy past the configured 180 days", () => {
    let card = f.next(createEmptyCard(t0), t0, Rating.Easy).card;
    let longest = 0;
    for (let i = 0; i < 12; i++) {
      card = f.next(card, card.due, Rating.Easy).card;
      longest = Math.max(longest, card.scheduled_days);
    }
    // Observed 182: clamp to 180, then good = max(good, hard+1), easy = max(easy, good+1).
    assert.ok(longest > 180, `longest interval ${longest}`);
  });

  it("rewards an overdue successful review with a longer interval than an on-time one", () => {
    const review = f.next(f.next(createEmptyCard(t0), t0, Rating.Good).card, new Date(t0.getTime() + 10 * MINUTE), Rating.Good).card;
    const onTime = f.next(review, review.due, Rating.Good).card.scheduled_days;
    const late = f.next(review, new Date(review.due.getTime() + 20 * DAY), Rating.Good).card.scheduled_days;
    assert.ok(late > onTime, `on time ${onTime}, late ${late}`);
  });

  it("throws on a clock earlier than the last review rather than scheduling", () => {
    const review = f.next(createEmptyCard(t0), t0, Rating.Easy).card;
    assert.throws(() => f.next(review, new Date(review.last_review.getTime() - DAY), Rating.Good), /Invalid delta_t/);
  });

  it("with fuzz on, an identical card and review time reproduce the same interval (seeded, not Math.random)", () => {
    const fuzzed = fsrs(generatorParameters({ enable_fuzz: true, maximum_interval: 180 }));
    const review = f.next(f.next(createEmptyCard(t0), t0, Rating.Good).card, new Date(t0.getTime() + 10 * MINUTE), Rating.Good).card;
    const runs = [1, 2, 3].map(() => fuzzed.next(review, review.due, Rating.Good).card.scheduled_days);
    assert.equal(new Set(runs).size, 1);
  });
});
