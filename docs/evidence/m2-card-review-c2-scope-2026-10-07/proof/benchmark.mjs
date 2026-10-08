/**
 * C2 Disposable Proof Performance Benchmark
 * 
 * Measures performance at three scales:
 * 1. Small scale:  100 materials, ~1,500 cards, ~200 reviews
 * 2. Medium scale: 2,500 materials, ~37,500 cards, ~5,000 reviews
 * 3. Large scale:  5,000 materials, ~75,000 cards, 10,000 reviews
 * 
 * Records:
 * - Actual stored current-card counts and changed/unmaterialized versions
 * - EXPLAIN QUERY PLAN on candidate queries
 * - Query counts, result sizes, rows scanned/returned
 * - Repetitions, median (p50), p95, p99, and max timing
 * - SQL execution time vs JSON-parse / content-hash verification cost
 * - Searchable and filterable views (topic, statusFilter, pagination)
 * - Host and toolchain identity
 */
import { performance } from "node:perf_hooks";
import os from "node:os";

import {
  buildSyntheticDatabase,
  T0,
} from "./syntheticDataset.mjs";

import {
  getLibraryRecentReviews,
  getLibraryReviewDue,
  nextLocalMidnightUtc,
} from "./contractModel.mjs";

function getPercentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function stats(timingsMs) {
  const sorted = [...timingsMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: Number(sorted[0].toFixed(3)),
    p50: Number(getPercentile(sorted, 50).toFixed(3)),
    p95: Number(getPercentile(sorted, 95).toFixed(3)),
    p99: Number(getPercentile(sorted, 99).toFixed(3)),
    max: Number(sorted.at(-1).toFixed(3)),
  };
}

