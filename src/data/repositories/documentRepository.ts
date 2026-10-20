import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  MATERIAL_TYPE_LABELS,
  PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  TOPIC_LABELS,
  type Id,
  type MaterialType,
  type Priority,
  type ReviewStatus,
  type StudyMaterial,
  type SplitBatchCancelResult,
  type SplitBatchReconciliation,
  type SplitBatchSaveResult,
  type SplitLineage,
  type SplitPartPresentation,
  type SplitSourceReceipt,
  type AiStudySet,
  type PracticeAuthoringQuestion,
  type PracticeHistoryEntry,
  type PracticeQuestion,
  type PracticeRetirementRecord,
  type PracticeSaveResult,
  type PracticeSaveOperation,
  type PracticeSnapshot,
  type PracticeTest,
  type StudyFlashcard,
  type StudyGuideSection,
  type StudyItemOrigin,
  type StudySetProvider,
  type RetiredStudyItem,
  type Topic,
} from "@/domain/types";
import {
  toEnum,
  toNullableNumber,
  toNullableText,
  toText,
  type NativeImportSaveResult,
  type SqlDatabase,
  type StructuredImportSaveOperation,
} from "../db";
import { AtomicPersistenceUnsupportedError } from "../persistenceErrors";
import {
  appendPracticeRetirements,
  practiceRetirementRecord,
  readCurrentSnapshot,
  snapshotFromHistoryRow,
} from "../practiceAuthoring";
import { generatedPage, needsRegenerationReview } from "@/logic/studySetEditing";
import {
  decodeStoredRow,
  SET_COLUMNS,
  validateRetiredList,
  type StoredSetRow,
  type StudySetSaveOperation,
  type StudySetSaveResult,
} from "../studySetTransaction";

interface Row {
  id: string; title: unknown; material_type: unknown; topic: unknown;
  review_status: unknown; priority: unknown; goal_id: unknown; event_id: unknown;
  notes: unknown; file_path: unknown; original_file_name: unknown; file_size: unknown;
  created_at: unknown; updated_at: unknown; last_reviewed_at: unknown;
}

interface LineageRow {
  material_id: string; parent_material_id: unknown; root_material_id: unknown;
  source_page_start: unknown; source_page_end: unknown; parent_page_start: unknown;
  parent_page_end: unknown; child_page_count: unknown; source_file_name: unknown;
  source_title: unknown; source_content_sha256: unknown; source_total_pages: unknown;
  parent_file_name: unknown; parent_title: unknown; parent_content_sha256: unknown;
  parent_total_pages: unknown; nested_level: unknown; created_at: unknown;
}

const toPage = (value: unknown): number => toNullableNumber(value) ?? 0;

const mapLineage = (row: LineageRow): SplitLineage => ({
  materialId: row.material_id,
  parentMaterialId: toNullableText(row.parent_material_id),
  rootMaterialId: toNullableText(row.root_material_id),
  sourcePageStart: toPage(row.source_page_start),
  sourcePageEnd: toPage(row.source_page_end),
  parentPageStart: toNullableNumber(row.parent_page_start),
  parentPageEnd: toNullableNumber(row.parent_page_end),
  childPageCount: toPage(row.child_page_count),
  sourceFileName: toText(row.source_file_name),
  sourceTitle: toText(row.source_title),
  sourceContentSha256: toNullableText(row.source_content_sha256),
  sourceTotalPages: toNullableNumber(row.source_total_pages),
  parentFileName: toNullableText(row.parent_file_name),
  parentTitle: toNullableText(row.parent_title),
  parentContentSha256: toNullableText(row.parent_content_sha256),
  parentTotalPages: toNullableNumber(row.parent_total_pages),
  nestedLevel: toPage(row.nested_level),
  createdAt: toText(row.created_at),
});

/** Splitting a PDF reads and writes files, which only the desktop app can do. */
export class SplitNeedsDesktopError extends Error {
  constructor() {
    super("Splitting a PDF needs the desktop app, so nothing was changed.");
    this.name = "SplitNeedsDesktopError";
  }
}

