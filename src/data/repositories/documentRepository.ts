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
  type AiStudySet,
  type PracticeQuestion,
  type PracticeTest,
  type StudyFlashcard,
  type StudyAidProvider,
  type StudyGuideSection,
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

interface Row {
  id: string; title: unknown; material_type: unknown; topic: unknown;
  review_status: unknown; priority: unknown; goal_id: unknown; event_id: unknown;
  notes: unknown; file_path: unknown; original_file_name: unknown; file_size: unknown;
  created_at: unknown; updated_at: unknown; last_reviewed_at: unknown;
}

interface AiRow {
  source_material_id: string; title: unknown; summary: unknown;
  sections_json: unknown; flashcards_json: unknown; source_notes: unknown;
  provider: unknown; model: unknown; generated_at: unknown; updated_at: unknown;
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
 * Stored provenance through an allowlist: only "import" is recognized besides
 * the default, so a legacy, malformed or unknown value reads as "gemini".
 */
const toProvider = (value: unknown): StudyAidProvider => (value === "import" ? "import" : "gemini");

const mapAiStudySet = (row: AiRow): AiStudySet => ({
  sourceMaterialId: row.source_material_id,
  title: toText(row.title),
  summary: toText(row.summary),
  sections: jsonArray<StudyGuideSection>(row.sections_json),
  flashcards: jsonArray<StudyFlashcard>(row.flashcards_json),
  sourceNotes: toText(row.source_notes),
  provider: toProvider(row.provider),
  model: toText(row.model),
  generatedAt: toText(row.generated_at),
  updatedAt: toText(row.updated_at),
});

const mapPracticeTest = (row: PracticeTestRow): PracticeTest => ({
  sourceMaterialId: row.source_material_id,
  title: toText(row.title),
  questions: jsonArray<PracticeQuestion>(row.questions_json),
  provider: toProvider(row.provider),
  model: toText(row.model),
  generatedAt: toText(row.generated_at),
  updatedAt: toText(row.updated_at),
});

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

  return {
    async list(): Promise<StudyMaterial[]> {
      const [rows, tags] = await Promise.all([
        db.select<Row>("SELECT * FROM study_materials ORDER BY created_at DESC"),
        tagsByMaterial(),
      ]);
      return rows.map((row) => map(row, tags.get(row.id) ?? []));
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
     * provenance, so regenerated content is never labelled as imported.
     */
    async saveAiStudySet(input: Omit<AiStudySet, "provider" | "generatedAt" | "updatedAt">): Promise<void> {
      const timestamp = nowIso();
      await db.execute(
        `INSERT INTO ai_study_sets
           (source_material_id, title, summary, sections_json, flashcards_json,
            source_notes, provider, model, generated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'gemini', ?, ?, ?)
         ON CONFLICT(source_material_id) DO UPDATE SET
           title = excluded.title, summary = excluded.summary,
           sections_json = excluded.sections_json, flashcards_json = excluded.flashcards_json,
           source_notes = excluded.source_notes, provider = excluded.provider, model = excluded.model,
           generated_at = excluded.generated_at, updated_at = excluded.updated_at`,
        [
          input.sourceMaterialId, input.title, input.summary,
          JSON.stringify(input.sections), JSON.stringify(input.flashcards), input.sourceNotes,
          input.model, timestamp, timestamp,
        ],
      );
    },

    async removeAiStudySet(sourceMaterialId: Id): Promise<void> {
      await db.execute("DELETE FROM ai_study_sets WHERE source_material_id = ?", [sourceMaterialId]);
    },

    async listPracticeTests(): Promise<PracticeTest[]> {
      const rows = await db.select<PracticeTestRow>(
        "SELECT * FROM practice_tests ORDER BY updated_at DESC",
      );
      return rows.map(mapPracticeTest);
    },

    /** Save a Gemini practice test; requires atomic writer support. */
    async savePracticeTest(
      input: Omit<PracticeTest, "provider" | "generatedAt" | "updatedAt">,
    ): Promise<void> {
      if (typeof db.savePracticeTestAtomically !== "function") {
        throw new Error(
          "Atomic practice test persistence requires a database driver with atomic transaction support.",
        );
      }
      await db.savePracticeTestAtomically({
        sourceMaterialId: input.sourceMaterialId,
        title: input.title,
        questions: input.questions,
        model: input.model,
      });
    },

    async removePracticeTest(sourceMaterialId: Id): Promise<void> {
      if (typeof db.removePracticeTestAtomically !== "function") {
        throw new Error(
          "Atomic practice test removal requires a database driver with atomic transaction support.",
        );
      }
      await db.removePracticeTestAtomically(sourceMaterialId);
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