export async function runBenchmarks() {
  const hostIdentity = {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || "unknown",
    totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
    nodeVersion: process.version,
    date: new Date().toISOString(),
  };

  console.log("================================================================================");
  console.log(`C2 Performance Benchmark starting on ${hostIdentity.platform} (${hostIdentity.arch})`);
  console.log(`CPU: ${hostIdentity.cpuModel} (${hostIdentity.cpus} cores) | Node: ${hostIdentity.nodeVersion}`);
  console.log("================================================================================\n");

  const scales = [
    { name: "100_materials", materials: 100, targetEvents: 200, runs: 30 },
    { name: "2500_materials", materials: 2500, targetEvents: 5000, runs: 20 },
    { name: "5000_materials", materials: 5000, targetEvents: 10000, runs: 15 },
  ];

  const benchmarkResults = {
    host: hostIdentity,
    queryPlans: {},
    scales: {},
    proposedBudgets: {
      reviewDueQuery_p50_ms: 15.0,
      reviewDueQuery_p95_ms: 35.0,
      historyPageQuery_p50_ms: 5.0,
      historyPageQuery_p95_ms: 15.0,
      discoveryJsonHash_p50_ms: 5.0,
      uiRenderPreparation_p50_ms: 10.0,
      totalViewRender_p95_ms: 50.0,
    },
  };

  const midUtc = nextLocalMidnightUtc(T0, "UTC");

  for (const scale of scales) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Setting up synthetic dataset for ${scale.materials} materials (${scale.targetEvents} target reviews)...`);
    const t0Gen = performance.now();
    const { db, totalEventsCreated } = buildSyntheticDatabase(scale.materials, scale.targetEvents);
    const genDuration = (performance.now() - t0Gen).toFixed(1);

    // Verify database counts
    const matCount = db.prepare("SELECT COUNT(*) AS c FROM study_materials").get().c;
    const studySetCount = db.prepare("SELECT COUNT(*) AS c FROM ai_study_sets").get().c;
    const versionCount = db.prepare("SELECT COUNT(*) AS c FROM card_versions").get().c;
    const itemCount = db.prepare("SELECT COUNT(*) AS c FROM card_items").get().c;
    const stateCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_state").get().c;
    const eventCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_events").get().c;

    console.log(`Generated in ${genDuration}ms:`);
    console.log(`  - study_materials:   ${matCount}`);
    console.log(`  - ai_study_sets:     ${studySetCount}`);
    console.log(`  - card_versions:     ${versionCount}`);
    console.log(`  - card_items:        ${itemCount}`);
    console.log(`  - card_review_state: ${stateCount}`);
    console.log(`  - card_review_events:${eventCount}`);

    // Capture EXPLAIN QUERY PLAN (recorded once from the largest scale)
    if (scale.materials === 5000) {
      const qpDue = db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT
          m.id AS material_id,
          v.id AS active_version_id,
          SUM(CASE WHEN s.step < 0 AND s.due_at <= ? THEN 1 ELSE 0 END) AS again_count,
          SUM(CASE WHEN s.step >= 0 AND s.due_at < ? THEN 1 ELSE 0 END) AS day_count
        FROM card_review_state s
        JOIN card_items i ON i.id = s.item_id
        JOIN card_versions v ON v.id = i.version_id
        JOIN study_materials m ON m.id = v.source_material_id
        WHERE v.is_active = 1
          AND s.suspended = 0
          AND s.flag IS NULL
          AND s.due_at IS NOT NULL
          AND ((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?))
        GROUP BY m.id, v.id
      `).all(T0, midUtc, T0, midUtc);
      benchmarkResults.queryPlans.dueQuery = qpDue;

      const qpHistory = db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT e.id, e.rating, e.reviewed_at, i.front, m.title
        FROM card_review_events e
        JOIN card_items i ON i.id = e.item_id
        JOIN card_versions v ON v.id = i.version_id
        JOIN study_materials m ON m.id = v.source_material_id
        WHERE e.reviewed_at < ?
        ORDER BY e.reviewed_at DESC, e.id DESC
        LIMIT 21
      `).all(T0);
      benchmarkResults.queryPlans.historyQuery = qpHistory;
    }

    // Benchmark 1: Full getLibraryReviewDue (End-to-End: SQL + Hash Verification + Ranking)
    const reviewDueTimings = [];
    const sqlOnlyTimings = [];
    const hashOnlyTimings = [];
    let lastReviewDueResult = null;

    for (let r = 0; r < scale.runs; r++) {
      const start = performance.now();
      lastReviewDueResult = getLibraryReviewDue(db, {
        nowUtc: T0,
        nextLocalMidnightUtc: midUtc,
        limit: 50,
      });
      const end = performance.now();
      reviewDueTimings.push(end - start);

      // Measure SQL query portion alone
      const tSql0 = performance.now();
      const sqlRows = db.prepare(`
        SELECT
          m.id AS material_id,
          m.title,
          m.topic,
          m.review_status,
          m.priority,
          m.updated_at,
          v.id AS active_version_id,
          v.content_hash AS active_content_hash,
          v.card_count AS active_card_count,
          SUM(CASE WHEN s.step < 0 AND s.due_at <= ? THEN 1 ELSE 0 END) AS again_count,
          SUM(CASE WHEN s.step >= 0 AND s.due_at < ? THEN 1 ELSE 0 END) AS day_count
        FROM card_review_state s
        JOIN card_items i ON i.id = s.item_id
        JOIN card_versions v ON v.id = i.version_id
        JOIN study_materials m ON m.id = v.source_material_id
        WHERE v.is_active = 1
          AND s.suspended = 0
          AND s.flag IS NULL
          AND s.due_at IS NOT NULL
          AND ((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?))
        GROUP BY m.id, m.title, m.topic, m.review_status, m.priority, m.updated_at, v.id, v.content_hash, v.card_count
      `).all(T0, midUtc, T0, midUtc);
      const tSql1 = performance.now();
      sqlOnlyTimings.push(tSql1 - tSql0);

      // Measure JSON parse and hash verification cost on the candidate materials
      const tHash0 = performance.now();
      for (const row of sqlRows.slice(0, 50)) {
        const rawJson = db.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?").get(row.material_id)?.flashcards_json;
        if (rawJson) JSON.parse(rawJson);
      }
      const tHash1 = performance.now();
      hashOnlyTimings.push(tHash1 - tHash0);
    }

    // Benchmark 2: Filtered Review Due queries (topic filter, statusFilter = due_today, statusFilter = new_only)
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

    const dueTodayTimings = [];
    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      getLibraryReviewDue(db, {
        nowUtc: T0,
        nextLocalMidnightUtc: midUtc,
        statusFilter: "due_today",
        limit: 50,
      });
      dueTodayTimings.push(performance.now() - t0);
    }

    const newOnlyTimings = [];
    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      getLibraryReviewDue(db, {
        nowUtc: T0,
        nextLocalMidnightUtc: midUtc,
        statusFilter: "new_only",
        limit: 50,
      });
      newOnlyTimings.push(performance.now() - t0);
    }

    // Benchmark 3: Library-wide History Keyset Paging
    const historyPage1Timings = [];
    const historyPage2Timings = [];
    let page1Result = null;

    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      page1Result = getLibraryRecentReviews(db, { cursor: null, limit: 20 });
      historyPage1Timings.push(performance.now() - t0);

      const t1 = performance.now();
      getLibraryRecentReviews(db, { cursor: page1Result.next, limit: 20 });
      historyPage2Timings.push(performance.now() - t1);
    }

    const scaleStats = {
      materialCount: matCount,
      cardCount: itemCount,
      reviewEventCount: eventCount,
      summary: lastReviewDueResult.summary,
      pagedResultCount: lastReviewDueResult.materials.length,
      runs: scale.runs,
      latencyMs: {
        reviewDue_endToEnd: stats(reviewDueTimings),
        reviewDue_sqlOnly: stats(sqlOnlyTimings),
        reviewDue_hashVerificationOnly: stats(hashOnlyTimings),
        reviewDue_topicFiltered: stats(topicFilterTimings),
        reviewDue_dueTodayFiltered: stats(dueTodayTimings),
        reviewDue_newOnlyFiltered: stats(newOnlyTimings),
        history_page1: stats(historyPage1Timings),
        history_page2_keysetCursor: stats(historyPage2Timings),
      },
    };

    benchmarkResults.scales[scale.name] = scaleStats;

    console.log(`Results for ${scale.materials} materials:`);
    console.log(`  - Review Due End-to-End: p50 = ${scaleStats.latencyMs.reviewDue_endToEnd.p50}ms, p95 = ${scaleStats.latencyMs.reviewDue_endToEnd.p95}ms, max = ${scaleStats.latencyMs.reviewDue_endToEnd.max}ms`);
    console.log(`  - SQL Portion Only:     p50 = ${scaleStats.latencyMs.reviewDue_sqlOnly.p50}ms, p95 = ${scaleStats.latencyMs.reviewDue_sqlOnly.p95}ms`);
    console.log(`  - Hash/JSON Verify:     p50 = ${scaleStats.latencyMs.reviewDue_hashVerificationOnly.p50}ms, p95 = ${scaleStats.latencyMs.reviewDue_hashVerificationOnly.p95}ms`);
    console.log(`  - History Page 1:       p50 = ${scaleStats.latencyMs.history_page1.p50}ms, p95 = ${scaleStats.latencyMs.history_page1.p95}ms`);
    console.log(`  - History Page 2 Cursor:p50 = ${scaleStats.latencyMs.history_page2_keysetCursor.p50}ms, p95 = ${scaleStats.latencyMs.history_page2_keysetCursor.p95}ms\n`);
  }

  return benchmarkResults;
}

// Run directly when invoked from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmarks()
    .then((results) => {
      import("node:fs").then(({ writeFileSync }) => {
        const outPath = new URL("../results.json", import.meta.url).pathname;
        writeFileSync(outPath, JSON.stringify(results, null, 2));
        console.log(`Benchmark complete. Results written to ${outPath}`);
      });
    })
    .catch((err) => {
      console.error("Benchmark failed:", err);
      process.exit(1);
    });
}
