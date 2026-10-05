/**
 * One structured study-packet save as a single-connection immediate
 * transaction (Slice B). Used by node:sqlite (tests) and sql.js (plain
 * browser). It must behave exactly like the native
 * `save_structured_study_material_atomically` in `src-tauri/src/study_packet.rs`:
 * the same strict decoding, the same allowlisted codes, the same stored rows,
 * and the same stored-content comparison for a retry.
 * See `StructuredImportSaveOperation` in `db.ts` for the contract.
 */
import { normalizeBlock, normalizeLine } from "@/logic/studyPacket/schema";
import { codePointLength } from "@/logic/studyPacket/scan";
import { LIMITS } from "@/logic/studyPacket/limits";

import type { NativeImportSaveResult, NativeImportSaveErrorCode, SqlValue } from "./db";
import { StructuredImportSaveError } from "./persistenceErrors";

interface StoredSection {
  heading: string;
  body: string;
}
interface StoredFlashcard {
  front: string;
  back: string;
  sourcePage: null;
}
interface StoredQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sourcePage: null;
}

/** A decoded, validated and normalized operation, ready to store. */
export interface ImportContent {
  materialId: string;
  title: string;
  studySet: { summary: string; sections: StoredSection[]; flashcards: StoredFlashcard[]; sourceNotes: string } | null;
  practiceTest: StoredQuestion[] | null;
}

const refuse = (code: NativeImportSaveErrorCode): never => {
  throw new StructuredImportSaveError(code);
};

type Json = Record<string, unknown>;

/** A plain JSON object with exactly these keys, all required. */
function exactObject(value: unknown, keys: readonly string[]): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse("INVALID_ARGUMENT");
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return refuse("INVALID_ARGUMENT");
  }
  return value as Json;
}

function stringAt(object: Json, key: string): string {
  const value = object[key];
  return typeof value === "string" ? value : refuse("INVALID_ARGUMENT");
}

function arrayAt(object: Json, key: string): unknown[] {
  const value = object[key];
  return Array.isArray(value) ? value : refuse("INVALID_ARGUMENT");
}