interface AiRow {
  source_material_id: string; title: unknown; summary: unknown;
  sections_json: unknown; flashcards_json: unknown; source_notes: unknown;
  provider: unknown; model: unknown; generated_at: unknown; updated_at: unknown;
  summary_origin?: unknown; retired_json?: unknown;
}

/** One saved earlier version of a study set, newest first. */
export interface StudySetHistoryEntry {
  id: string;
  reason: "edit" | "delete" | "correct" | "regenerate" | "import" | "restore";
  provider: string;
  createdAt: string;
  /** The whole set as it was stored, or null when that entry is damaged. */
  previous: StoredSetRow | null;
}

interface PracticeTestRow {
  source_material_id: string; title: unknown; questions_json: unknown;
  provider: unknown; model: unknown; generated_at: unknown; updated_at: unknown;
}

/**
 * How long to wait before each retry of a save that hit a transient SQLite
 * lock. Three tries beyond the first covers a competing autosave or backup
 * snapshot that releases its own lock quickly; after that the lock is treated
 * as a real failure and reported plainly.
 *
 * These pauses add up to 1.1 s, but they are not the whole wait. On the
 * desktop each try is one native command whose connection first waits out
 * SQLite's five-second `busy_timeout` (measured at about 5.5 s per try on
 * Windows), so a lock that never clears is reported after roughly
 * 4 × 5.5 s + 1.1 s ≈ 23 s. That is deliberate: a brief backup snapshot or
 * autosave clears long before, and nothing is written while waiting. The
 * single-connection browser and test drivers never contend for a lock.
 */
const LOCK_RETRY_DELAYS_MS = [100, 300, 700];

/**
 * SQLite reports lock contention the same way whether it is `BEGIN
 * IMMEDIATE` unable to get a reserved lock or a statement mid-transaction
 * losing one — both surface through the SQL plugin as an error whose message
 * names the SQLite result code or says so directly.
 */
function isTransientLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY|\(code:\s*5\)|cannot start a transaction within a transaction/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockGaveUpError(): Error {
  return new Error(
    "The database was busy, so these parts could not be saved after several tries. " +
      "Close any other window and try again.",
  );
}

function lockGaveUpMaterialError(): Error {
  return new Error(
    "The database was busy, so this study material could not be saved after several tries. " +
      "Close any other window and try again.",
  );
}

function jsonArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(toText(value));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

/**
 * Practice provenance: "manual" (a test she wrote herself) and "import" read
 * back faithfully and are never turned into "gemini"; legacy rows default to
 * it because only Gemini could write them before OFFLINE-03b.
 */
const toPracticeProvider = (value: unknown): StudySetProvider =>
  value === "import" || value === "manual" ? value : "gemini";

/**
 * A study set's provenance: "manual" (her own set) and "import" read back
 * faithfully and are never turned into "gemini"; legacy rows default to it.
 */
const toSetProvider = (value: unknown): StudySetProvider =>
  value === "import" || value === "manual" ? value : "gemini";

const toOrigin = (value: unknown): StudyItemOrigin | null =>
  value === "user" || value === "instructor" ? value : null;

function retiredList(value: unknown): RetiredStudyItem[] {
  try {
    return validateRetiredList(JSON.parse(toText(value) || "[]"));
  } catch {
    // Startup validation refuses a damaged list; editing re-reads strictly.
    return [];
  }
}

const mapAiStudySet = (row: AiRow): AiStudySet => ({
  sourceMaterialId: row.source_material_id,
  title: toText(row.title),
  summary: toText(row.summary),
  summaryOrigin: toOrigin(row.summary_origin),
  sections: jsonArray<StudyGuideSection>(row.sections_json),
  flashcards: jsonArray<StudyFlashcard>(row.flashcards_json),
  sourceNotes: toText(row.source_notes),
  provider: toSetProvider(row.provider),
  retired: retiredList(row.retired_json),
  model: toText(row.model),
  generatedAt: toText(row.generated_at),
  updatedAt: toText(row.updated_at),
});

/** Said if anything tries to replace her own items without the regeneration review. */
export const REVIEW_FIRST_MESSAGE =
  "This study guide has items you wrote, corrected or deleted, so a new one is saved only after you review it. Nothing has been saved.";

