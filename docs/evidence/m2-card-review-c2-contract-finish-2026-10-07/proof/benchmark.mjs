import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  buildSyntheticDatabase,
  generateCards,
  T0,
} from "./syntheticDataset.mjs";

import {
  createDisposableDb,
  deriveCardVersion,
  getLibraryRecentReviews,
  getLibraryReviewDue,
  nextLocalMidnightUtc,
  parseSavedCards,
} from "./contractModel.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stats(timings) {
  if (timings.length === 0) return { min: 0, max: 0, p50: 0, p95: 0, p99: 0, mean: 0 };
  const sorted = [...timings].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const p = (pct) => sorted[Math.min(Math.floor(sorted.length * pct), sorted.length - 1)];
  return {
    min: Number(sorted[0].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
    p50: Number(p(0.5).toFixed(3)),
    p95: Number(p(0.95).toFixed(3)),
    p99: Number(p(0.99).toFixed(3)),
    mean: Number((sum / sorted.length).toFixed(3)),
    count: sorted.length,
  };
}

export async function runBenchmarks() {
  console.log("=== M2 Card Review C2 Synthetic Performance Benchmark (Read Pipeline Corrections) ===");
  console.log(`Node.js: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);

  const midUtc = nextLocalMidnightUtc(T0, "UTC");

  const scales = [
    { name: "100_materials_scale", materials: 100, events: 200, runs: 20 },
    { name: "2500_materials_scale", materials: 2500, events: 5000, runs: 10 },
    { name: "5000_materials_scale", materials: 5000, events: 10000, runs: 10 },
  ];

  const benchmarkResults = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    sqliteVersion: process.versions.sqlite,
    platform: `${process.platform} ${process.arch}`,
    scales: {},
  };

  for (const scale of scales) {
    console.log("\n--------------------------------------------------------------------------------");
    console.log(`Generating synthetic dataset at ${scale.name} (${scale.materials} materials, ${scale.events} events)...`);
    const genStart = performance.now();
    const { db } = buildSyntheticDatabase(scale.materials, scale.events);
    const genDuration = Number((performance.now() - genStart).toFixed(2));

    const matCount = db.prepare("SELECT COUNT(*) AS c FROM study_materials").get().c;
    const versionCount = db.prepare("SELECT COUNT(*) AS c FROM card_versions").get().c;
    const itemCount = db.prepare("SELECT COUNT(*) AS c FROM card_items").get().c;
    const stateCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_state").get().c;
    const eventCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_events").get().c;

    console.log(`Populated in ${genDuration} ms: ${matCount} materials, ${versionCount} versions, ${itemCount} items, ${stateCount} states, ${eventCount} events.`);

    // 1. Single-request Review Due (limit 50, candidateBatchBudget 250)
    const reviewDueTimings = [];
    let firstPageResult = null;
    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      const res = getLibraryReviewDue(db, {
        nowUtc: T0,
        nextLocalMidnightUtc: midUtc,
        limit: 50,
        candidateBatchBudget: 250,
      });
      reviewDueTimings.push(performance.now() - t0);
      if (r === 0) firstPageResult = res;
    }

    // 2. Page 2 Continuation with Revalidation
    const continuationTimings = [];
    if (firstPageResult?.nextCursor) {
      for (let r = 0; r < scale.runs; r++) {
        const t0 = performance.now();
        getLibraryReviewDue(db, {
          nowUtc: T0,
          nextLocalMidnightUtc: midUtc,
          limit: 50,
          candidateBatchBudget: 250,
          cursor: firstPageResult.nextCursor,
        });
        continuationTimings.push(performance.now() - t0);
      }
    }

    // 3. Full Discovery traversal
    const fullDiscoveryRuns = Math.min(scale.runs, 5);
    const fullDiscoveryTimings = [];
    let fullPagesCount = 0;
    let fullMaterialsFound = 0;

    for (let r = 0; r < fullDiscoveryRuns; r++) {
      const t0 = performance.now();
      let cursor = null;
      let pages = 0;
      let totalFound = 0;
      while (true) {
        pages++;
        const res = getLibraryReviewDue(db, {
          nowUtc: T0,
          nextLocalMidnightUtc: midUtc,
          limit: 50,
          candidateBatchBudget: 250,
          cursor,
        });
        totalFound += res.materials.length;
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      fullDiscoveryTimings.push(performance.now() - t0);
      fullPagesCount = pages;
      fullMaterialsFound = totalFound;
    }

    // 4. Approximate Component Microbenchmarks (Isolated synthetic component timings, not end-to-end reader)
    const candidateQueryTimings = [];
    const preflightByteCheckTimings = [];
    const batchedRawReadTimings = [];
    const derivationTimings = [];
    const batchedStateReadTimings = [];
    const approximateRankingTimings = [];
    let totalBytesTransferred = 0;

    for (let r = 0; r < scale.runs; r++) {
      // Step A: Candidate query
      const tA0 = performance.now();
      const rawCandidates = db.prepare(`
        SELECT m.id AS material_id, m.title, m.topic, m.review_status, m.priority, m.updated_at
        FROM study_materials m
        JOIN ai_study_sets a ON a.source_material_id = m.id
        WHERE a.flashcards_json IS NOT NULL AND a.flashcards_json != '[]' AND a.flashcards_json != ''
        ORDER BY CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC, m.updated_at DESC, m.id ASC
        LIMIT 251
      `).all();
      const candidates = rawCandidates.slice(0, 250);
      const tA1 = performance.now();
      candidateQueryTimings.push(tA1 - tA0);

      // Step B1: Preflight byte length check (R4)
      const tB0 = performance.now();
      const cIds = candidates.map((c) => c.material_id);
      const ph = cIds.map(() => "?").join(",");
      const lenRows = db.prepare(`SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len FROM ai_study_sets WHERE source_material_id IN (${ph})`).all(...cIds);
      const byteLenMap = new Map(lenRows.map((row) => [row.source_material_id, row.byte_len]));
      const tB1 = performance.now();
      preflightByteCheckTimings.push(tB1 - tB0);

      // Step B2: Raw flashcards reads (admitted candidate fetches with budget enforcement)
      const tB2_0 = performance.now();
      const getSetStmt = db.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?");
      const admitted = [];
      const derivedMap = new Map();
      let bytes = 0;
      let cumulativeCards = 0;

      for (const cand of candidates) {
        // Enforce conservative card reservation (500 cards) before reading subsequent candidates
        if (admitted.length > 0 && cumulativeCards + 500 > 2500) break;

        const row = getSetStmt.get(cand.material_id);
        if (row && typeof row.flashcards_json === "string") {
          const rawLen = Buffer.byteLength(row.flashcards_json, "utf8");
          if (rawLen > 8388608) continue; // Skip oversize
          bytes += rawLen;
          const parsed = parseSavedCards(row.flashcards_json);
          if (parsed.status === "ok" && parsed.cards.length > 0) {
            cumulativeCards += parsed.cards.length;
            const derived = deriveCardVersion(cand.material_id, parsed.cards);
            derivedMap.set(cand.material_id, derived);
            admitted.push(cand);
          }
        }
      }
      totalBytesTransferred = bytes;
      const tB2_1 = performance.now();
      batchedRawReadTimings.push(tB2_1 - tB2_0);

      // Step C: Derivation timings (included in step B2 parsing & hashing)
      derivationTimings.push(tB2_1 - tB2_0);

      // Step D: Batched state read
      const tD0 = performance.now();
      const vIds = Array.from(new Set(Array.from(derivedMap.values()).map((v) => v.versionId)));
      let stateRows = [];
      if (vIds.length > 0) {
        const vPh = vIds.map(() => "?").join(",");
        stateRows = db.prepare(`
          SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag
          FROM card_items i
          JOIN card_review_state s ON s.item_id = i.id
          WHERE i.version_id IN (${vPh})
        `).all(...vIds);
      }
      const tD1 = performance.now();
      batchedStateReadTimings.push(tD1 - tD0);

      // Step E: Material summaries preparation & urgency ranking
      const tE0 = performance.now();
      const stateMap = new Map();
      for (const s of stateRows) {
        if (!stateMap.has(s.version_id)) stateMap.set(s.version_id, []);
        stateMap.get(s.version_id).push(s);
      }

      const summaries = [];
      for (const cand of admitted) {
        const derived = derivedMap.get(cand.material_id);
        if (!derived) continue;
        const states = stateMap.get(derived.versionId) || [];
        let againCount = 0;
        let dayCount = 0;
        let earliestDueAt = null;
        for (const st of states) {
          if (st.suspended) continue;
          if (st.step === -1 && st.due_at && st.due_at <= T0) {
            againCount++;
            if (!earliestDueAt || st.due_at < earliestDueAt) earliestDueAt = st.due_at;
          } else if (st.step >= 0 && st.due_at && st.due_at < midUtc) {
            dayCount++;
            if (!earliestDueAt || st.due_at < earliestDueAt) earliestDueAt = st.due_at;
          }
        }
        const totalDueCount = againCount + dayCount;
        const newCount = Math.max(0, derived.items.length - states.length);
        if (totalDueCount > 0 || newCount > 0) {
          summaries.push({
            materialId: cand.material_id,
            title: cand.title,
            priority: cand.priority,
            againCount,
            dayCount,
            totalDueCount,
            newCount,
            earliestDueAt,
          });
        }
      }

      summaries.sort((a, b) => {
        const bucketA = a.againCount > 0 ? 0 : a.dayCount > 0 ? 1 : a.totalDueCount === 0 && a.newCount > 0 ? 2 : 3;
        const bucketB = b.againCount > 0 ? 0 : b.dayCount > 0 ? 1 : b.totalDueCount === 0 && b.newCount > 0 ? 2 : 3;
        if (bucketA !== bucketB) return bucketA - bucketB;

        const prioA = a.priority === "next_up" ? 0 : 1;
        const prioB = b.priority === "next_up" ? 0 : 1;
        if (prioA !== prioB) return prioA - prioB;

        if (a.earliestDueAt && b.earliestDueAt && a.earliestDueAt !== b.earliestDueAt) {
          return a.earliestDueAt.localeCompare(b.earliestDueAt);
        }
        if (a.earliestDueAt && !b.earliestDueAt) return -1;
        if (!a.earliestDueAt && b.earliestDueAt) return 1;

        if (a.title !== b.title) return a.title.localeCompare(b.title);
        return a.materialId.localeCompare(b.materialId);
      });
      const tE1 = performance.now();
      approximateRankingTimings.push(tE1 - tE0);
    }

    // 5. Topic Filter (limit 50)
    const topicFilterTimings = [];
    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      getLibraryReviewDue(db, {
        nowUtc: T0,
        nextLocalMidnightUtc: midUtc,
        topic: "aerodynamics",
        limit: 50,
      });
      topicFilterTimings.push(performance.now() - t0);
    }

    // 6. History Keyset Paging
    const historyPage1Timings = [];
    const historyPage2Timings = [];
    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      const p1 = getLibraryRecentReviews(db, { limit: 20 });
      historyPage1Timings.push(performance.now() - t0);

      if (p1.next) {
        const t1 = performance.now();
        getLibraryRecentReviews(db, { limit: 20, cursor: p1.next });
        historyPage2Timings.push(performance.now() - t1);
      }
    }

    const scaleResult = {
      dataset: {
        materials: matCount,
        versions: versionCount,
        items: itemCount,
        states: stateCount,
        events: eventCount,
      },
      reviewDue_page1_50_limit: stats(reviewDueTimings),
      reviewDue_page2_continuation: stats(continuationTimings),
      fullDiscovery_all_pages: stats(fullDiscoveryTimings),
      fullDiscovery_pages_count: fullPagesCount,
      fullDiscovery_materials_found: fullMaterialsFound,
      pipeline_breakdown_approximate_microbenchmarks: {
        sql_candidate_query: stats(candidateQueryTimings),
        sql_preflight_byte_check: stats(preflightByteCheckTimings),
        sql_raw_card_reads_budgeted: stats(batchedRawReadTimings),
        json_parse_canonical_hash: stats(derivationTimings),
        sql_batched_state_read: stats(batchedStateReadTimings),
        urgency_ranking_approximate: stats(approximateRankingTimings),
        sample_bytes_transferred: totalBytesTransferred,
        note: "Approximate synthetic component microbenchmarks. Actual full reader performance is reflected in reviewDue and history metrics above.",
      },
      topic_filter_aerodynamics: stats(topicFilterTimings),
      history_page1_20_limit: stats(historyPage1Timings),
      history_page2_20_limit: stats(historyPage2Timings),
      budgets: {
        due_p50_target_ms: 10,
        due_p50_status: stats(reviewDueTimings).p50 <= 10 ? "PASS" : "EXCEEDED",
        history_p50_target_ms: 15,
        history_p50_status: stats(historyPage1Timings).p50 <= 15 ? "PASS" : "EXCEEDED",
        desktop_ipc_status: "UNMEASURED (Desktop Tauri WebKit runtime separate from Node/SQLite engine)",
        webkit_render_status: "UNMEASURED",
      },
    };

    benchmarkResults.scales[scale.name] = scaleResult;

    console.log(`Results for ${scale.name}:`);
    console.log(`  Review Due Page 1 (limit 50):   p50 = ${scaleResult.reviewDue_page1_50_limit.p50} ms | p95 = ${scaleResult.reviewDue_page1_50_limit.p95} ms`);
    console.log(`  Review Due Page 2 Cont:         p50 = ${scaleResult.reviewDue_page2_continuation.p50} ms | p95 = ${scaleResult.reviewDue_page2_continuation.p95} ms`);
    console.log(`  Full Discovery (${fullPagesCount} pages):       p50 = ${scaleResult.fullDiscovery_all_pages.p50} ms | p95 = ${scaleResult.fullDiscovery_all_pages.p95} ms`);
    console.log(`  Candidate Query:                p50 = ${scaleResult.pipeline_breakdown_approximate_microbenchmarks.sql_candidate_query.p50} ms`);
    console.log(`  Preflight Byte Length Check:    p50 = ${scaleResult.pipeline_breakdown_approximate_microbenchmarks.sql_preflight_byte_check.p50} ms`);
    console.log(`  Raw Card JSON Reads (Budgeted): p50 = ${scaleResult.pipeline_breakdown_approximate_microbenchmarks.sql_raw_card_reads_budgeted.p50} ms (~${(totalBytesTransferred / 1024).toFixed(1)} KB)`);
    console.log(`  Urgency Ranking (Approximate):  p50 = ${scaleResult.pipeline_breakdown_approximate_microbenchmarks.urgency_ranking_approximate.p50} ms`);
    console.log(`  History Page 1 (limit 20):      p50 = ${scaleResult.history_page1_20_limit.p50} ms | p95 = ${scaleResult.history_page1_20_limit.p95} ms`);
    console.log(`  History Page 2 (limit 20):      p50 = ${scaleResult.history_page2_20_limit.p50} ms | p95 = ${scaleResult.history_page2_20_limit.p95} ms`);

    db.close();
  }

  // Representative Stress Testing: Max Card / Text / Unicode / JSON Escaping
  console.log("\n--------------------------------------------------------------------------------");
  console.log("Measuring representative stress workloads (500 cards, max text, Unicode, JSON escaping)...");

  // A. Standard 500-card set
  const raw500 = generateCards("Std500", 500);
  const json500 = JSON.stringify(raw500);
  const hashTimingsStd = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const parsed = parseSavedCards(json500);
    deriveCardVersion("mat-std-500", parsed.cards);
    hashTimingsStd.push(performance.now() - t0);
  }

  // B. Max-text + Unicode 500-card set (accents, Japanese kanji, symbols)
  const unicodeCards = [];
  for (let i = 0; i < 500; i++) {
    unicodeCards.push({
      front: `[FR-${i}] V_X & V_Y Best Angle of Climb (航法・上昇角) / Éléments d'aviation météo §${i} ✈️`,
      back: `Best angle achieves highest altitude in shortest horizontal distance. V_X = 62 KIAS, V_Y = 74 KIAS. 耐空性審査要領: 最大上昇率速度. (Test payload padding text line ${i} with accented characters: à, é, î, ö, ü, ñ).`,
      sourcePage: (i % 100) + 1,
    });
  }
  const unicodeJson = JSON.stringify(unicodeCards);
  const unicodeBytes = Buffer.byteLength(unicodeJson, "utf8");
  const hashTimingsUnicode = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const parsed = parseSavedCards(unicodeJson);
    deriveCardVersion("mat-unicode-500", parsed.cards);
    hashTimingsUnicode.push(performance.now() - t0);
  }

  // C. Genuinely maximum C1 Unicode 500-card fixture (1,000 front code points, 2,000 back code points)
  const fullMaxUnicodeCards = [];
  const front1000 = "✈".repeat(1000); // 1,000 code points, 3 UTF-8 bytes each
  const back2000 = "🛩".repeat(2000);  // 2,000 code points, 4 UTF-8 bytes each
  for (let i = 0; i < 500; i++) {
    fullMaxUnicodeCards.push({
      front: front1000,
      back: back2000,
      sourcePage: (i % 500) + 1,
    });
  }
  const fullMaxUnicodeJson = JSON.stringify(fullMaxUnicodeCards);
  const parsedFullMax = parseSavedCards(fullMaxUnicodeJson);
  if (parsedFullMax.status !== "ok" || parsedFullMax.cards.length !== 500) {
    throw new Error("Full max-Unicode 500-card fixture failed C1 parser validation");
  }
  const fullMaxUnicodeBytes = Buffer.byteLength(fullMaxUnicodeJson, "utf8");
  const hashTimingsFullMax = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    deriveCardVersion("mat-full-unicode-500", parsedFullMax.cards);
    hashTimingsFullMax.push(performance.now() - t0);
  }

  // D. Control-character escaped 500-card fixture (1,000 front \u0001 code points, 2,000 back \u0001 code points)
  // Each \u0001 is 1 byte in memory/UTF-8, but serializes as 6 ASCII bytes in JSON: '\u0001'
  const escapedCards = [];
  const frontEscaped = "\u0001".repeat(1000);
  const backEscaped = "\u0001".repeat(2000);
  for (let i = 0; i < 500; i++) {
    escapedCards.push({
      front: frontEscaped,
      back: backEscaped,
      sourcePage: null,
    });
  }
  const escapedJson = JSON.stringify(escapedCards);
  const escapedBytes = Buffer.byteLength(escapedJson, "utf8");
  const parsedEscaped = parseSavedCards(escapedJson);
  if (parsedEscaped.status !== "ok" || parsedEscaped.cards.length !== 500) {
    throw new Error("Escaped control character 500-card fixture failed C1 parser validation");
  }

  benchmarkResults.stress_measurements = {
    standard_500_cards: {
      cardCount: 500,
      jsonBytes: Buffer.byteLength(json500, "utf8"),
      stats: stats(hashTimingsStd),
    },
    unicode_sample_text_500_cards: {
      cardCount: 500,
      jsonBytes: unicodeBytes,
      stats: stats(hashTimingsUnicode),
    },
    genuine_max_unicode_500_cards: {
      cardCount: 500,
      frontCodePoints: 1000,
      backCodePoints: 2000,
      jsonBytes: fullMaxUnicodeBytes,
      isProductionValid: true,
      stats: stats(hashTimingsFullMax),
    },
    json_escaped_control_chars_500_cards: {
      cardCount: 500,
      frontCodePoints: 1000,
      backCodePoints: 2000,
      jsonBytes: escapedBytes,
      exceedsPreflightCap: escapedBytes > 8388608,
      isProductionValidInC1: true,
    },
    worst_case_budget_analysis: {
      c1_max_cards_per_material: 500,
      c1_max_front_code_points: 1000,
      c1_max_back_code_points: 2000,
      theoretical_candidates_per_batch: 250,
      theoretical_max_cards_per_batch: 125000,
      honest_code_point_utf8_arithmetic: {
        ascii_text_per_card_bytes: "~3,000 bytes (1,000 front + 2,000 back @ 1 byte/char)",
        ascii_set_500_cards_bytes: "~1.5 MB raw JSON per study set",
        ascii_250_candidates_batch_bytes: "~375 MB unbudgeted raw database transfer",
        astral_unicode_per_card_bytes: "~11,000 bytes (1,000 front @ 3 bytes + 2,000 back @ 4 bytes)",
        astral_unicode_set_500_cards_bytes: `~5.5 MB raw JSON per study set (measured fixture: ${(fullMaxUnicodeBytes / (1024 * 1024)).toFixed(2)} MB)`,
        astral_unicode_250_candidates_batch_bytes: "~1,375 MB (1.37 GB) theoretical unbudgeted raw database transfer",
        prior_false_statement_correction: "The previously cited 31.25 MB was derived from an arbitrary 250 bytes/card small-card example, which severely understates worst-case storage and wire transfer. Executable budgets bound work safely regardless of card text length.",
      },
      honest_json_escaping_expansion: {
        code_point_vs_json_bytes: "Code point counts and UTF-8 memory byte counts do NOT bound serialized JSON length. In JSON, control characters (\\u0000-\\u001F) expand from 1 byte to 6 serialized ASCII bytes (\\uXXXX).",
        escaped_control_char_set_bytes: `${escapedBytes} bytes (~${(escapedBytes / (1024 * 1024)).toFixed(2)} MB), which exceeds the 8 MiB (8,388,608 bytes) preflight cap despite passing C1 parse validation with 500 cards.`,
        whitespace_and_custom_keys: "Formatting whitespace, indentation, or extra unindexed properties further expand raw serialized byte size, proving that LENGTH(CAST(flashcards_json AS BLOB)) preflight checks are strictly required before SQLite wire transfer and JSON parsing.",
      },
      enforced_executable_caps: {
        candidateBatchBudget: 250,
        maxBatchCardsBudget: 2500,
        maxBatchRawJsonBytesBudget: 2097152,
        absoluteMaxSingleSetRawBytes: 8388608,
        singleSetAdmissionLane: "Single-set admission lane admits a single oversize set (<= 8 MiB) if budget is exceeded on item 0, ensuring terminating forward progress without empty-page livelock.",
      },
    },
  };

  console.log(`Standard 500-Card Pipeline:      p50 = ${benchmarkResults.stress_measurements.standard_500_cards.stats.p50} ms | max = ${benchmarkResults.stress_measurements.standard_500_cards.stats.max} ms`);
  console.log(`Unicode Sample-Text 500-Card:    p50 = ${benchmarkResults.stress_measurements.unicode_sample_text_500_cards.stats.p50} ms (~${(unicodeBytes / 1024).toFixed(1)} KB) | max = ${benchmarkResults.stress_measurements.unicode_sample_text_500_cards.stats.max} ms`);
  console.log(`Genuine Max-Unicode 500-Card:    p50 = ${benchmarkResults.stress_measurements.genuine_max_unicode_500_cards.stats.p50} ms (~${(fullMaxUnicodeBytes / (1024 * 1024)).toFixed(2)} MB) | max = ${benchmarkResults.stress_measurements.genuine_max_unicode_500_cards.stats.max} ms`);
  console.log(`JSON Escaped 500-Card Fixture:   ${(escapedBytes / (1024 * 1024)).toFixed(2)} MB (Exceeds 8 MiB cap: ${escapedBytes > 8388608})`);

  const resultsPath = path.resolve(__dirname, "../results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(benchmarkResults, null, 2) + "\n");
  console.log(`\nSaved benchmark results to ${resultsPath}`);

  return benchmarkResults;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBenchmarks().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
