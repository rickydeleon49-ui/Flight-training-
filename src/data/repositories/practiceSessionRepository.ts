/**
 * Repository for Practice Sessions (M2 PR 1).
 *
 * Provides typed access to:
 * - Session state mutations (start_or_resume, record_response, complete_attempt, retake_attempt, abandon_attempt)
 * - Current in-progress attempt retrieval
 * - Specific attempt lookup
 * - Completed history lookup by historyKey (ordered newest completed first)
 * - Active test version and items lookup
 * - Legacy conversion status lookup
 */
import type {
  CompletedHistoryItem,
  PracticeAttempt,
  PracticeAttemptStatus,
  PracticeResponse,
  PracticeSessionAction,
  PracticeSessionActionResult,
  PracticeSessionResponseSummary,
  PracticeSessionState,
  PracticeTestItem,
  PracticeTestVersion,
} from "@/domain/types";
import type { SqlDatabase } from "../db";

export interface PracticeSessionRepository {
  saveSessionAction(action: PracticeSessionAction): Promise<PracticeSessionActionResult>;
  getCurrentAttempt(materialId: string): Promise<PracticeSessionState | null>;
  getAttempt(attemptId: string): Promise<PracticeAttempt | null>;
  getCompletedHistory(historyKey: string): Promise<CompletedHistoryItem[]>;
  getActiveVersion(materialId: string): Promise<{ version: PracticeTestVersion; items: PracticeTestItem[] } | null>;
  getVersion(versionId: string): Promise<PracticeTestVersion | null>;
  getItems(versionId: string): Promise<PracticeTestItem[]>;
  getResponses(attemptId: string): Promise<PracticeResponse[]>;
  getConversionStatus(materialId: string): Promise<{ legacyMigratedAt: string | null; legacyError: string | null } | null>;
}