/** A stored row, or a history entry, as the set it shows. */
export const storedStudySet = (materialId: Id, row: StoredSetRow): AiStudySet =>
  mapAiStudySet({ source_material_id: materialId, ...row });

const mapPracticeTest = (row: PracticeTestRow): PracticeTest => ({
  sourceMaterialId: row.source_material_id,
  title: toText(row.title),
  questions: jsonArray<PracticeQuestion>(row.questions_json),
  provider: toPracticeProvider(row.provider),
  model: toText(row.model),
  generatedAt: toText(row.generated_at),
  updatedAt: toText(row.updated_at),
});

/**
 * The mirror stores the five content fields only, so a question's real
 * origin comes from the material's active version — the same authoritative
 * rows `readCurrentSnapshot` reads. An origin is copied only onto the mirror
 * question it belongs to (same ordinal, same five fields); when no origin is
 * stored the key stays absent, so legacy and quarantined rows keep their
 * exact mirror output.
 */
function withStoredOrigins(test: PracticeTest, snapshot: PracticeSnapshot | null): PracticeTest {
  if (!snapshot || snapshot.questions.length !== test.questions.length) return test;
  const questions = test.questions.map((question, index) => {
    const stored = snapshot.questions[index]!;
    if (stored.origin === undefined) return question;
    if (
      question.question !== stored.question ||
      question.correctIndex !== stored.correctIndex ||
      question.explanation !== stored.explanation ||
      question.sourcePage !== stored.sourcePage ||
      question.options.length !== stored.options.length ||
      question.options.some((option, position) => option !== stored.options[position])
    ) {
      return question;
    }
    return { ...question, origin: stored.origin };
  });
  return { ...test, questions };
}

const map = (row: Row, tags: string[]): StudyMaterial => ({
  id: row.id,
  title: toText(row.title),
  materialType: toEnum<MaterialType>(row.material_type, MATERIAL_TYPE_LABELS, "study_guide"),
  topic: toEnum<Topic>(row.topic, TOPIC_LABELS, "general"),
  reviewStatus: toEnum<ReviewStatus>(row.review_status, REVIEW_STATUS_LABELS, "needs_review"),
  priority: toEnum<Priority>(row.priority, PRIORITY_LABELS, "later"),
  goalId: toNullableText(row.goal_id),
  eventId: toNullableText(row.event_id),
  notes: toText(row.notes),
  filePath: toNullableText(row.file_path),
  originalFileName: toNullableText(row.original_file_name),
  fileSize: toNullableNumber(row.file_size),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  lastReviewedAt: toNullableText(row.last_reviewed_at),
  tags,
});

export type NewMaterial = Partial<Omit<StudyMaterial, "id" | "createdAt" | "updatedAt">> &
  Pick<StudyMaterial, "title">;

/**
 * Study Library persistence. Files themselves live in the private documents
 * directory; only metadata and a relative path are stored here.
 */