function bounded(raw: string, kind: "line" | "block", min: 0 | 1, max: number): string {
  const value = kind === "line" ? normalizeLine(raw) : normalizeBlock(raw);
  const length = codePointLength(value);
  if (length < min) refuse("INVALID_ARGUMENT");
  if (length > max) refuse("CONTENT_LIMIT_EXCEEDED");
  return value;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTENT_HASH = /^[0-9a-f]{64}$/;

/** Decode and validate an operation before any database access. */
export function decodeStructuredImport(value: unknown): ImportContent {
  // Pass 1: the exact shape and JSON types.
  const root = exactObject(value, [
    "operationId", "materialId", "contentHash", "material", "studySet", "practiceTest",
  ]);
  const material = exactObject(root.material, ["title"]);
  const rawSet =
    root.studySet === null
      ? null
      : (() => {
          const set = exactObject(root.studySet, [
            "title", "provider", "model", "summary", "sections", "flashcards", "sourceNotes",
          ]);
          return {
            title: stringAt(set, "title"),
            provider: stringAt(set, "provider"),
            model: stringAt(set, "model"),
            summary: stringAt(set, "summary"),
            sections: arrayAt(set, "sections").map((item) => {
              const section = exactObject(item, ["heading", "body"]);
              return { heading: stringAt(section, "heading"), body: stringAt(section, "body") };
            }),
            flashcards: arrayAt(set, "flashcards").map((item) => {
              const card = exactObject(item, ["front", "back", "sourcePage"]);
              return { front: stringAt(card, "front"), back: stringAt(card, "back"), sourcePage: card.sourcePage };
            }),
            sourceNotes: stringAt(set, "sourceNotes"),
          };
        })();
  const rawTest =
    root.practiceTest === null
      ? null
      : (() => {
          const test = exactObject(root.practiceTest, ["title", "provider", "model", "questions"]);
          return {
            title: stringAt(test, "title"),
            provider: stringAt(test, "provider"),
            model: stringAt(test, "model"),
            questions: arrayAt(test, "questions").map((item) => {
              const question = exactObject(item, ["question", "options", "correctIndex", "explanation", "sourcePage"]);
              const options = arrayAt(question, "options").map((option) =>
                typeof option === "string" ? option : refuse("INVALID_ARGUMENT"),
              );
              if (typeof question.correctIndex !== "number") refuse("INVALID_ARGUMENT");
              return {
                question: stringAt(question, "question"),
                options,
                correctIndex: question.correctIndex as number,
                explanation: stringAt(question, "explanation"),
                sourcePage: question.sourcePage,
              };
            }),
          };
        })();
  const operationId = stringAt(root, "operationId");
  const materialId = stringAt(root, "materialId");
  const contentHash = stringAt(root, "contentHash");
  const rawTitle = stringAt(material, "title");

  // Pass 2: meaning, in the same order as the native validator.
  if (!UUID_V4.test(operationId) || !UUID_V4.test(materialId) || operationId !== materialId) {
    refuse("INVALID_OPERATION_ID");
  }
  if (!CONTENT_HASH.test(contentHash)) refuse("INVALID_HASH_FORMAT");
  for (const aid of [rawSet, rawTest]) {
    if (aid && (aid.provider !== "import" || aid.model !== "")) refuse("UNSUPPORTED_PROVIDER");
  }
  const pages = [
    ...(rawSet?.flashcards.map((card) => card.sourcePage) ?? []),
    ...(rawTest?.questions.map((question) => question.sourcePage) ?? []),
  ];
  if (pages.some((page) => page !== null)) refuse("INVALID_SOURCE_PAGE");

  const title = bounded(rawTitle, "line", 1, LIMITS.title);

  let studySet: ImportContent["studySet"] = null;
  if (rawSet) {
    if (normalizeLine(rawSet.title) !== title) refuse("INVALID_ARGUMENT");
    const summary = bounded(rawSet.summary, "block", 0, LIMITS.summary);
    if (rawSet.sections.length > LIMITS.sections || rawSet.flashcards.length > LIMITS.flashcards) {
      refuse("CONTENT_LIMIT_EXCEEDED");
    }
    studySet = {
      summary,
      sections: rawSet.sections.map((section) => ({
        heading: bounded(section.heading, "line", 1, LIMITS.heading),
        body: bounded(section.body, "block", 1, LIMITS.body),
      })),
      flashcards: rawSet.flashcards.map((card) => ({
        front: bounded(card.front, "block", 1, LIMITS.front),
        back: bounded(card.back, "block", 1, LIMITS.back),
        sourcePage: null,
      })),
      sourceNotes: bounded(rawSet.sourceNotes, "block", 0, LIMITS.sourceNotes),
    };
  }

  let practiceTest: ImportContent["practiceTest"] = null;
  if (rawTest) {
    if (normalizeLine(rawTest.title) !== title) refuse("INVALID_ARGUMENT");
    if (rawTest.questions.length === 0) refuse("INVALID_ARGUMENT");
    if (rawTest.questions.length > LIMITS.questions) refuse("CONTENT_LIMIT_EXCEEDED");
    practiceTest = rawTest.questions.map((raw) => {
      const question = bounded(raw.question, "block", 1, LIMITS.question);
      if (raw.options.length < LIMITS.choicesMin) refuse("INVALID_ARGUMENT");
      if (raw.options.length > LIMITS.choicesMax) refuse("CONTENT_LIMIT_EXCEEDED");
      const options = raw.options.map((option) => bounded(option, "line", 1, LIMITS.choiceText));
      if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) refuse("INVALID_ARGUMENT");
      if (!Number.isInteger(raw.correctIndex) || raw.correctIndex < 0 || raw.correctIndex >= options.length) {
        refuse("INVALID_ARGUMENT");
      }
      return {
        question,
        options,
        correctIndex: raw.correctIndex,
        explanation: bounded(raw.explanation, "block", 1, LIMITS.explanation),
        sourcePage: null,
      };
    });
  }

  const setSubstantive = Boolean(
    studySet && (studySet.summary || studySet.sections.length || studySet.flashcards.length),
  );
  const testSubstantive = Boolean(practiceTest && practiceTest.length);
  if (!setSubstantive && !testSubstantive) refuse("EMPTY_SUBSTANTIVE_CONTENT");
  if (studySet && !setSubstantive) refuse("INVALID_ARGUMENT");

  return { materialId, title, studySet, practiceTest };
}

