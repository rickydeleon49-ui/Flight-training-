import {
  MATERIAL_TYPE_LABELS,
  PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  TOPIC_LABELS,
  type MaterialType,
  type Priority,
  type ReviewStatus,
  type StudyMaterial,
  type Topic,
} from "@/domain/types";
import { newId } from "@/lib/id";
import { nowIso } from "@/lib/dates";
import {
  toEnum,
  toNullableNumber,
  toNullableText,
  toText,
  type MaterialSaveOperation,
  type SqlValue,
} from "./db";

/**
 * Normalize and deduplicate tags:
 * - Trims whitespace
 * - Drops empty strings
 * - Deduplicates while preserving first occurrence order and case
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

interface StoredRow {
  id: unknown;
  title: unknown;
  material_type: unknown;
  topic: unknown;
  review_status: unknown;
  priority: unknown;
  goal_id: unknown;
  event_id: unknown;
  notes: unknown;
  file_path: unknown;
  original_file_name: unknown;
  file_size: unknown;
  created_at: unknown;
  updated_at: unknown;
  last_reviewed_at: unknown;
}

function mapRow(row: Record<string, unknown>, tags: string[]): StudyMaterial {
  const r = row as unknown as StoredRow;
  return {
    id: toText(r.id),
    title: toText(r.title),
    materialType: toEnum<MaterialType>(r.material_type, MATERIAL_TYPE_LABELS, "study_guide"),
    topic: toEnum<Topic>(r.topic, TOPIC_LABELS, "general"),
    reviewStatus: toEnum<ReviewStatus>(r.review_status, REVIEW_STATUS_LABELS, "needs_review"),
    priority: toEnum<Priority>(r.priority, PRIORITY_LABELS, "later"),
    goalId: toNullableText(r.goal_id),
    eventId: toNullableText(r.event_id),
    notes: toText(r.notes),
    filePath: toNullableText(r.file_path),
    originalFileName: toNullableText(r.original_file_name),
    fileSize: toNullableNumber(r.file_size),
    createdAt: toText(r.created_at),
    updatedAt: toText(r.updated_at),
    lastReviewedAt: toNullableText(r.last_reviewed_at),
    tags,
  };
}

type Run = (sql: string, params: SqlValue[]) => Promise<void> | void;
type Query = (
  sql: string,
  params: SqlValue[],
) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

/**
 * Link a material to each (already normalized) tag name, the same way the
 * native `link_material_tags` does: resolve by the unique name, create a row
 * only for a new name with a plain INSERT (a collision fails the save rather
 * than being ignored), and read the links back so only stored tags can be
 * acknowledged.
 */
async function linkMaterialTags(
  run: Run,
  query: Query,
  materialId: string,
  tags: string[],
  createdAt: string,
): Promise<void> {
  for (const tag of tags) {
    const existing = await query("SELECT id FROM tags WHERE name = ?", [tag]);
    let tagId = existing[0] ? String(existing[0].id) : null;
    if (!tagId) {
      const id = newId();
      await run("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)", [id, tag, createdAt]);
      const created = await query("SELECT id FROM tags WHERE id = ? AND name = ?", [id, tag]);
      if (!created[0]) throw new Error(`Could not save the tag "${tag}".`);
      tagId = id;
    }
    await run("INSERT INTO material_tags (material_id, tag_id) VALUES (?, ?)", [materialId, tagId]);
  }
  const stored = await query(
    "SELECT t.name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.material_id = ?",
    [materialId],
  );
  const storedNames = new Set(stored.map((row) => String(row.name)));
  if (storedNames.size !== tags.length || tags.some((tag) => !storedNames.has(tag))) {
    throw new Error("The saved tags did not match the requested tags.");
  }
}

/**
 * Execute a material save (create or update) within a single immediate SQLite transaction.
 * Shared across node:sqlite (tests) and sql.js (plain browser).
 */
export async function executeMaterialSave(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[],
  operation: MaterialSaveOperation,
  timestamp: string = nowIso(),
): Promise<StudyMaterial> {
  await exec("BEGIN IMMEDIATE");
  try {
    const result = await (operation.mode === "create"
      ? handleCreate(run, query, operation, timestamp)
      : handleUpdate(run, query, operation, timestamp));
    await exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Saving study material failed and the database rollback also failed.",
      );
    }
    throw error;
  }
}

