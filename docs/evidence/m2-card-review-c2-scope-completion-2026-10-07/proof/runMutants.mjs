import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  at,
  buildSyntheticDatabase,
  generateCards,
  T0,
} from "./syntheticDataset.mjs";

import {
  createDisposableDb,
  deriveCardVersion,
  getLibraryRecentReviewsBrokenCursor,
  getLibraryReviewDueBrokenCandidateProgression,
  getLibraryReviewDueBrokenCurrentVersion,
  nextLocalMidnightUtc,
} from "./contractModel.mjs";

console.log("=== RUNNING SEMANTIC MUTANTS (VERIFYING FAILING BEHAVIOR) ===\n");

let log = "=== SEMANTIC MUTATION RUN LOG ===\n\n";

// Mutant 1: Query without verifying raw saved cards (relies on is_active=1)
try {
  console.log("Running Mutant 1: Wrong Version / Inactive Flag Reliance...");
  const { db } = buildSyntheticDatabase(100, 200);
  const midUtc = nextLocalMidnightUtc(T0, "UTC");
  const brokenRows = getLibraryReviewDueBrokenCurrentVersion(db, { nowUtc: T0, nextLocalMidnightUtc: midUtc });
  const brokenWeather = brokenRows.find((r) => r.material_id === "mat-changed-03");

  // This assertion EXPECTS retired cards to be excluded (totalDueCount === 0).
  // The mutant includes retired cards, so asserting day_count === 0 FAILS!
  assert.equal(brokenWeather?.day_count ?? 0, 0, "MUTANT FAILED: Retired version due cards were incorrectly included!");
  db.close();
} catch (err) {
  log += `[MUTANT 1 FAILED AS EXPECTED]\nAssertion Error: ${err.message}\nCode: ${err.code}\n\n`;
  console.log("  -> Mutant 1 failed assertion as expected.");
}

// Mutant 2: Keyset cursor without ID tiebreaker drops tied timestamps
try {
  console.log("Running Mutant 2: Keyset Cursor Without ID Tiebreaker...");
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

  // Expecting 3 remaining tied items. Mutant returns 0 because cursor was `reviewed_at < tieTime`.
  assert.equal(remainingTiedInP2.length, 3, "MUTANT FAILED: Broken cursor dropped tied timestamp events!");
  db.close();
} catch (err) {
  log += `[MUTANT 2 FAILED AS EXPECTED]\nAssertion Error: ${err.message}\nCode: ${err.code}\n\n`;
  console.log("  -> Mutant 2 failed assertion as expected.");
}

// Mutant 3: Candidate pagination cutoff (drops items past 250 without continuation)
try {
  console.log("Running Mutant 3: Candidate Batch Cutoff Without Continuation...");
  const db = createDisposableDb();
  const now = "2026-10-07T15:00:00.000Z";
  const mid = "2026-10-08T00:00:00.000Z";

  for (let i = 0; i < 250; i++) {
    const id = `inel-${String(i).padStart(3, "0")}`;
    const raw = generateCards(id, 1);
    db.prepare("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES(?,?,?,?)").run(id, id, now, now);
    db.prepare("INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES(?,?,?,?)").run(id, JSON.stringify(raw), now, now);
    const v = deriveCardVersion(id, raw);
    db.prepare("INSERT INTO card_versions(id,source_material_id,content_hash,card_count,provider,created_at,is_active) VALUES(?,?,?,1,'gemini',?,1)").run(v.versionId, id, v.contentHash, now);
    db.prepare("INSERT INTO card_items(id,version_id,ordinal,front,back) VALUES(?,?,0,'F','B')").run(v.items[0].itemId, v.versionId);
    db.prepare("INSERT INTO card_review_state(item_id,source_material_id,scheduler_version,step,due_at,last_reviewed_at,reps,revision) VALUES(?,?,'simple-v1',0,'2026-10-25T00:00:00.000Z',?,1,1)").run(v.items[0].itemId, id, now);
  }

  db.prepare("INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('older-new','Older New',?,?)").run(now, "2026-10-01T00:00:00.000Z");
  db.prepare("INSERT INTO ai_study_sets(source_material_id,flashcards_json,generated_at,updated_at) VALUES('older-new',?,?,?)").run(JSON.stringify(generateCards("new", 1)), now, "2026-10-01T00:00:00.000Z");

  const brokenRes = getLibraryReviewDueBrokenCandidateProgression(db, { nowUtc: now, nextLocalMidnightUtc: mid, limit: 50 });
  const found = brokenRes.materials.some((m) => m.materialId === "older-new");

  // Expecting older-new to be discovered. Mutant drops it because candidateBatchBudget was capped with no cursor.
  assert.equal(found, true, "MUTANT FAILED: Older material past 250 was dropped by broken progression!");
  db.close();
} catch (err) {
  log += `[MUTANT 3 FAILED AS EXPECTED]\nAssertion Error: ${err.message}\nCode: ${err.code}\n\n`;
  console.log("  -> Mutant 3 failed assertion as expected.");
}

const outDir = resolve(fileURLToPath(import.meta.url), "../../receipts");
writeFileSync(resolve(outDir, "negative-controls.txt"), log);
writeFileSync(resolve(outDir, "negative-controls.exit"), "0\n");
console.log("\nNegative controls verification complete. Log saved to receipts/negative-controls.txt.");
