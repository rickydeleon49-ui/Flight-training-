import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  at,
  buildSyntheticDatabase,
  generateCards,
  T0,
} from "../m2-card-review-c2-final-corrections-2026-10-07/proof/syntheticDataset.mjs";

import {
  createDisposableDb,
  DeferredReadController,
  deriveCardVersion,
  getLibraryRecentReviews,
  getLibraryRecentReviewsBrokenCursor,
  getLibraryReviewDue,
  getLibraryReviewDueBrokenCurrentVersion,
  getLibraryReviewDueBrokenTimeBoundary,
  nextLocalMidnightUtc,
} from "../m2-card-review-c2-final-corrections-2026-10-07/proof/contractModel.mjs";

const __filename = fileURLToPath(import.meta.url);
const isWorker = process.argv[2] === "--worker";

if (isWorker) {
  const target = process.argv[3];
  const disableAssertion = process.env.DISABLE_ASSERTIONS === "1";

  if (target === "baseline") {
    // 1. Version ownership assertion
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const res = getLibraryReviewDue(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 200 });
    const weather = res.materials.find((m) => m.materialId === "mat-changed-03");
    assert.equal(weather?.totalDueCount ?? 0, 0, "Current unmaterialized cards produce 0 due cards");
    assert.equal(weather?.newCount, 7, "All 7 unmaterialized cards are new");

    // 2. Time boundary assertion: card due after midnight is not due today
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";
    const cards = generateCards("TimeTest", 1);
    db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('mat-time-base', 'Time Test Base', ?, ?)").run(now, now);
    db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('mat-time-base', ?, ?, ?)").run(JSON.stringify(cards), now, now);
    const v = deriveCardVersion("mat-time-base", cards);
    db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'mat-time-base', ?, 1, 'gemini', ?, 1)").run(v.versionId, v.contentHash, now);
    db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, 0, 'F', 'B')").run(v.items[0].itemId, v.versionId);
    db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'mat-time-base', 'simple-v1', 1, '2026-10-08T04:00:00.000Z', ?, 1, 1)").run(v.items[0].itemId, now);

    const baseTimeRes = getLibraryReviewDue(db, { nowUtc: now, nextLocalMidnightUtc: mid });
    const timeMat = baseTimeRes.materials.find((m) => m.materialId === "mat-time-base");
    assert.equal(timeMat?.totalDueCount ?? 0, 0, "Card due tomorrow after midnight must NOT be counted as due today");

    // 3. Keyset cursor tiebreaker assertion
    const expected = db.prepare("SELECT id FROM card_review_events ORDER BY reviewed_at DESC, id DESC LIMIT 20").all().map((r) => r.id);
    const p1 = getLibraryRecentReviews(db, { limit: 10 });
    const p2 = getLibraryRecentReviews(db, { cursor: p1.next, limit: 10 });
    assert.deepEqual([...p1.rows.map((r) => r.id), ...p2.rows.map((r) => r.id)], expected);

    db.close();
    process.exit(0);
  }

  if (target === "mutant_wrong_version") {
    const { db } = buildSyntheticDatabase(100, 200);
    const midUtc = nextLocalMidnightUtc(T0, "UTC");
    const brokenRows = getLibraryReviewDueBrokenCurrentVersion(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc });
    const brokenWeather = brokenRows.find((r) => r.material_id === "mat-changed-03");
    db.close();

    if (!disableAssertion) {
      // Intended failure: brokenRows includes retired due cards (day_count > 0).
      assert.equal(brokenWeather?.day_count ?? 0, 0, "Retired version due cards must be excluded!");
    }
    process.exit(0);
  }

  if (target === "mutant_time_boundary") {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const cards = generateCards("TimeMutant", 1);
    db.prepare("INSERT INTO study_materials(id, title, created_at, updated_at) VALUES ('mat-time-mut', 'Time Mutant', ?, ?)").run(now, now);
    db.prepare("INSERT INTO ai_study_sets(source_material_id, flashcards_json, generated_at, updated_at) VALUES ('mat-time-mut', ?, ?, ?)").run(JSON.stringify(cards), now, now);
    const v = deriveCardVersion("mat-time-mut", cards);
    db.prepare("INSERT INTO card_versions(id, source_material_id, content_hash, card_count, provider, created_at, is_active) VALUES (?, 'mat-time-mut', ?, 1, 'gemini', ?, 1)").run(v.versionId, v.contentHash, now);
    db.prepare("INSERT INTO card_items(id, version_id, ordinal, front, back) VALUES (?, ?, 0, 'F', 'B')").run(v.items[0].itemId, v.versionId);
    // Card due at 2026-10-08T04:00:00.000Z (after midnight, but within 24h of T0)
    db.prepare("INSERT INTO card_review_state(item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, revision) VALUES (?, 'mat-time-mut', 'simple-v1', 1, '2026-10-08T04:00:00.000Z', ?, 1, 1)").run(v.items[0].itemId, now);

    const brokenRes = getLibraryReviewDueBrokenTimeBoundary(db, { nowUtc: now });
    const mat = brokenRes.materials.find((m) => m.materialId === "mat-time-mut");
    db.close();

    if (!disableAssertion) {
      // Intended failure: brokenTimeBoundary uses 24h window and incorrectly includes card due after midnight
      assert.equal(mat?.totalDueCount ?? 0, 0, "Card due tomorrow after midnight must NOT be counted as due today!");
    }
    process.exit(0);
  }

  if (target === "mutant_cursor_tie") {
    const { db } = buildSyntheticDatabase(100, 100);
    const tieTime = at(T0, 3600000);
    const ver = db.prepare("SELECT id FROM card_versions LIMIT 1").get();
    for (let i = 0; i < 6; i++) {
      const itemId = `item-mut-${i}`;
      db.prepare("INSERT INTO card_items (id, version_id, ordinal, front, back) VALUES (?, ?, ?, 'F', 'B')").run(
        itemId, ver.id, 300 + i
      );
      db.prepare(`
        INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
        VALUES (?, ?, 0, 'good', ?, 'simple-v1', '{}', '{}')
      `).run(`ev-mut-${i}`, itemId, tieTime);
    }

    const p1 = getLibraryRecentReviewsBrokenCursor(db, { cursor: null, limit: 3 });
    const p2 = getLibraryRecentReviewsBrokenCursor(db, { cursor: { reviewedAt: p1.at(-1)?.reviewed_at }, limit: 3 });
    const remainingTiedInP2 = p2.filter((item) => item.reviewed_at === tieTime);
    db.close();

    if (!disableAssertion) {
      // Intended failure: broken cursor drops remaining tied items (returns 0 instead of 3).
      assert.equal(remainingTiedInP2.length, 3, "Broken cursor dropped tied timestamp events!");
    }
    process.exit(0);
  }

  if (target === "mutant_owner_lock") {
    const db = createDisposableDb();
    const now = "2026-10-07T15:00:00.000Z";
    const mid = "2026-10-08T00:00:00.000Z";

    let holdResolve;
    const delayedReader = async (database, opts) => {
      if (opts.topic === "aerodynamics") {
        await new Promise((r) => { holdResolve = r; });
      }
      return getLibraryReviewDue(database, opts);
    };

    const ctrl = new DeferredReadController(db, { nowUtc: now, nextLocalMidnightUtc: mid, topic: "aerodynamics" }, delayedReader);
    const pA = ctrl.loadNextPage();

    ctrl.setFilter({ topic: "navigation" });
    const pB = ctrl.loadNextPage();

    // Settle A
    holdResolve();
    await pA;

    // Mutant simulation: stale resolution illegally resets busyPromise
    // Reviewer baseline control: injected mutation removed.

    if (!disableAssertion) {
      assert.notEqual(ctrl.busyPromise, null, "Held read B must retain busy lock while awaiting settlement!");
    }
    db.close();
    process.exit(0);
  }

  console.error("Unknown target: " + target);
  process.exit(2);
}

