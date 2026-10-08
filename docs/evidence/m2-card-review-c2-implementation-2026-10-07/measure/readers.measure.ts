/**
 * Actual production statement counts and in-process timings for the C2
 * readers (src/data/cardLibraryReader.ts) on a synthetic 5,000-material /
 * 10,000-event node:sqlite library. Writes measurements.json beside this
 * file. Node/SQLite in-process only: desktop IPC and WebKit rendering are
 * not measured here.
 */
import { writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

import { readLibraryRecentReviews, readLibraryReviewDue, type ReadQuery } from "@/data/cardLibraryReader";
import { cardReviewRepository } from "@/data/repositories/cardReviewRepository";
import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";
import type { CardItemAction } from "@/domain/types";

const OUT = `${process.cwd()}/docs/evidence/m2-card-review-c2-implementation-2026-10-07/measure/measurements.json`;
const T0 = "2026-10-06T15:00:00.000Z";
const DUE = { nowUtc: "2026-10-06T16:00:00.000Z", nextLocalMidnightUtc: "2026-10-07T05:00:00.000Z" };

it("measures production statement counts and timings", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const db = await createNodeSqliteDatabase();
  await db.execute(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 4999)
    INSERT INTO study_materials (id, title, topic, priority, created_at, updated_at)
    SELECT printf('m-%05d', i), printf('Material %05d', i), CASE WHEN i % 4 = 0 THEN 'weather' ELSE 'general' END,
           CASE WHEN i % 10 = 0 THEN 'next_up' ELSE 'later' END, '${T0}',
           strftime('%Y-%m-%dT%H:%M:%fZ', '2026-01-01', '+' || i || ' minutes') FROM n`);
  await db.execute(`INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
    SELECT id, 'Set', '', '[]',
      '[' || (SELECT group_concat(printf('{"front":"%s card %d","back":"Answer %d","sourcePage":null}', s.id, k.k, k.k), ',')
              FROM (WITH RECURSIVE kk(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM kk WHERE k < 11) SELECT k FROM kk) k) || ']',
      '', 'import', '', '${T0}', '${T0}' FROM study_materials s`);
  // Materialize 100 materials through the real C1 path, then 10,000 events on their items.
  const reviews = cardReviewRepository(db);
  for (let i = 0; i < 5000; i += 50) {
    const id = `m-${String(i).padStart(5, "0")}`;
    const snap = await reviews.getCardReviewSnapshot(id);
    if (snap.current.status !== "ok") throw new Error("expected cards");
    const item = snap.current.items[0]!;
    await reviews.saveAction({
      action: "rate", rating: "good", operationId: crypto.randomUUID(), materialId: id, versionContentHash: snap.current.contentHash,
      itemId: item.itemId, expectedGeneration: 0, expectedRevision: 0,
    } as CardItemAction);
  }
  await db.execute(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 9900),
    items AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS k FROM card_items)
    INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
    SELECT printf('e%07d', n.i), items.id, 0, 'good',
           strftime('%Y-%m-%dT%H:%M:%fZ', '2026-09-01', '+' || n.i || ' minutes'), 'simple-v1', 'null', '{"step":0,"schedulerVersion":"simple-v1"}'
    FROM n JOIN items ON items.k = n.i % (SELECT COUNT(*) FROM items)`);
  vi.useRealTimers();

  let statements = 0;
  const query: ReadQuery = (sql, params) => {
    statements += 1;
    return db.select<Record<string, unknown>>(sql, params);
  };
  const measure = async (name: string, run: () => Promise<unknown>, runs = 7) => {
    const times: number[] = [];
    let count = 0;
    let result: unknown;
    for (let r = 0; r < runs; r++) {
      statements = 0;
      const start = performance.now();
      result = await run();
      times.push(performance.now() - start);
      count = statements;
    }
    times.sort((a, b) => a - b);
    return { name, statements: count, medianMs: Number(times[Math.floor(runs / 2)]!.toFixed(2)), result };
  };

  const first = await readLibraryReviewDue(query, DUE);
  const historyFirst = await readLibraryRecentReviews(query, {});
  const rows = [
    await measure("due_first_page", () => readLibraryReviewDue(query, DUE)),
    await measure("due_continuation_page", () => readLibraryReviewDue(query, { ...DUE, cursor: first.nextCursor })),
    await measure("due_status_due_today", () => readLibraryReviewDue(query, { ...DUE, statusFilter: "due_today" })),
    await measure("due_topic_weather", () => readLibraryReviewDue(query, { ...DUE, topic: "weather" })),
    await measure("history_first_page", () => readLibraryRecentReviews(query, {})),
    await measure("history_next_page", () => readLibraryRecentReviews(query, { cursor: historyFirst.next })),
    await measure("history_topic_filter", () => readLibraryRecentReviews(query, { topic: "weather" })),
    await measure("history_enrichment_only", () => readLibraryRecentReviews(query, { enrichmentOnly: true, enrichMaterialIds: ["m-00000", "m-00050"] })),
    await measure("history_combined_page_plus_targets", () => readLibraryRecentReviews(query, { enrichMaterialIds: ["m-00100", "m-00150"] })),
  ];
  let traversalStatements = 0;
  let pages = 0;
  let cursor: string | null = null;
  const start = performance.now();
  do {
    statements = 0;
    const page = await readLibraryReviewDue(query, { ...DUE, cursor });
    traversalStatements += statements;
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor);
  const traversalMs = Number((performance.now() - start).toFixed(2));

  const out = {
    description: "Actual production reader statement counts and in-process medians (7 runs) on node:sqlite; synthetic 5,000 materials x 12 cards, 10,000 rating events. Desktop IPC/WebKit unmeasured.",
    node: process.version,
    calls: rows.map(({ name, statements, medianMs, result }) => ({
      name,
      statements,
      medianMs,
      summary: (result as { summary: unknown }).summary,
    })),
    fullDueTraversal: { pages, statements: traversalStatements, totalMs: traversalMs },
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  expect(pages).toBeGreaterThan(1);
  db.close();
});