async function handleCreate(
  run: Run,
  query: Query,
  operation: MaterialSaveOperation,
  timestamp: string,
): Promise<StudyMaterial> {
  const existing = await query("SELECT id FROM study_materials WHERE id = ?", [operation.id]);
  if (existing.length > 0) {
    throw new Error(`A study material with id "${operation.id}" already exists.`);
  }

  const title = (operation.fields.title ?? "").trim();
  if (!title) {
    throw new Error("Title is required.");
  }

  const createdAt = operation.createdAt ?? timestamp;
  const updatedAt = operation.updatedAt ?? timestamp;
  const materialType = operation.fields.materialType ?? "study_guide";
  const topic = operation.fields.topic ?? "general";
  const reviewStatus = operation.fields.reviewStatus ?? "needs_review";
  const priority = operation.fields.priority ?? "later";
  const goalId = operation.fields.goalId ?? null;
  const eventId = operation.fields.eventId ?? null;
  const notes = operation.fields.notes ?? "";
  const filePath = operation.fields.filePath ?? null;
  const originalFileName = operation.fields.originalFileName ?? null;
  const fileSize = operation.fields.fileSize ?? null;
  const lastReviewedAt = operation.fields.lastReviewedAt ?? null;

  await run(
    `INSERT INTO study_materials (
       id, title, material_type, topic, review_status, priority,
       goal_id, event_id, notes, file_path, original_file_name, file_size,
       created_at, updated_at, last_reviewed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      operation.id,
      title,
      materialType,
      topic,
      reviewStatus,
      priority,
      goalId,
      eventId,
      notes,
      filePath,
      originalFileName,
      fileSize,
      createdAt,
      updatedAt,
      lastReviewedAt,
    ],
  );

  const tags = normalizeTags(operation.tags ?? []);
  await linkMaterialTags(run, query, operation.id, tags, createdAt);

  return {
    id: operation.id,
    title,
    materialType,
    topic,
    reviewStatus,
    priority,
    goalId,
    eventId,
    notes,
    filePath,
    originalFileName,
    fileSize,
    createdAt,
    updatedAt,
    lastReviewedAt,
    tags,
  };
}

async function handleUpdate(
  run: Run,
  query: Query,
  operation: MaterialSaveOperation,
  timestamp: string,
): Promise<StudyMaterial> {
  const existingRows = await query("SELECT * FROM study_materials WHERE id = ?", [operation.id]);
  const existingRow = existingRows[0];
  if (!existingRow) {
    throw new Error("That study material no longer exists.");
  }

  const fields = operation.fields;

  let title: string;
  if (fields.title !== undefined) {
    const trimmed = (fields.title ?? "").trim();
    if (!trimmed) {
      throw new Error("Title is required.");
    }
    title = trimmed;
  } else {
    title = toText(existingRow.title);
  }

  const materialType =
    fields.materialType !== undefined ? fields.materialType : (existingRow.material_type as SqlValue);
  const topic = fields.topic !== undefined ? fields.topic : (existingRow.topic as SqlValue);
  const reviewStatus =
    fields.reviewStatus !== undefined ? fields.reviewStatus : (existingRow.review_status as SqlValue);
  const priority = fields.priority !== undefined ? fields.priority : (existingRow.priority as SqlValue);
  const goalId = fields.goalId !== undefined ? fields.goalId : (existingRow.goal_id as SqlValue);
  const eventId = fields.eventId !== undefined ? fields.eventId : (existingRow.event_id as SqlValue);
  const notes = fields.notes !== undefined ? fields.notes : (existingRow.notes as SqlValue);
  const filePath = fields.filePath !== undefined ? fields.filePath : (existingRow.file_path as SqlValue);
  const originalFileName =
    fields.originalFileName !== undefined
      ? fields.originalFileName
      : (existingRow.original_file_name as SqlValue);
  const fileSize = fields.fileSize !== undefined ? fields.fileSize : (existingRow.file_size as SqlValue);
  const lastReviewedAt =
    fields.lastReviewedAt !== undefined
      ? fields.lastReviewedAt
      : (existingRow.last_reviewed_at as SqlValue);
  const createdAt = String(existingRow.created_at); // Preserve existing createdAt
  const updatedAt = operation.updatedAt ?? timestamp;

  await run(
    `UPDATE study_materials SET
       title = ?, material_type = ?, topic = ?, review_status = ?, priority = ?,
       goal_id = ?, event_id = ?, notes = ?, file_path = ?, original_file_name = ?,
       file_size = ?, updated_at = ?, last_reviewed_at = ?
     WHERE id = ?`,
    [
      title,
      materialType,
      topic,
      reviewStatus,
      priority,
      goalId,
      eventId,
      notes,
      filePath,
      originalFileName,
      fileSize,
      updatedAt,
      lastReviewedAt,
      operation.id,
    ],
  );

  let finalTags: string[];
  if (operation.tags !== undefined) {
    finalTags = normalizeTags(operation.tags);
    await run("DELETE FROM material_tags WHERE material_id = ?", [operation.id]);
    await linkMaterialTags(run, query, operation.id, finalTags, updatedAt);
  } else {
    const tagRows = await query(
      `SELECT t.name
         FROM material_tags mt
         JOIN tags t ON t.id = mt.tag_id
        WHERE mt.material_id = ?
        ORDER BY t.name`,
      [operation.id],
    );
    finalTags = tagRows.map((r) => String(r.name));
  }

  const updatedRow: Record<string, unknown> = {
    ...existingRow,
    id: operation.id,
    title,
    material_type: materialType,
    topic,
    review_status: reviewStatus,
    priority,
    goal_id: goalId,
    event_id: eventId,
    notes,
    file_path: filePath,
    original_file_name: originalFileName,
    file_size: fileSize,
    created_at: createdAt,
    updated_at: updatedAt,
    last_reviewed_at: lastReviewedAt,
  };

  return mapRow(updatedRow, finalTags);
}

/**
 * Insert every PDF part and its tags in one immediate transaction — the
 * node:sqlite and sql.js counterpart of the native `save_split_materials`.
 * Like the native batch, tag names are trimmed and blanks skipped, but not
 * de-duplicated: a repeated name fails the batch rather than being dropped.
 */
export async function executeMaterialsBatch(
  exec: (sql: string) => Promise<void> | void,
  run: Run,
  query: Query,
  materials: StudyMaterial[],
): Promise<void> {
  await exec("BEGIN IMMEDIATE");
  try {
    for (const material of materials) {
      await run(
        `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority,
           goal_id, event_id, notes, file_path, original_file_name, file_size,
           created_at, updated_at, last_reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          material.id, material.title, material.materialType, material.topic,
          material.reviewStatus, material.priority, material.goalId, material.eventId,
          material.notes, material.filePath, material.originalFileName, material.fileSize,
          material.createdAt, material.updatedAt, material.lastReviewedAt,
        ],
      );
      const tags = material.tags.map((tag) => tag.trim()).filter(Boolean);
      await linkMaterialTags(run, query, material.id, tags, material.createdAt);
    }
    await exec("COMMIT");
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Saving PDF parts failed and the database rollback also failed.",
      );
    }
    throw error;
  }
}
