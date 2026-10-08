import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSyntheticDatabase } from "./syntheticDataset.mjs";

const { db } = buildSyntheticDatabase(100, 200);

const queries = [
  {
    name: "Candidate First Query (Page 1)",
    sql: `
      EXPLAIN QUERY PLAN
      SELECT
        m.id AS material_id,
        m.title,
        m.topic,
        m.review_status,
        m.priority,
        m.updated_at
      FROM study_materials m
      JOIN ai_study_sets a ON a.source_material_id = m.id
      WHERE a.flashcards_json IS NOT NULL
        AND a.flashcards_json != '[]'
        AND a.flashcards_json != ''
      ORDER BY
        CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC,
        m.updated_at DESC,
        m.id ASC
      LIMIT 251
    `,
  },
  {
    name: "Candidate Continuation Query (Keyset Pagination)",
    sql: `
      EXPLAIN QUERY PLAN
      SELECT
        m.id AS material_id,
        m.title,
        m.topic,
        m.review_status,
        m.priority,
        m.updated_at
      FROM study_materials m
      JOIN ai_study_sets a ON a.source_material_id = m.id
      WHERE a.flashcards_json IS NOT NULL
        AND a.flashcards_json != '[]'
        AND a.flashcards_json != ''
        AND (
          (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END > 0)
          OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = 0 AND m.updated_at < '2026-10-07T10:00:00.000Z')
          OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = 0 AND m.updated_at = '2026-10-07T10:00:00.000Z' AND m.id > 'mat-01')
        )
      ORDER BY
        CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC,
        m.updated_at DESC,
        m.id ASC
      LIMIT 251
    `,
  },
  {
    name: "Batched Raw Cards Query",
    sql: `
      EXPLAIN QUERY PLAN
      SELECT source_material_id, flashcards_json
      FROM ai_study_sets
      WHERE source_material_id IN ('mat-1', 'mat-2', 'mat-3')
    `,
  },
  {
    name: "Batched Review State Query",
    sql: `
      EXPLAIN QUERY PLAN
      SELECT
        i.version_id,
        s.item_id,
        s.step,
        s.due_at,
        s.suspended,
        s.flag
      FROM card_items i
      JOIN card_review_state s ON s.item_id = i.id
      WHERE i.version_id IN ('ver-1', 'ver-2', 'ver-3')
    `,
  },
  {
    name: "History First Query (Page 1)",
    sql: `
      EXPLAIN QUERY PLAN
      SELECT
        e.id,
        e.item_id,
        e.generation,
        e.rating,
        e.reviewed_at,
        e.scheduler_version,
        e.prior_state_json,
        e.next_state_json,
        i.ordinal,
        i.front,
        i.back,
        i.source_page,
        v.id AS version_id,
        v.content_hash,
        v.created_at AS version_created_at,
        v.source_material_id AS material_id,
        m.title AS material_title
      FROM card_review_events e
      JOIN card_items i ON i.id = e.item_id
      JOIN card_versions v ON v.id = i.version_id
      JOIN study_materials m ON m.id = v.source_material_id
      ORDER BY e.reviewed_at DESC, e.id DESC
      LIMIT 21
    `,
  },
  {
    name: "History Continuation Query (Keyset Pagination)",
    sql: `
      EXPLAIN QUERY PLAN
      SELECT
        e.id,
        e.item_id,
        e.generation,
        e.rating,
        e.reviewed_at,
        e.scheduler_version,
        e.prior_state_json,
        e.next_state_json,
        i.ordinal,
        i.front,
        i.back,
        i.source_page,
        v.id AS version_id,
        v.content_hash,
        v.created_at AS version_created_at,
        v.source_material_id AS material_id,
        m.title AS material_title
      FROM card_review_events e
      JOIN card_items i ON i.id = e.item_id
      JOIN card_versions v ON v.id = i.version_id
      JOIN study_materials m ON m.id = v.source_material_id
      WHERE (e.reviewed_at < '2026-10-07T14:00:00.000Z')
         OR (e.reviewed_at = '2026-10-07T14:00:00.000Z' AND e.id < 'ev-01')
      ORDER BY e.reviewed_at DESC, e.id DESC
      LIMIT 21
    `,
  },
];

let output = "=== C2 EXPLAIN QUERY PLANS (SHIPPED MIGRATIONS 0001-0012 BASELINE) ===\n\n";

for (const q of queries) {
  output += `--------------------------------------------------------------------------------\n`;
  output += `${q.name}\n`;
  output += `--------------------------------------------------------------------------------\n`;
  const planRows = db.prepare(q.sql).all();
  for (const row of planRows) {
    output += `  id=${row.id} parent=${row.parent} notused=${row.notused} detail=${row.detail}\n`;
  }
  output += `\n`;
}

const outPath = resolve(fileURLToPath(import.meta.url), "../../receipts/explain-query-plans.txt");
writeFileSync(outPath, output);
console.log(output);
db.close();