/** Stored JSON text compared as values, so key order cannot cause a conflict. */
function sameJson(stored: unknown, expected: unknown): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(stored));
  } catch {
    return false;
  }
  return deepEqual(parsed, expected);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual((a as Json)[key], (b as Json)[key]))
  );
}

type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

/** A retry is accepted only when every stored content field matches. */
async function storedContentMatches(query: Query, content: ImportContent): Promise<boolean> {
  const id = content.materialId;
  const [material] = await query("SELECT title, material_type FROM study_materials WHERE id = ?", [id]);
  if (!material || material.title !== content.title || material.material_type !== "study_guide") return false;

  const [set] = await query(
    `SELECT title, summary, sections_json, flashcards_json, source_notes, provider, model
       FROM ai_study_sets WHERE source_material_id = ?`,
    [id],
  );
  if (Boolean(set) !== Boolean(content.studySet)) return false;
  if (set && content.studySet) {
    const expected = content.studySet;
    if (
      set.title !== content.title ||
      set.summary !== expected.summary ||
      set.source_notes !== expected.sourceNotes ||
      set.provider !== "import" ||
      set.model !== "" ||
      !sameJson(set.sections_json, expected.sections) ||
      !sameJson(set.flashcards_json, expected.flashcards)
    ) {
      return false;
    }
  }

  const [test] = await query(
    "SELECT title, questions_json, provider, model FROM practice_tests WHERE source_material_id = ?",
    [id],
  );
  if (Boolean(test) !== Boolean(content.practiceTest)) return false;
  if (test && content.practiceTest) {
    if (
      test.title !== content.title ||
      test.provider !== "import" ||
      test.model !== "" ||
      !sameJson(test.questions_json, content.practiceTest)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Validate, then store in one immediate transaction. Statement failures roll
 * back and surface as `STORAGE_FAILURE`, never as an engine message.
 */
export async function executeStructuredImport(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  operation: unknown,
  timestamp: string = new Date().toISOString(),
): Promise<NativeImportSaveResult> {
  const content = decodeStructuredImport(operation);
  const id = content.materialId;

  await exec("BEGIN IMMEDIATE");
  try {
    const existing = await query("SELECT 1 AS found FROM study_materials WHERE id = ?", [id]);
    if (existing.length > 0) {
      if (!(await storedContentMatches(query, content))) refuse("IDEMPOTENCY_CONFLICT");
      await exec("COMMIT");
      return { status: "already_saved", materialId: id };
    }

    await run(
      `INSERT INTO study_materials (
         id, title, material_type, topic, review_status, priority,
         goal_id, event_id, notes, file_path, original_file_name, file_size,
         created_at, updated_at, last_reviewed_at
       ) VALUES (?, ?, 'study_guide', 'general', 'needs_review', 'later',
         NULL, NULL, '', NULL, NULL, NULL, ?, ?, NULL)`,
      [id, content.title, timestamp, timestamp],
    );
    if (content.studySet) {
      await run(
        `INSERT INTO ai_study_sets (
           source_material_id, title, summary, sections_json, flashcards_json,
           source_notes, provider, model, generated_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'import', '', ?, ?)`,
        [
          id,
          content.title,
          content.studySet.summary,
          JSON.stringify(content.studySet.sections),
          JSON.stringify(content.studySet.flashcards),
          content.studySet.sourceNotes,
          timestamp,
          timestamp,
        ],
      );
    }
    if (content.practiceTest) {
      await run(
        `INSERT INTO practice_tests (
           source_material_id, title, questions_json, provider, model, generated_at, updated_at
         ) VALUES (?, ?, ?, 'import', '', ?, ?)`,
        [id, content.title, JSON.stringify(content.practiceTest), timestamp, timestamp],
      );
    }
    await exec("COMMIT");
    return { status: "saved", materialId: id };
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // The original error is the one worth reporting.
    }
    if (error instanceof StructuredImportSaveError) throw error;
    throw new StructuredImportSaveError("STORAGE_FAILURE", { cause: error });
  }
}