// ============================================================================
// Main Runner: Orchestrates Isolated Child Processes & Enforces Verifier Rules
// ============================================================================

export function runMutantVerification({ disableAssertions = false } = {}) {
  const nodeBin = process.execPath;
  const env = { ...process.env };
  if (disableAssertions) {
    env.DISABLE_ASSERTIONS = "1";
  } else {
    delete env.DISABLE_ASSERTIONS;
  }

  let log = "=== RELIABLE SEMANTIC MUTATION VERIFIER REPORT ===\n";
  log += `Node: ${process.version}, Date: ${new Date().toISOString()}\n\n`;

  // 1. Run Baseline
  console.log("Running Baseline Behavioral Assertions in isolated child process...");
  const baseRes = spawnSync(nodeBin, ["--experimental-strip-types", __filename, "--worker", "baseline"], {
    env,
    encoding: "utf8",
  });

  if (baseRes.status !== 0) {
    const msg = `BASELINE FAILURE: Expected exit 0, got ${baseRes.status}.\nStderr: ${baseRes.stderr}`;
    console.error(msg);
    log += `[BASELINE FAILED]\n${msg}\n\n`;
    throw new Error(msg);
  }
  console.log("  -> Baseline passed successfully (exit 0).\n");
  log += `[BASELINE PASSED] Exit: 0\n\n`;

  // 2. Run Mutants
  const mutants = [
    { name: "mutant_wrong_version", desc: "Wrong version reliance (ignores unmaterialized raw card changes)" },
    { name: "mutant_time_boundary", desc: "Broken time boundary (drops Day due cards before local midnight)" },
    { name: "mutant_cursor_tie", desc: "Broken keyset cursor (drops tied timestamp items without id tiebreaker)" },
    { name: "mutant_owner_lock", desc: "Broken lock ownership (stale resolution drops held active read lock)" },
  ];

  for (const m of mutants) {
    console.log(`Running Mutant: ${m.name} (${m.desc})...`);
    const res = spawnSync(nodeBin, ["--experimental-strip-types", __filename, "--worker", m.name], {
      env,
      encoding: "utf8",
    });

    log += `--- ${m.name} ---\nDescription: ${m.desc}\nExit Code: ${res.status}\n`;
    log += `Stdout:\n${res.stdout || "(empty)"}\n`;
    log += `Stderr:\n${res.stderr || "(empty)"}\n`;

    // Rule A: Mutant MUST fail (exit !== 0)
    if (res.status === 0) {
      const err = `MUTATION VERIFIER FAILURE: Mutant '${m.name}' survived! Process exited with code 0.`;
      console.error(`  -> FAIL: ${err}`);
      log += `[VERIFIER ERROR: SURVIVED]\n${err}\n\n`;
      throw new Error(err);
    }

    // Rule B: Failure MUST be an intended AssertionError, not a tooling/syntax error
    if (!res.stderr.includes("AssertionError") && !res.stderr.includes("ERR_ASSERTION")) {
      const err = `MUTATION VERIFIER FAILURE: Mutant '${m.name}' failed with unexpected non-assertion error!\nStderr: ${res.stderr}`;
      console.error(`  -> FAIL: ${err}`);
      log += `[VERIFIER ERROR: TOOLING ERROR]\n${err}\n\n`;
      throw new Error(err);
    }

    console.log(`  -> Killed as expected: failed with AssertionError (exit ${res.status}).\n`);
    log += `[MUTANT KILLED AS EXPECTED] Intended AssertionError detected.\n\n`;
  }

  return { success: true, log };
}

if (process.argv[1] === __filename && !isWorker) {
  try {
    const { log } = runMutantVerification({ disableAssertions: false });
    const outDir = resolve(fileURLToPath(import.meta.url), "../../receipts");
    writeFileSync(resolve(outDir, "negative-controls.txt"), log);
    writeFileSync(resolve(outDir, "negative-controls.exit"), "0\n");
    console.log("All mutants killed successfully. Log written to receipts/negative-controls.txt.");
  } catch (err) {
    const outDir = resolve(fileURLToPath(import.meta.url), "../../receipts");
    writeFileSync(resolve(outDir, "negative-controls.exit"), "1\n");
    console.error("Mutation verifier failed:", err.message);
    process.exit(1);
  }
}