export function documentRepository(db: SqlDatabase) {
  function buildMaterial(input: NewMaterial & { id?: Id }): StudyMaterial {
    const timestamp = nowIso();
    return {
      id: input.id ?? newId(),
      title: input.title,
      materialType: input.materialType ?? "study_guide",
      topic: input.topic ?? "general",
      reviewStatus: input.reviewStatus ?? "needs_review",
      priority: input.priority ?? "later",
      goalId: input.goalId ?? null,
      eventId: input.eventId ?? null,
      notes: input.notes ?? "",
      filePath: input.filePath ?? null,
      originalFileName: input.originalFileName ?? null,
      fileSize: input.fileSize ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastReviewedAt: input.lastReviewedAt ?? null,
      tags: input.tags ?? [],
    };
  }

  async function tagsByMaterial(): Promise<Map<string, string[]>> {
    const rows = await db.select<{ material_id: string; name: string }>(
      `SELECT mt.material_id, t.name
         FROM material_tags mt
         JOIN tags t ON t.id = mt.tag_id
        ORDER BY t.name`,
    );
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const list = grouped.get(row.material_id) ?? [];
      list.push(row.name);
      grouped.set(row.material_id, list);
    }
    return grouped;
  }

  async function readStoredSet(materialId: Id): Promise<StoredSetRow | null> {
    const [row] = await db.select<Record<string, unknown>>(
      `SELECT ${SET_COLUMNS.join(", ")} FROM ai_study_sets WHERE source_material_id = ?`,
      [materialId],
    );
    if (!row) return null;
    return Object.fromEntries(
      SET_COLUMNS.map((column) => [column, row[column] === null || row[column] === undefined ? null : String(row[column])]),
    ) as StoredSetRow;
  }

  async function saveStudySet(operation: StudySetSaveOperation): Promise<StudySetSaveResult> {
    if (typeof db.saveStudySetAtomically !== "function") throw new AtomicPersistenceUnsupportedError();
    return db.saveStudySetAtomically(operation);
  }

  async function lineageByMaterial(): Promise<Map<string, SplitLineage>> {
    const rows = await db.select<LineageRow>("SELECT * FROM material_split_lineage");
    return new Map(rows.map((row) => [row.material_id, mapLineage(row)]));
  }

  return {
    async list(): Promise<StudyMaterial[]> {
      const [rows, tags, lineage] = await Promise.all([
        db.select<Row>("SELECT * FROM study_materials ORDER BY created_at DESC"),
        tagsByMaterial(),
        lineageByMaterial(),
      ]);
      return rows.map((row) => ({
        ...map(row, tags.get(row.id) ?? []),
        lineage: lineage.get(row.id) ?? null,
      }));
    },

    /**
     * Save the parts of a split the desktop splitter recorded (M2 split
     * lineage). The receipt goes back exactly as it was issued; only display
     * text comes from here. A brief lock is retried like `createMany`.
     */
    async saveSplitBatch(
      receipt: SplitSourceReceipt,
      presentation: SplitPartPresentation[],
    ): Promise<SplitBatchSaveResult> {
      if (typeof db.saveSplitBatch !== "function") throw new SplitNeedsDesktopError();
      for (let attempt = 0; ; attempt++) {
        try {
          return await db.saveSplitBatch(receipt, presentation);
        } catch (error) {
          if (!isTransientLockError(error)) throw error;
          if (attempt >= LOCK_RETRY_DELAYS_MS.length) throw lockGaveUpError();
          await delay(LOCK_RETRY_DELAYS_MS[attempt]!);
        }
      }
    },

    /** Cancel a split that was not saved, removing only its own part files. */
    async cancelSplitBatch(operationId: string): Promise<SplitBatchCancelResult> {
      if (typeof db.cancelSplitBatch !== "function") throw new SplitNeedsDesktopError();
      return db.cancelSplitBatch(operationId);
    },

    /** What became of a split, read by its operation id. */
    async reconcileSplitBatch(operationId: string): Promise<SplitBatchReconciliation> {
      if (typeof db.reconcileSplitBatch !== "function") throw new SplitNeedsDesktopError();
      return db.reconcileSplitBatch(operationId);
    },

    /**
     * Current fingerprints of stored documents, or `null` where this cannot be
     * checked (browser mode). Done natively and off the interface thread.
     */
    async fingerprintDocuments(relativePaths: string[]): Promise<Map<string, string | null> | null> {
      if (typeof db.fingerprintStoredDocuments !== "function" || relativePaths.length === 0) {
        return null;
      }
      const results = await db.fingerprintStoredDocuments(relativePaths);
      return new Map(results.map((item) => [item.relativePath, item.sha256]));
    },

    async listTags(): Promise<string[]> {
      const rows = await db.select<{ name: string }>("SELECT name FROM tags ORDER BY name");
      return rows.map((row) => row.name);
    },

    async listAiStudySets(): Promise<AiStudySet[]> {
      const rows = await db.select<AiRow>("SELECT * FROM ai_study_sets ORDER BY updated_at DESC");
      return rows.map(mapAiStudySet);
    },

    /**
     * Save a Gemini study set. Replacing an imported set also replaces its
     * provenance, so regenerated content is never labelled as imported. The
     * set it replaces goes to history first, in the same transaction; what
     * she retired is carried over. A set holding her own items is never
     * replaced here: regeneration reviews it with her first.
     */
    async saveAiStudySet(input: Omit<AiStudySet, "provider" | "generatedAt" | "updatedAt">): Promise<void> {
      const current = await readStoredSet(input.sourceMaterialId);
      if (current && needsRegenerationReview(storedStudySet(input.sourceMaterialId, current))) {
        throw new Error(REVIEW_FIRST_MESSAGE);
      }
      const retired = current ? validateRetiredList(JSON.parse(current.retired_json)) : [];
      await saveStudySet({
        operationId: newId(),
        materialId: input.sourceMaterialId,
        reason: current ? "regenerate" : "create",
        expected: current,
        next: {
          title: input.title,
          summary: input.summary,
          summaryOrigin: null,
          sections: input.sections.map(({ heading, body }) => ({ heading, body })),
          // A page outside the PDF range can't be opened or reviewed; it is kept as no page.
          flashcards: input.flashcards.map(({ front, back, sourcePage }) => ({ front, back, sourcePage: generatedPage(sourcePage) })),
          sourceNotes: input.sourceNotes,
          provider: "gemini",
          model: input.model,
          retired,
        },
      });
    },

    /** Remove a study set; the whole set stays in history until its material is deleted. */
    async removeAiStudySet(sourceMaterialId: Id): Promise<void> {
      const current = await readStoredSet(sourceMaterialId);
      if (!current) return;
      await saveStudySet({ operationId: newId(), materialId: sourceMaterialId, reason: "remove", expected: current, next: null });
    },

    /** The set exactly as stored, to name it as the one a save replaces. */
    readStoredStudySet: readStoredSet,

    /** The set she is about to edit: as stored (for the save) and as shown. */
    async readStudySetForEdit(materialId: Id): Promise<{ stored: StoredSetRow; set: AiStudySet } | null> {
      const stored = await readStoredSet(materialId);
      return stored ? { stored, set: storedStudySet(materialId, stored) } : null;
    },

    /** One atomic study-set save, history first (OFFLINE-03a). */
    saveStudySet,

    /** Earlier versions of a material's study set, newest first. */
    async listStudySetHistory(materialId: Id): Promise<StudySetHistoryEntry[]> {
      const rows = await db.select<{ id: string; reason: string; provider: string; created_at: string; previous_json: string }>(
        `SELECT id, reason, provider, created_at, previous_json FROM study_set_history
          WHERE material_id = ? AND kind = 'study_set' ORDER BY created_at DESC, id DESC`,
        [materialId],
      );
      return rows.map((row) => {
        let previous: StoredSetRow | null = null;
        try {
          previous = decodeStoredRow(JSON.parse(row.previous_json));
        } catch {
          previous = null;
        }
        return {
          id: row.id,
          reason: row.reason as StudySetHistoryEntry["reason"],
          provider: toText(row.provider),
          createdAt: toText(row.created_at),
          previous,
        };
      });
    },

    async listPracticeTests(): Promise<PracticeTest[]> {
      const rows = await db.select<PracticeTestRow>(
        "SELECT * FROM practice_tests ORDER BY updated_at DESC",
      );
      const tests: PracticeTest[] = [];
      for (const row of rows) {
        const test = mapPracticeTest(row);
        const snapshot = await readCurrentSnapshot(
          (sql, params) => db.select(sql, params),
          test.sourceMaterialId,
        );
        tests.push(withStoredOrigins(test, snapshot));
      }
      return tests;
    },

    /** The exact stored state of one material's current test, for authoring callers. */
    async readPracticeSnapshot(materialId: Id): Promise<PracticeSnapshot | null> {
      return readCurrentSnapshot((sql, params) => db.select(sql, params), materialId);
    },

    async savePracticeAuthoring(operation: PracticeSaveOperation): Promise<PracticeSaveResult> {
      if (typeof db.savePracticeAuthoringAtomically !== "function") {
        throw new Error(
          "Atomic practice test persistence requires a database driver with atomic transaction support.",
        );
      }
      return db.savePracticeAuthoringAtomically(operation);
    },

    /** Every saved earlier state of one material's test, newest first. */
    async listPracticeHistory(materialId: Id): Promise<PracticeHistoryEntry[]> {
      const rows = await db.select<{
        id: string; reason: string; provider: string; created_at: string; previous_json: string;
      }>(
        `SELECT id, reason, provider, created_at, previous_json
           FROM study_set_history
          WHERE material_id = ? AND kind = 'practice'
          ORDER BY created_at DESC, id DESC`,
        [materialId],
      );
      return rows.map((row) => ({
        id: row.id,
        reason: row.reason as PracticeHistoryEntry["reason"],
        provider: row.provider,
        createdAt: row.created_at,
        snapshot: snapshotFromHistoryRow(row),
      }));
    },

    /**
     * Save a generated, imported or hand-written practice test through the
     * authoring contract (OFFLINE-03b): the provider is explicit, the exact
     * stored state is the expected snapshot, incoming questions receive fresh
     * logical identities, and any question of hers that this replacement
     * drops is retired with its exact earlier wording first. Requires atomic
     * writer support; there is no fallback.
     */
    async savePracticeTest(
      input: Omit<PracticeTest, "generatedAt" | "updatedAt">,
    ): Promise<PracticeSaveResult> {
      if (typeof db.savePracticeAuthoringAtomically !== "function") {
        throw new Error(
          "Atomic practice test persistence requires a database driver with atomic transaction support.",
        );
      }
      const current = await readCurrentSnapshot((sql, params) => db.select(sql, params), input.sourceMaterialId);
      const questions: PracticeAuthoringQuestion[] = input.questions.map((question) => ({
        question: question.question,
        options: [...question.options],
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        sourcePage: question.sourcePage,
        identity: newId(),
      }));
      const dropped: PracticeRetirementRecord[] = [];
      for (const before of current?.questions ?? []) {
        if (before.origin === undefined) continue;
        dropped.push(await practiceRetirementRecord(before, "deleted"));
      }
      return db.savePracticeAuthoringAtomically({
        operationId: newId(),
        sourceMaterialId: input.sourceMaterialId,
        reason: current ? "regenerate" : "create",
        expected: current,
        next: {
          title: input.title,
          provider: input.provider,
          model: input.model,
          questions,
          retired: appendPracticeRetirements(current?.retired ?? [], dropped),
        },
      });
    },

    async removePracticeTest(sourceMaterialId: Id): Promise<void> {
      if (typeof db.savePracticeAuthoringAtomically !== "function") {
        throw new Error(
          "Atomic practice test removal requires a database driver with atomic transaction support.",
        );
      }
      const current = await readCurrentSnapshot((sql, params) => db.select(sql, params), sourceMaterialId);
      await db.savePracticeAuthoringAtomically({
        operationId: newId(),
        sourceMaterialId,
        reason: "remove",
        expected: current,
        next: null,
      });
    },

    /**
     * Create a material. The id can be supplied so a file can be imported
     * under the material's own id before the row exists.
     */
    async create(input: NewMaterial & { id?: Id }): Promise<StudyMaterial> {
      if (typeof db.saveMaterialAtomically !== "function") {
        throw new Error(
          "Atomic study material saves require a database driver with atomic transaction support.",
        );
      }
      const material = buildMaterial(input);
      const operation: import("../db").MaterialSaveOperation = {
        mode: "create",
        id: material.id,
        fields: {
          title: material.title,
          materialType: material.materialType,
          topic: material.topic,
          reviewStatus: material.reviewStatus,
          priority: material.priority,
          goalId: material.goalId,
          eventId: material.eventId,
          notes: material.notes,
          filePath: material.filePath,
          originalFileName: material.originalFileName,
          fileSize: material.fileSize,
          lastReviewedAt: material.lastReviewedAt,
        },
        tags: material.tags,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
      };

      for (let attempt = 0; ; attempt++) {
        try {
          return await db.saveMaterialAtomically(operation);
        } catch (error) {
          if (!isTransientLockError(error)) throw error;
          if (attempt >= LOCK_RETRY_DELAYS_MS.length) throw lockGaveUpMaterialError();
          await delay(LOCK_RETRY_DELAYS_MS[attempt]!);
        }
      }
    },

    /**
     * Create every PDF part and its tags as one durable database change.
     *
     * Splitting a large PDF finishes its slow file work in Rust *before*
     * this runs — nothing here waits on that — but the transaction below can
     * still land at the same moment as an unrelated autosave or a backup's
     * database snapshot. Both are ordinary, brief operations; the only
     * failure worth retrying is SQLite reporting the file locked, and only a
     * bounded number of times — anything else, or still locked after those
     * tries, is a real failure and is reported as one.
     */
    async createMany(inputs: Array<NewMaterial & { id?: Id }>): Promise<StudyMaterial[]> {
      if (inputs.length === 0) return [];
      // Every driver saves the batch as one operation that owns its connection:
      // the desktop's native command pins one pooled connection, and the
      // single-connection drivers run it under their connection owner. Public
      // BEGIN/INSERT/COMMIT calls could land on different pooled connections,
      // or let another caller's write join (and be rolled back with) the batch.
      if (typeof db.saveMaterialsAtomically !== "function") {
        throw new Error(
          "Atomic study material saves require a database driver with atomic transaction support.",
        );
      }
      const materials = inputs.map(buildMaterial);
      for (let attempt = 0; ; attempt++) {
        try {
          await db.saveMaterialsAtomically(materials);
          return materials;
        } catch (error) {
          if (!isTransientLockError(error)) throw error;
          if (attempt >= LOCK_RETRY_DELAYS_MS.length) throw lockGaveUpError();
          await delay(LOCK_RETRY_DELAYS_MS[attempt]!);
        }
      }
    },

    async update(id: Id, changes: Partial<StudyMaterial>): Promise<void> {
      if (typeof db.saveMaterialAtomically !== "function") {
        throw new Error(
          "Atomic study material saves require a database driver with atomic transaction support.",
        );
      }
      const fields: import("../db").MaterialSaveFields = {};
      if (changes.title !== undefined) fields.title = changes.title;
      if (changes.materialType !== undefined) fields.materialType = changes.materialType;
      if (changes.topic !== undefined) fields.topic = changes.topic;
      if (changes.reviewStatus !== undefined) fields.reviewStatus = changes.reviewStatus;
      if (changes.priority !== undefined) fields.priority = changes.priority;
      if (changes.goalId !== undefined) fields.goalId = changes.goalId;
      if (changes.eventId !== undefined) fields.eventId = changes.eventId;
      if (changes.notes !== undefined) fields.notes = changes.notes;
      if (changes.filePath !== undefined) fields.filePath = changes.filePath;
      if (changes.originalFileName !== undefined) fields.originalFileName = changes.originalFileName;
      if (changes.fileSize !== undefined) fields.fileSize = changes.fileSize;
      if (changes.lastReviewedAt !== undefined) fields.lastReviewedAt = changes.lastReviewedAt;

      const operation: import("../db").MaterialSaveOperation = {
        mode: "update",
        id,
        fields,
        tags: changes.tags,
        updatedAt: nowIso(),
      };

      for (let attempt = 0; ; attempt++) {
        try {
          await db.saveMaterialAtomically(operation);
          return;
        } catch (error) {
          if (!isTransientLockError(error)) throw error;
          if (attempt >= LOCK_RETRY_DELAYS_MS.length) throw lockGaveUpMaterialError();
          await delay(LOCK_RETRY_DELAYS_MS[attempt]!);
        }
      }
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM study_materials WHERE id = ?", [id]);
    },

    /**
     * Save a previewed study packet as a new material with its imported study
     * set and practice test, as one atomic change (Slice B, create-new only).
     *
     * There is no sequential fallback: creating the material, then the set,
     * then the test as separate writes could leave half an import behind, so a
     * driver without the atomic operation refuses instead. A lock that outlasts
     * the native busy timeout comes back as `STORAGE_FAILURE`; the dialog's
     * "Try again" resends the same operation, which is safe because a retry
     * whose stored content matches is `already_saved`.
     */
    async importStudyPacket(operation: StructuredImportSaveOperation): Promise<NativeImportSaveResult> {
      if (typeof db.saveStructuredImportAtomically !== "function") {
        throw new AtomicPersistenceUnsupportedError();
      }
      return db.saveStructuredImportAtomically(operation);
    },
  };
}
