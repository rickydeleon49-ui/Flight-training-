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
  console.log("=== M2 Card Review C2 Synthetic Performance Benchmark (Completed Bounded & Batched Reads) ===");
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
    const studySetCount = db.prepare("SELECT COUNT(*) AS c FROM ai_study_sets").get().c;
    const versionCount = db.prepare("SELECT COUNT(*) AS c FROM card_versions").get().c;
    const itemCount = db.prepare("SELECT COUNT(*) AS c FROM card_items").get().c;
    const stateCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_state").get().c;
    const eventCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_events").get().c;

    console.log(`Populated in ${genDuration} ms: ${matCount} materials, ${versionCount} versions, ${itemCount} items, ${stateCount} states, ${eventCount} events.`);

    // 1. Single-request Review Due (limit 50, candidateBatchBudget 250)
    const reviewDueTimings = [];
    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      getLibraryReviewDue(db, {
        nowUtc: T0,
        nextLocalMidnightUtc: midUtc,
        limit: 50,
        candidateBatchBudget: 250,
      });
      reviewDueTimings.push(performance.now() - t0);
    }

    // 2. Full Discovery traversal (iterating until nextCursor === null)
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
        const res = getLibraryReviewDue(db, {
          nowUtc: T0,
          nextLocalMidnightUtc: midUtc,
          limit: 50,
          candidateBatchBudget: 250,
          cursor,
        });
        pages++;
        totalFound += res.materials.length;
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      fullDiscoveryTimings.push(performance.now() - t0);
      fullPagesCount = pages;
      fullMaterialsFound = totalFound;
    }

    // 3. Batched pipeline component breakdown
    const candidateQueryTimings = [];
    const batchedRawReadTimings = [];
    const derivationTimings = [];
    const batchedStateReadTimings = [];
    const rankingTimings = [];
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

      // Step B: Batched raw flashcards read
      const tB0 = performance.now();
      const cIds = candidates.map((c) => c.material_id);
      const ph = cIds.map(() => "?").join(",");
      const setRows = db.prepare(`SELECT source_material_id, flashcards_json FROM ai_study_sets WHERE source_material_id IN (${ph})`).all(...cIds);
      const tB1 = performance.now();
      batchedRawReadTimings.push(tB1 - tB0);

      // Step C: JSON parse + deriveCardVersion hashing
      const tC0 = performance.now();
      let bytes = 0;
      const validDerived = [];
      for (const row of setRows) {
        if (row.flashcards_json) {
          bytes += Buffer.byteLength(row.flashcards_json, "utf8");
          const parsed = parseSavedCards(row.flashcards_json);
          if (parsed.status === "ok") {
            const derived = deriveCardVersion(row.source_material_id, parsed.cards);
            validDerived.push(derived);
          }
        }
      }
      totalBytesTransferred = bytes;
      const tC1 = performance.now();
      derivationTimings.push(tC1 - tC0);

      // Step D: Batched state read
      const tD0 = performance.now();
      const vIds = validDerived.map((v) => v.versionId);
      if (vIds.length > 0) {
        const vPh = vIds.map(() => "?").join(",");
        db.prepare(`
          SELECT i.version_id, s.item_id, s.step, s.due_at, s.suspended, s.flag
          FROM card_items i
          JOIN card_review_state s ON s.item_id = i.id
          WHERE i.version_id IN (${vPh})
        `).all(...vIds);
      }
      const tD1 = performance.now();
      batchedStateReadTimings.push(tD1 - tD0);

      // Step E: Urgency ranking
      const tE0 = performance.now();
      const dummyList = validDerived.map((v, i) => ({
        materialId: `mat-${i}`,
        againCount: i % 3 === 0 ? 1 : 0,
        dayCount: i % 2 === 0 ? 1 : 0,
        totalDueCount: 1,
        newCount: 2,
        priority: i % 4 === 0 ? "next_up" : "important",
        title: `Material ${i}`,
        earliestDueAt: T0,
      }));
      dummyList.sort((a, b) => {
        const bA = a.againCount > 0 ? 0 : a.dayCount > 0 ? 1 : a.totalDueCount === 0 && a.newCount > 0 ? 2 : 3;
        const bB = b.againCount > 0 ? 0 : b.dayCount > 0 ? 1 : b.totalDueCount === 0 && b.newCount > 0 ? 2 : 3;
        if (bA !== bB) return bA - bB;
        const pA = a.priority === "next_up" ? 0 : 1;
        const pB = b.priority === "next_up" ? 0 : 1;
        if (pA !== pB) return pA - pB;
        return a.materialId.localeCompare(b.materialId);
      });
      const tE1 = performance.now();
      rankingTimings.push(tE1 - tE0);
    }

    // 4. Topic Filter (limit 50)
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

    // 5. History Keyset Paging (page 1 and page 2 with provenance)
    const historyPage1Timings = [];
    const historyPage2Timings = [];

    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      const p1Result = getLibraryRecentReviews(db, { cursor: null, limit: 20 });
      historyPage1Timings.push(performance.now() - t0);

      const t1 = performance.now();
      getLibraryRecentReviews(db, { cursor: p1Result.next, limit: 20 });
      historyPage2Timings.push(performance.now() - t1);
    }

    const scaleResult = {
      dataset: {
        materials: matCount,
        studySets: studySetCount,
        versions: versionCount,
        items: itemCount,
        states: stateCount,
        events: eventCount,
      },
      reviewDue_page1_50_limit: stats(reviewDueTimings),
      fullDiscovery_all_pages: stats(fullDiscoveryTimings),
      fullDiscovery_pages_count: fullPagesCount,
      fullDiscovery_materials_found: fullMaterialsFound,
      pipeline_breakdown: {
        sql_candidate_query: stats(candidateQueryTimings),
        sql_batched_raw_read: stats(batchedRawReadTimings),
        json_parse_canonical_hash_250: stats(derivationTimings),
        sql_batched_state_read: stats(batchedStateReadTimings),
        urgency_ranking_sort: stats(rankingTimings),
        sample_bytes_transferred: totalBytesTransferred,
      },
      topic_filter_aerodynamics: stats(topicFilterTimings),
      history_page1_20_limit: stats(historyPage1Timings),
      history_page2_20_limit: stats(historyPage2Timings),
      budgets: {
        due_p50_target_ms: 10,
        due_p50_status: stats(reviewDueTimings).p50 <= 10 ? "evaluated_below" : "evaluated_above",
        history_p50_target_ms: 15,
        history_p50_status: stats(historyPage1Timings).p50 <= 15 ? "evaluated_below" : "evaluated_above",
        desktop_ipc_status: "unmeasured",
        webkit_render_status: "unmeasured",
      },
    };

    benchmarkResults.scales[scale.name] = scaleResult;

    console.log(`Results for ${scale.name}:`);
    console.log(`  Review Due Page 1 (limit 50):   p50 = ${scaleResult.reviewDue_page1_50_limit.p50} ms | p95 = ${scaleResult.reviewDue_page1_50_limit.p95} ms`);
    console.log(`  Full Discovery (${fullPagesCount} pages):       p50 = ${scaleResult.fullDiscovery_all_pages.p50} ms | p95 = ${scaleResult.fullDiscovery_all_pages.p95} ms`);
    console.log(`  Batched Raw SQL Read:           p50 = ${scaleResult.pipeline_breakdown.sql_batched_raw_read.p50} ms`);
    console.log(`  JSON + Canonical + Hash (250):  p50 = ${scaleResult.pipeline_breakdown.json_parse_canonical_hash_250.p50} ms (transferred ~${(totalBytesTransferred / 1024).toFixed(1)} KB)`);
    console.log(`  Batched State SQL Read:         p50 = ${scaleResult.pipeline_breakdown.sql_batched_state_read.p50} ms`);
    console.log(`  History Page 1 (limit 20):      p50 = ${scaleResult.history_page1_20_limit.p50} ms | p95 = ${scaleResult.history_page1_20_limit.p95} ms`);
    console.log(`  History Page 2 (limit 20):      p50 = ${scaleResult.history_page2_20_limit.p50} ms | p95 = ${scaleResult.history_page2_20_limit.p95} ms`);

    db.close();
  }

  // Adversarial Benchmark: 500-card set hashing
  {
    console.log("\n--------------------------------------------------------------------------------");
    console.log("Measuring adversarial 500-card set JSON parse, canonicalization, and hashing...");
    const raw500 = generateCards("Adversarial500", 500);
    const json500 = JSON.stringify(raw500);

    const hashTimings = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const parsed = parseSavedCards(json500);
      deriveCardVersion("mat-adv-500", parsed.cards);
      hashTimings.push(performance.now() - t0);
    }
    const advStats = stats(hashTimings);
    benchmarkResults.adversarial_500_card_hashing = advStats;
    console.log(`500-Card Full Pipeline: p50 = ${advStats.p50} ms | p95 = ${advStats.p95} ms | max = ${advStats.max} ms`);
  }

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
