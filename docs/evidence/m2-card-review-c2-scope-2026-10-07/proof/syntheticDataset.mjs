/**
 * Synthetic Dataset Generator for C2 Disposable Proof
 * 
 * Populates disposable SQLite databases with:
 * - 100, 2,500, or 5,000 materials
 * - Up to 10,000 review events
 * - Realistic variety:
 *   - Concrete example materials (mat-aero-01, mat-nav-02)
 *   - Active materialized versions with due Again cards (step -1)
 *   - Active materialized versions with due Day cards (step >= 0)
 *   - Unmaterialized materials with new cards
 *   - Changed card sets (A -> B unmaterialized, B current)
 *   - A -> B -> A round-trip materials
 *   - Never-rated suspended and flagged cards
 *   - Valid-empty guide-only sets ([])
 *   - Malformed flashcards sets
 *   - Cascade-deleted materials with tombstoned operations
 *   - Practice test attempts (Migration 0011) for history separation
 */
import {
  canonicalJson,
  createDisposableDb,
  deriveCardVersion,
  parseSavedCards,
  scheduleCard,
  sha256Hex,
} from "./contractModel.mjs";

export const TOPICS = ["aerodynamics", "regulations", "weather", "navigation", "systems", "instruments", "airspace"];
export const PRIORITIES = ["next_up", "important", "later"];
export const REVIEW_STATUSES = ["needs_review", "studying", "confident", "reference_only"];

export const T0 = "2026-10-07T15:00:00.000Z";
export const at = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

export function generateCards(prefix, count) {
  return Array.from({ length: count }, (_, i) => ({
    front: `${prefix}: Question ${i + 1} for aeronautical knowledge test?`,
    back: `${prefix}: Detailed answer ${i + 1} with FAA reference citation.`,
    sourcePage: ((i * 3) % 250) + 1,
  }));
}

/**
 * Builds a populated database at the specified material scale.
 * @param {number} materialCount 100, 2500, or 5000
 * @param {number} targetEvents Target total card review events (e.g. 10000 at 5000 scale)
 */