export function practiceSessionRepository(db: SqlDatabase): PracticeSessionRepository {
  return {
    async saveSessionAction(action: PracticeSessionAction): Promise<PracticeSessionActionResult> {
      if (typeof db.savePracticeSessionAtomically !== "function") {
        throw new Error("Practice session mutations require a database driver with atomic transaction support.");
      }
      return db.savePracticeSessionAtomically(action);
    },

    async getCurrentAttempt(materialId: string): Promise<PracticeSessionState | null> {
      const attempts = await db.select<{
        id: string;
        version_id: string;
        started_at: string;
        total_questions: number;
        answered_count: number;
        revision: number;
      }>(
        `SELECT id, version_id, started_at, total_questions, answered_count, revision
         FROM practice_attempts
         WHERE source_material_id = ? AND status = 'in_progress'`,
        [materialId],
      );

      const attempt = attempts[0];
      if (!attempt) return null;

      const responsesRaw = await db.select<{
        item_id: string;
        selected_index: number | null;
        is_dont_know: number;
        is_correct: number;
        answered_at: string;
      }>(
        `SELECT item_id, selected_index, is_dont_know, is_correct, answered_at
         FROM practice_responses
         WHERE attempt_id = ?
         ORDER BY answered_at ASC, id ASC`,
        [attempt.id],
      );

      const responses: PracticeSessionResponseSummary[] = responsesRaw.map((r) => ({
        itemId: r.item_id,
        selectedIndex: r.selected_index,
        isDontKnow: Number(r.is_dont_know) === 1,
        isCorrect: Number(r.is_correct) === 1,
        answeredAt: r.answered_at,
      }));

      const unansweredRows = await db.select<{ ordinal: number }>(
        `SELECT ordinal FROM practice_test_items
         WHERE version_id = ? AND id NOT IN (
           SELECT item_id FROM practice_responses WHERE attempt_id = ?
         )
         ORDER BY ordinal ASC LIMIT 1`,
        [attempt.version_id, attempt.id],
      );

      const nextUnansweredOrdinal =
        unansweredRows[0] !== undefined && unansweredRows[0].ordinal !== null
          ? Number(unansweredRows[0].ordinal)
          : null;

      return {
        attemptId: attempt.id,
        versionId: attempt.version_id,
        status: "in_progress",
        startedAt: attempt.started_at,
        completedAt: null,
        totalQuestions: Number(attempt.total_questions),
        answeredCount: Number(attempt.answered_count),
        revision: Number(attempt.revision),
        nextUnansweredOrdinal,
        responses,
      };
    },

    async getAttempt(attemptId: string): Promise<PracticeAttempt | null> {
      const rows = await db.select<{
        id: string;
        version_id: string;
        source_material_id: string | null;
        source_material_title: string;
        started_at: string;
        completed_at: string | null;
        status: string;
        revision: number;
        total_questions: number;
        answered_count: number;
        correct_count: number;
        incorrect_count: number;
        dont_know_count: number;
        score_percent: number | null;
      }>(
        `SELECT id, version_id, source_material_id, source_material_title,
                started_at, completed_at, status, revision, total_questions,
                answered_count, correct_count, incorrect_count, dont_know_count, score_percent
         FROM practice_attempts
         WHERE id = ?`,
        [attemptId],
      );

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        versionId: row.version_id,
        sourceMaterialId: row.source_material_id,
        sourceMaterialTitle: row.source_material_title,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        status: row.status as PracticeAttemptStatus,
        revision: Number(row.revision),
        totalQuestions: Number(row.total_questions),
        answeredCount: Number(row.answered_count),
        correctCount: Number(row.correct_count),
        incorrectCount: Number(row.incorrect_count),
        dontKnowCount: Number(row.dont_know_count),
        scorePercent: row.score_percent !== null ? Number(row.score_percent) : null,
      };
    },

    async getCompletedHistory(historyKey: string): Promise<CompletedHistoryItem[]> {
      const rows = await db.select<{
        attempt_id: string;
        version_id: string;
        version_number: number;
        history_key: string;
        source_material_title: string;
        started_at: string;
        completed_at: string;
        total_questions: number;
        answered_count: number;
        correct_count: number;
        incorrect_count: number;
        dont_know_count: number;
        score_percent: number;
      }>(
        `SELECT a.id AS attempt_id, a.version_id, v.version_number, v.history_key,
                v.source_material_title, a.started_at, a.completed_at,
                a.total_questions, a.answered_count, a.correct_count,
                a.incorrect_count, a.dont_know_count, a.score_percent
         FROM practice_attempts a
         JOIN practice_test_versions v ON a.version_id = v.id
         WHERE v.history_key = ? AND a.status = 'completed'
         ORDER BY a.completed_at DESC, a.id DESC`,
        [historyKey],
      );

      return rows.map((r) => {
        const total = Number(r.total_questions);
        const answered = Number(r.answered_count);
        return {
          attemptId: r.attempt_id,
          versionId: r.version_id,
          versionNumber: Number(r.version_number),
          historyKey: r.history_key,
          sourceMaterialTitle: r.source_material_title,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          totalQuestions: total,
          answeredCount: answered,
          correctCount: Number(r.correct_count),
          incorrectCount: Number(r.incorrect_count),
          dontKnowCount: Number(r.dont_know_count),
          unansweredCount: total - answered,
          scorePercent: Number(r.score_percent),
        };
      });
    },

    async getActiveVersion(
      materialId: string,
    ): Promise<{ version: PracticeTestVersion; items: PracticeTestItem[] } | null> {
      const rows = await db.select<{
        id: string;
        source_material_id: string | null;
        history_key: string;
        source_material_title: string;
        version_number: number;
        provider: import("@/domain/types").StudyAidProvider;
        model: string;
        title: string;
        content_hash: string;
        created_at: string;
        is_active: number;
      }>(
        `SELECT id, source_material_id, history_key, source_material_title,
                version_number, provider, model, title, content_hash, created_at, is_active
         FROM practice_test_versions
         WHERE source_material_id = ? AND is_active = 1`,
        [materialId],
      );

      const row = rows[0];
      if (!row) return null;

      const version: PracticeTestVersion = {
        id: row.id,
        sourceMaterialId: row.source_material_id,
        historyKey: row.history_key,
        sourceMaterialTitle: row.source_material_title,
        versionNumber: Number(row.version_number),
        provider: row.provider,
        model: row.model,
        title: row.title,
        contentHash: row.content_hash,
        createdAt: row.created_at,
        isActive: Number(row.is_active) === 1,
      };

      const items = await this.getItems(version.id);
      return { version, items };
    },

    async getVersion(versionId: string): Promise<PracticeTestVersion | null> {
      const rows = await db.select<{
        id: string;
        source_material_id: string | null;
        history_key: string;
        source_material_title: string;
        version_number: number;
        provider: import("@/domain/types").StudyAidProvider;
        model: string;
        title: string;
        content_hash: string;
        created_at: string;
        is_active: number;
      }>(
        `SELECT id, source_material_id, history_key, source_material_title,
                version_number, provider, model, title, content_hash, created_at, is_active
         FROM practice_test_versions
         WHERE id = ?`,
        [versionId],
      );

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        sourceMaterialId: row.source_material_id,
        historyKey: row.history_key,
        sourceMaterialTitle: row.source_material_title,
        versionNumber: Number(row.version_number),
        provider: row.provider,
        model: row.model,
        title: row.title,
        contentHash: row.content_hash,
        createdAt: row.created_at,
        isActive: Number(row.is_active) === 1,
      };
    },

    async getItems(versionId: string): Promise<PracticeTestItem[]> {
      const rows = await db.select<{
        id: string;
        version_id: string;
        ordinal: number;
        question_text: string;
        options_json: string;
        correct_index: number;
        explanation: string;
        source_page: number | null;
      }>(
        `SELECT id, version_id, ordinal, question_text, options_json,
                correct_index, explanation, source_page
         FROM practice_test_items
         WHERE version_id = ?
         ORDER BY ordinal ASC`,
        [versionId],
      );

      return rows.map((r) => ({
        id: r.id,
        versionId: r.version_id,
        ordinal: Number(r.ordinal),
        questionText: r.question_text,
        options: JSON.parse(r.options_json) as string[],
        correctIndex: Number(r.correct_index),
        explanation: r.explanation,
        sourcePage: r.source_page !== null ? Number(r.source_page) : null,
      }));
    },

    async getResponses(attemptId: string): Promise<PracticeResponse[]> {
      const rows = await db.select<{
        id: string;
        attempt_id: string;
        item_id: string;
        selected_index: number | null;
        is_dont_know: number;
        is_correct: number;
        answered_at: string;
      }>(
        `SELECT id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
         FROM practice_responses
         WHERE attempt_id = ?
         ORDER BY answered_at ASC, id ASC`,
        [attemptId],
      );

      return rows.map((r) => ({
        id: r.id,
        attemptId: r.attempt_id,
        itemId: r.item_id,
        selectedIndex: r.selected_index !== null ? Number(r.selected_index) : null,
        isDontKnow: Number(r.is_dont_know) === 1,
        isCorrect: Number(r.is_correct) === 1,
        answeredAt: r.answered_at,
      }));
    },

    async getConversionStatus(
      materialId: string,
    ): Promise<{ legacyMigratedAt: string | null; legacyError: string | null } | null> {
      const rows = await db.select<{
        legacy_migrated_at: string | null;
        legacy_error: string | null;
      }>(
        "SELECT legacy_migrated_at, legacy_error FROM practice_tests WHERE source_material_id = ?",
        [materialId],
      );

      const row = rows[0];
      if (!row) return null;

      return {
        legacyMigratedAt: row.legacy_migrated_at,
        legacyError: row.legacy_error,
      };
    },
  };
}
