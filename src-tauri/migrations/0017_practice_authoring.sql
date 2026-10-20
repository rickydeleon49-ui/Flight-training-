-- Migration 0017: authoring practice questions she writes herself (OFFLINE-03b round 1).
--
-- Contract: docs/OFFLINE_03B_IMPLEMENTATION_PLAN_2026-10-19.md, as reviewed by
-- Codex with clarifications A–E. Additive only; migrations 0001–0016 stay
-- byte-identical.
--
-- Rules:
-- - retired_json describes the CURRENT test's deletion/correction protection,
--   so it lives on practice_tests — the only mutable current practice row.
--   It is never hidden in append-only history.
-- - logical_id / replaces_id are written only on NEWLY inserted version rows;
--   historical practice_test_items rows stay NULL and are never updated.
--   The deterministic identity of a pre-03b item is its own immutable id
--   (logical_id ?? id), enforced by both authoring engines and the
--   schema-17 validators. These columns carry no CHECK on purpose: the
--   schema-11 contract compares the practice tables' CHECK set against the
--   current reference, so their shapes are enforced in the validated
--   authoring codec and the schema-17 semantics instead.
-- - practice_save_operations holds durable authoring receipts: one row per
--   committed create/edit/correct/regenerate/restore/remove, binding the
--   material, the action and the exact canonical payload bytes plus their
--   recomputable SHA-256 digest. Its only foreign key is the material, so
--   established pruning of versions/items/attempts can never strand a
--   receipt; result_json names the produced version as a historical fact.
--   Origins keep using 0016's practice_item_origins; previous states keep
--   using 0016's study_set_history (kind='practice'), whose row ids are
--   separate UUIDs — history is never overloaded as a receipt.

ALTER TABLE practice_tests ADD COLUMN retired_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE practice_test_items ADD COLUMN logical_id TEXT;
ALTER TABLE practice_test_items ADD COLUMN replaces_id TEXT;

CREATE TABLE IF NOT EXISTS practice_save_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  material_id  TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN ('create','edit','correct','regenerate','restore','remove')),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json  TEXT NOT NULL,
  applied_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_practice_save_ops_material
  ON practice_save_operations(material_id);