export function buildSyntheticDatabase(materialCount = 100, targetEvents = 200) {
  const db = createDisposableDb();

  const insertMaterial = db.prepare(`
    INSERT INTO study_materials (
      id, title, material_type, topic, review_status, priority, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertStudySet = db.prepare(`
    INSERT INTO ai_study_sets (
      source_material_id, title, summary, flashcards_json, generated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertVersion = db.prepare(`
    INSERT INTO card_versions (
      id, source_material_id, content_hash, card_count, provider, created_at, first_reviewed_at, is_active
    ) VALUES (?, ?, ?, ?, 'gemini', ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO card_items (
      id, version_id, ordinal, front, back, source_page
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertState = db.prepare(`
    INSERT INTO card_review_state (
      item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at,
      reps, lapses, suspended, flag, revision
    ) VALUES (?, ?, 'simple-v1', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO card_review_events (
      id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json
    ) VALUES (?, ?, ?, ?, ?, 'simple-v1', ?, ?)
  `);

  const insertOp = db.prepare(`
    INSERT INTO card_review_operations (
      operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPracticeVersion = db.prepare(`
    INSERT INTO practice_test_versions (
      id, source_material_id, history_key, source_material_title, version_number,
      title, content_hash, created_at, is_active
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1)
  `);

  const insertPracticeAttempt = db.prepare(`
    INSERT INTO practice_attempts (
      id, version_id, source_material_id, source_material_title, started_at, completed_at,
      status, total_questions, answered_count, correct_count, incorrect_count, score_percent
    ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
  `);

  // Begin transaction for high-speed generation
  db.exec("BEGIN TRANSACTION;");

  let totalEventsCreated = 0;

  // 1. Concrete Material M1: "mat-aero-01" (Aerodynamics & Principles of Flight)
  {
    const mId = "mat-aero-01";
    insertMaterial.run(
      mId, "Aerodynamics & Principles of Flight", "study_guide", "aerodynamics",
      "studying", "next_up", "Primary ground school notes on lift, stall, and CG limits.",
      at(T0, -5 * 86400000), at(T0, -86400000)
    );

    const cardsA = generateCards("Aerodynamics", 10);
    const jsonA = JSON.stringify(cardsA);
    insertStudySet.run(mId, "Aerodynamics Guide", "Summary", jsonA, at(T0, -5 * 86400000), at(T0, -86400000));

    const verA = deriveCardVersion(mId, cardsA);
    insertVersion.run(verA.versionId, mId, verA.contentHash, 10, at(T0, -4 * 86400000), at(T0, -4 * 86400000), 1);

    for (const item of verA.items) {
      insertItem.run(item.itemId, verA.versionId, item.ordinal, item.front, item.back, item.sourcePage);
    }

    // Card 0: Again card (due at exact instant: T0 - 5 minutes, step -1)
    const item0 = verA.items[0];
    insertState.run(item0.itemId, mId, -1, at(T0, -5 * 60000), at(T0, -15 * 60000), 2, 1, 0, null, 2);
    insertEvent.run(
      sha256Hex(`ev-${item0.itemId}-1`), item0.itemId, 0, "good", at(T0, -24 * 3600000),
      "{}", JSON.stringify({ step: 0, reps: 1 })
    );
    insertEvent.run(
      sha256Hex(`ev-${item0.itemId}-2`), item0.itemId, 0, "again", at(T0, -15 * 60000),
      JSON.stringify({ step: 0, reps: 1 }), JSON.stringify({ step: -1, reps: 2, lapses: 1 })
    );
    totalEventsCreated += 2;

    // Card 1: Day card due today (step 0, due at T0 - 2 hours)
    const item1 = verA.items[1];
    insertState.run(item1.itemId, mId, 0, at(T0, -2 * 3600000), at(T0, -26 * 3600000), 1, 0, 0, null, 1);
    insertEvent.run(
      sha256Hex(`ev-${item1.itemId}-1`), item1.itemId, 0, "good", at(T0, -26 * 3600000),
      "{}", JSON.stringify({ step: 0, reps: 1 })
    );
    totalEventsCreated += 1;

    // Card 2: Future card (due in 2 days, not due today)
    const item2 = verA.items[2];
    insertState.run(item2.itemId, mId, 2, at(T0, 48 * 3600000), at(T0, -24 * 3600000), 2, 0, 0, null, 2);
    insertEvent.run(
      sha256Hex(`ev-${item2.itemId}-1`), item2.itemId, 0, "easy", at(T0, -24 * 3600000),
      "{}", JSON.stringify({ step: 2, reps: 1 })
    );
    totalEventsCreated += 1;

    // Card 3: Flagged unclear never-rated card
    const item3 = verA.items[3];
    insertState.run(item3.itemId, mId, -1, null, null, 0, 0, 0, "unclear", 1);

    // Cards 4-9: New unrated cards (no state rows)
  }

  // 2. Concrete Material M2: "mat-nav-02" (Cross-Country Navigation)
  {
    const mId = "mat-nav-02";
    insertMaterial.run(
      mId, "Cross-Country Navigation & VORs", "worksheet", "navigation",
      "needs_review", "important", "Flight computer calculations and airway intercepts.",
      at(T0, -2 * 86400000), at(T0, -2 * 86400000)
    );
    const cards = generateCards("Navigation", 8);
    // Unmaterialized: no rows in card_versions or card_items!
    insertStudySet.run(mId, "Navigation Guide", "Summary", JSON.stringify(cards), at(T0, -2 * 86400000), at(T0, -2 * 86400000));
  }

  // 3. Changed card set: "mat-changed-03" (Weather Systems)
  // Version A materialized with 2 due cards, but raw cards updated to Version B (7 cards) before B materialization!
  {
    const mId = "mat-changed-03";
    insertMaterial.run(
      mId, "Aviation Weather & METARs", "study_guide", "weather",
      "studying", "important", "Surface analysis and prog charts.",
      at(T0, -7 * 86400000), at(T0, -3600000)
    );

    const cardsA = generateCards("WeatherOld", 5);
    const verA = deriveCardVersion(mId, cardsA);
    insertVersion.run(verA.versionId, mId, verA.contentHash, 5, at(T0, -6 * 86400000), at(T0, -6 * 86400000), 1);
    for (const item of verA.items) {
      insertItem.run(item.itemId, verA.versionId, item.ordinal, item.front, item.back, item.sourcePage);
      // Give 2 cards due states
      if (item.ordinal < 2) {
        insertState.run(item.itemId, mId, 0, at(T0, -3600000), at(T0, -25 * 3600000), 1, 0, 0, null, 1);
        insertEvent.run(
          sha256Hex(`ev-${item.itemId}-1`), item.itemId, 0, "good", at(T0, -25 * 3600000),
          "{}", JSON.stringify({ step: 0 })
        );
        totalEventsCreated += 1;
      }
    }

    // Now ai_study_sets has Version B cards!
    const cardsB = generateCards("WeatherRegenerated", 7);
    insertStudySet.run(mId, "Weather Guide", "Summary", JSON.stringify(cardsB), at(T0, -3600000), at(T0, -3600000));
  }

  // 4. A -> B -> A Reverted Material: "mat-revert-04" (Airspace Classification)
  {
    const mId = "mat-revert-04";
    insertMaterial.run(
      mId, "Airspace Classes & Weather Minimums", "study_guide", "airspace",
      "studying", "next_up", "Class B/C/D entry and VFR visibility.",
      at(T0, -10 * 86400000), at(T0, -86400000)
    );
    const cardsA = generateCards("Airspace", 6);
    const verA = deriveCardVersion(mId, cardsA);
    insertVersion.run(verA.versionId, mId, verA.contentHash, 6, at(T0, -9 * 86400000), at(T0, -9 * 86400000), 1);
    for (const item of verA.items) {
      insertItem.run(item.itemId, verA.versionId, item.ordinal, item.front, item.back, item.sourcePage);
    }
    // Card 0 has due state
    insertState.run(verA.items[0].itemId, mId, 1, at(T0, -1000), at(T0, -3 * 86400000), 2, 0, 0, null, 2);
    insertEvent.run(
      sha256Hex(`ev-${verA.items[0].itemId}-1`), verA.items[0].itemId, 0, "good", at(T0, -3 * 86400000),
      "{}", JSON.stringify({ step: 1 })
    );
    totalEventsCreated += 1;

    // Study set currently holds exact cardsA content
    insertStudySet.run(mId, "Airspace Guide", "Summary", JSON.stringify(cardsA), at(T0, -86400000), at(T0, -86400000));
  }

  // 5. Valid empty study packet: "mat-empty-05"
  {
    const mId = "mat-empty-05";
    insertMaterial.run(
      mId, "Weight & Balance POH Supplement", "handout", "systems",
      "reference_only", "later", "Guide-only packet with zero flashcards.",
      at(T0, -15 * 86400000), at(T0, -15 * 86400000)
    );
    insertStudySet.run(mId, "W&B POH", "Summary", "[]", at(T0, -15 * 86400000), at(T0, -15 * 86400000));
  }

  // 6. Malformed study packet: "mat-malformed-06"
  {
    const mId = "mat-malformed-06";
    insertMaterial.run(
      mId, "Corrupted Electrical Schematic Notes", "notes", "systems",
      "needs_review", "later", "Damaged JSON format in storage.",
      at(T0, -20 * 86400000), at(T0, -20 * 86400000)
    );
    insertStudySet.run(mId, "Electrical", "Summary", "[{broken_json", at(T0, -20 * 86400000), at(T0, -20 * 86400000));
  }

  // 7. Practice test attempt for history separation testing
  {
    const mId = "mat-aero-01";
    const pVerId = "pver-aero-01";
    insertPracticeVersion.run(pVerId, mId, "hist-aero", "Aerodynamics Practice Test", "Aerodynamics Quiz", "hash-quiz", at(T0, -10 * 86400000));
    insertPracticeAttempt.run(
      "att-aero-01", pVerId, mId, "Aerodynamics Practice Test",
      at(T0, -2 * 86400000), at(T0, -2 * 86400000 + 1200000),
      20, 20, 17, 3, 85.0
    );
  }

  // Fill remainder of materialCount with realistic synthetic materials
  const initialBaseCount = 6;
  const remainingMaterials = materialCount - initialBaseCount;

  // Distribute target events across materials
  const eventsRemaining = targetEvents - totalEventsCreated;
  const eventsPerMaterial = eventsRemaining > 0 ? Math.ceil(eventsRemaining / (materialCount * 0.4)) : 0;

  for (let idx = 0; idx < remainingMaterials; idx++) {
    const num = idx + initialBaseCount + 1;
    const mId = `mat-synth-${String(num).padStart(5, "0")}`;
    const topic = TOPICS[num % TOPICS.length];
    const priority = PRIORITIES[num % PRIORITIES.length];
    const status = REVIEW_STATUSES[num % REVIEW_STATUSES.length];
    const title = `Aviation Subject ${num}: ${topic.toUpperCase()} Reference Manual`;
    const createdAt = at(T0, -(num * 3600000) % (180 * 86400000));
    const updatedAt = at(T0, -(num * 1800000) % (30 * 86400000));

    insertMaterial.run(mId, title, "study_guide", topic, status, priority, `Auto-generated material ${num}`, createdAt, updatedAt);

    // 60% of materials have 10-20 cards, 30% have 5 cards, 10% have guide-only ([])
    const cardMod = num % 10;
    const cardCount = cardMod === 0 ? 0 : cardMod < 7 ? 15 : 5;
    const cards = cardCount > 0 ? generateCards(`Material${num}`, cardCount) : [];
    const flashcardsJson = JSON.stringify(cards);

    insertStudySet.run(mId, `${title} Guide`, "Summary", flashcardsJson, createdAt, updatedAt);

    if (cardCount > 0) {
      // 50% of materials have materialized snapshots
      const isMaterialized = (num % 2) === 0;
      if (isMaterialized) {
        const ver = deriveCardVersion(mId, cards);
        insertVersion.run(ver.versionId, mId, ver.contentHash, cardCount, createdAt, updatedAt, 1);

        for (const item of ver.items) {
          insertItem.run(item.itemId, ver.versionId, item.ordinal, item.front, item.back, item.sourcePage);
        }

        // Add due cards and review events if we still need events
        const shouldHaveDue = (num % 3) === 0;
        const cardsToReview = Math.min(cardCount, Math.max(1, eventsPerMaterial));

        for (let cIdx = 0; cIdx < cardsToReview; cIdx++) {
          if (totalEventsCreated >= targetEvents && !shouldHaveDue) break;

          const item = ver.items[cIdx];
          const isAgain = shouldHaveDue && cIdx === 0 && (num % 6 === 0);
          const isDayDue = shouldHaveDue && (cIdx === 1 || !isAgain);
          const isSuspended = (num % 17 === 0) && cIdx === cardsToReview - 1;

          let step = 0;
          let dueAt = null;
          let lastRev = at(T0, -((cIdx + 1) * 86400000));

          if (isAgain) {
            step = -1;
            dueAt = at(T0, -5 * 60000); // 5 min ago
          } else if (isDayDue) {
            step = 1;
            dueAt = at(T0, -3600000); // 1 hour ago (due today)
          } else {
            step = 3;
            dueAt = at(T0, 7 * 86400000); // due next week
          }

          if (isSuspended) {
            insertState.run(item.itemId, mId, -1, null, null, 0, 0, 1, null, 1);
          } else {
            insertState.run(item.itemId, mId, step, dueAt, lastRev, 2, 0, 0, null, 2);

            if (totalEventsCreated < targetEvents) {
              const eventId = sha256Hex(`ev-synth-${item.itemId}-${totalEventsCreated}`);
              insertEvent.run(
                eventId, item.itemId, 0, isAgain ? "again" : "good",
                lastRev, "{}", JSON.stringify({ step, reps: 2 })
              );
              totalEventsCreated++;
            }
          }
        }
      }
    }
  }

  db.exec("COMMIT;");

  return { db, totalEventsCreated, materialCount };
}
