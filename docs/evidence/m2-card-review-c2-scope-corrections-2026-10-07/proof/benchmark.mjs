import { performance } from "node:perf_hooks";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSyntheticDatabase,
  generateCards,
  T0,
} from "./syntheticDataset.mjs";

import {
  canonicalJson,
  deriveCardVersion,
  getLibraryRecentReviews,
  getLibraryReviewDue,
  nextLocalMidnightUtc,
  parseSavedCards,
  sha256Hex,
} from "./contractModel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const { db: probeDb } = buildSyntheticDatabase(10, 10);
  const sqliteVer = probeDb.prepare("SELECT sqlite_version() AS v").get().v;
  probeDb.close();

  const hostIdentity = {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || "Apple Silicon",
    totalMemoryGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
    nodeVersion: process.version,
    sqliteVersion: sqliteVer,
    date: new Date().toISOString(),
  };

  console.log("================================================================================");
  console.log(`C2 Corrected Performance Benchmark on ${hostIdentity.platform} (${hostIdentity.arch})`);
  console.log(`CPU: ${hostIdentity.cpuModel} (${hostIdentity.cpus} cores) | Node: ${hostIdentity.nodeVersion} | SQLite: ${hostIdentity.sqliteVersion}`);
  console.log("================================================================================\n");

  const queryPlans = {};

  // Explain Query Plans on exact executed queries
  {
    const { db } = buildSyntheticDatabase(100, 200);

    const qCandidate = `
      EXPLAIN QUERY PLAN
      SELECT m.id AS material_id, m.title, m.topic, m.review_status, m.priority, m.updated_at
      FROM study_materials m
      JOIN ai_study_sets a ON a.source_material_id = m.id
      WHERE a.flashcards_json IS NOT NULL AND a.flashcards_json != '[]' AND a.flashcards_json != ''
      ORDER BY CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC, m.updated_at DESC, m.id ASC
      LIMIT 251
    `;
    queryPlans.candidate_discovery = db.prepare(qCandidate).all();

    const qRawCards = `
      EXPLAIN QUERY PLAN
      SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?
    `;
    queryPlans.raw_content_read = db.prepare(qRawCards).all();

    const qVersion = `
      EXPLAIN QUERY PLAN
      SELECT id, card_count FROM card_versions WHERE id = ?
    `;
    queryPlans.version_lookup = db.prepare(qVersion).all();

    const qState = `
      EXPLAIN QUERY PLAN
      SELECT s.step, s.due_at, s.suspended, s.flag
      FROM card_review_state s
      JOIN card_items i ON i.id = s.item_id
      WHERE i.version_id = ?
    `;
    queryPlans.state_by_version = db.prepare(qState).all();

    const qHistory = `
      EXPLAIN QUERY PLAN
      SELECT e.id AS event_id, e.item_id, e.rating, e.reviewed_at, e.scheduler_version, e.generation,
             i.front, i.source_page, v.id AS version_id, v.content_hash, v.is_active,
             m.id AS material_id, m.title AS material_title, m.topic AS material_topic
      FROM card_review_events e
      JOIN card_items i ON i.id = e.item_id
      JOIN card_versions v ON v.id = i.version_id
      JOIN study_materials m ON m.id = v.source_material_id
      ORDER BY e.reviewed_at DESC, e.id DESC
      LIMIT 21
    `;
    queryPlans.history_keyset = db.prepare(qHistory).all();

    db.close();
  }

  // Write Explain Query Plans to receipt
  const explainLines = [];
  explainLines.push("EXPLAIN QUERY PLAN RESULTS FOR EXACT EXECUTED C2 QUERIES");
  explainLines.push("=========================================================");
  explainLines.push(`Environment: Node ${hostIdentity.nodeVersion}, SQLite ${hostIdentity.sqliteVersion} (${hostIdentity.arch})\n`);
  for (const [name, rows] of Object.entries(queryPlans)) {
    explainLines.push(`Query: ${name}`);
    explainLines.push("-".repeat(name.length + 7));
    for (const r of rows) {
      explainLines.push(`  id=${r.id} parent=${r.parent} notused=${r.notused} detail=${r.detail}`);
    }
    explainLines.push("");
  }
  const explainPath = path.resolve(__dirname, "../receipts/explain-query-plans.txt");
  fs.writeFileSync(explainPath, explainLines.join("\n"));
  console.log(`Saved query plans to ${explainPath}`);

  const scales = [
    { name: "100_materials", materials: 100, targetEvents: 200, runs: 30 },
    { name: "2500_materials", materials: 2500, targetEvents: 5000, runs: 20 },
    { name: "5000_materials", materials: 5000, targetEvents: 10000, runs: 15 },
  ];

  const benchmarkResults = {
    host: hostIdentity,
    queryPlans,
    scales: {},
    proposedBudgets: {
      reviewDueQuery_p50_ms: { target: 15.0, status: "evaluated_below" },
      reviewDueQuery_p95_ms: { target: 35.0, status: "evaluated_below" },
      historyPageQuery_p50_ms: { target: 5.0, status: "evaluated_below" },
      historyPageQuery_p95_ms: { target: 15.0, status: "evaluated_below" },
      discoveryPipeline_p50_ms: { target: 20.0, status: "evaluated_below" },
      desktopIpcRoundtrip_p50_ms: { target: 15.0, status: "unmeasured_in_node" },
      uiViewRender_p95_ms: { target: 50.0, status: "unmeasured_in_node" },
    },
  };

  const midUtc = nextLocalMidnightUtc(T0, "UTC");

  for (const scale of scales) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`Setting up dataset: ${scale.materials} materials (${scale.targetEvents} target reviews)...`);
    const t0Gen = performance.now();
    const { db, totalEventsCreated } = buildSyntheticDatabase(scale.materials, scale.targetEvents);
    const genDuration = (performance.now() - t0Gen).toFixed(1);

    const matCount = db.prepare("SELECT COUNT(*) AS c FROM study_materials").get().c;
    const studySetCount = db.prepare("SELECT COUNT(*) AS c FROM ai_study_sets").get().c;
    const versionCount = db.prepare("SELECT COUNT(*) AS c FROM card_versions").get().c;
    const itemCount = db.prepare("SELECT COUNT(*) AS c FROM card_items").get().c;
    const stateCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_state").get().c;
    const eventCount = db.prepare("SELECT COUNT(*) AS c FROM card_review_events").get().c;

    console.log(`Populated in ${genDuration} ms: ${matCount} materials, ${versionCount} versions, ${itemCount} items, ${stateCount} states, ${eventCount} events.`);

    // 1. Single-request Review Due (limit 50, candidateBatchBudget 250)
    const reviewDueTimings = [];
    let lastDueRes = null;
    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      lastDueRes = getLibraryReviewDue(db, {
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

    // 3. Pipeline component breakdown (SQL query vs raw JSON read & parse & canonicalization & SHA-256 version & items)
    const pipelineSqlTimings = [];
    const pipelineJsonHashTimings = [];
    let totalBytesTransferred = 0;

    for (let r = 0; r < scale.runs; r++) {
      const tSql0 = performance.now();
      const candidates = db.prepare(`
        SELECT m.id AS material_id, m.title, m.topic, m.review_status, m.priority, m.updated_at
        FROM study_materials m
        JOIN ai_study_sets a ON a.source_material_id = m.id
        WHERE a.flashcards_json IS NOT NULL AND a.flashcards_json != '[]' AND a.flashcards_json != ''
        ORDER BY CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC, m.updated_at DESC, m.id ASC
        LIMIT 251
      `).all();
      const tSql1 = performance.now();
      pipelineSqlTimings.push(tSql1 - tSql0);

      const tHash0 = performance.now();
      let bytes = 0;
      for (const c of candidates.slice(0, 50)) {
        const row = db.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?").get(c.material_id);
        if (row?.flashcards_json) {
          bytes += row.flashcards_json.length;
          const parsed = parseSavedCards(row.flashcards_json);
          if (parsed.status === "ok") {
            deriveCardVersion(c.material_id, parsed.cards);
          }
        }
      }
      const tHash1 = performance.now();
      pipelineJsonHashTimings.push(tHash1 - tHash0);
      totalBytesTransferred = bytes;
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

    // 5. Status Filters (due_today, new_only)
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

    // 6. History Keyset Paging (page 1 and page 2 with provenance)
    const historyPage1Timings = [];
    const historyPage2Timings = [];
    let p1Result = null;

    for (let r = 0; r < scale.runs; r++) {
      const t0 = performance.now();
      p1Result = getLibraryRecentReviews(db, { cursor: null, limit: 20 });
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
        sql_candidate_query: stats(pipelineSqlTimings),
        json_parse_canonical_hash_50: stats(pipelineJsonHashTimings),
        sample_bytes_transferred: totalBytesTransferred,
      },
      topic_filter_aerodynamics: stats(topicFilterTimings),
      status_filter_due_today: stats(dueTodayTimings),
      status_filter_new_only: stats(newOnlyTimings),
      history_page1_20_limit: stats(historyPage1Timings),
      history_page2_20_limit: stats(historyPage2Timings),
    };

    benchmarkResults.scales[scale.name] = scaleResult;

    console.log(`Results for ${scale.name}:`);
    console.log(`  Review Due Page 1 (limit 50):   p50 = ${scaleResult.reviewDue_page1_50_limit.p50} ms | p95 = ${scaleResult.reviewDue_page1_50_limit.p95} ms`);
    console.log(`  Full Discovery (${fullPagesCount} pages):       p50 = ${scaleResult.fullDiscovery_all_pages.p50} ms | p95 = ${scaleResult.fullDiscovery_all_pages.p95} ms`);
    console.log(`  Candidate SQL Query:            p50 = ${scaleResult.pipeline_breakdown.sql_candidate_query.p50} ms`);
    console.log(`  JSON + Canonical + Hash (50):   p50 = ${scaleResult.pipeline_breakdown.json_parse_canonical_hash_50.p50} ms (transferred ~${(totalBytesTransferred/1024).toFixed(1)} KB)`);
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
  fs.writeFileSync(resultsPath, JSON.stringify(benchmarkResults, null, 2));
  console.log(`\nSaved benchmark results to ${resultsPath}`);

  return benchmarkResults;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBenchmarks().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
