import { homeworkAssert } from "@/domain/homework";
/**
 * Initialization validation for the single-connection drivers (sql.js in the
 * plain browser, node:sqlite in tests): the TypeScript twin of the native
 * `verify_application_connection` / `verify_schema_11_semantics` in
 * `src-tauri/src/backup.rs`.
 *
 * It runs on the owned connection after migrations and inside the legacy
 * conversion transaction, before the adapter is handed out, so a database
 * whose stored practice state is false is refused instead of reopened. The
 * schema is compared with a reference built in memory from the registered
 * migrations. Native and browser outcomes are held equal by the shared
 * contract in `src-tauri/fixtures/practice-validation/cases.json`.
 */
import { storedSetProblem } from "./studySetTransaction";
import { decodePracticeOperation, decodePracticeRetirements, decodePracticeSnapshot, readCurrentSnapshot } from "./practiceAuthoring";
import { canonicalJson, isValidCardText, MAX_BACK_CHARS, MAX_FRONT_CHARS, MAX_SOURCE_PAGE, sha256Hex, versionOrigin, type CanonicalCard } from "@/logic/cardIdentity";
import { isIsoInstant, SCHEDULER_VERSION, stepDelayMs } from "@/logic/cardScheduler";

import type { PracticeSaveOperation, SkillEvidenceActionName } from "@/domain/types";

import type { SqlValue } from "./db";
import { MIGRATIONS } from "./migrations";
import { codePointLength } from "./practiceSessionTransaction";
import {
  ASSESSMENT_ACTIONS,
  OBSERVATION_HISTORY_ACTIONS,
  ResultShapeError,
  SKILL_ACTIONS,
  decodeStoredResult,
} from "./skillEvidenceResult";
import { labelKey } from "./skillEvidenceTransaction";

export type ValidationQuery = (
  sql: string,
  params: SqlValue[],
) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

export class PracticeStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PracticeStateValidationError";
  }
}

function refuse(message: string): never {
  throw new PracticeStateValidationError(message);
}

const PRACTICE_TABLES = [
  "practice_test_versions",
  "practice_test_items",
  "practice_attempts",
  "practice_responses",
  "practice_session_operations",
  "practice_tests",
] as const;

const RECEIPT_ACTIONS = ["start_or_resume", "record_response", "complete_attempt", "abandon_attempt", "retake_attempt", "erase_history"];

const UUID_V4_ANY_CASE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ------------------------- typed column reads ------------------------- */
// Native reads each column with a typed getter and refuses a wrong storage
// type; these do the same rather than coercing.

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") refuse(`Column ${key} is not text.`);
  return value;
}

function optText(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function int(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number" || !Number.isInteger(value)) refuse(`Column ${key} is not an integer.`);
  return value;
}

function optInt(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : int(row, key);
}

function optReal(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") refuse(`Column ${key} is not a number.`);
  return value;
}

async function count(query: ValidationQuery, sql: string, params: SqlValue[] = []): Promise<number> {
  const [row] = await query(sql, params);
  return row ? int(row, Object.keys(row)[0]!) : 0;
}

/* ------------------------- schema comparison ------------------------- */

/** Comments removed, whitespace collapsed, lower-cased (native `normalize_sql`). */
export function normalizeSql(sql: string): string {
  let clean = "";
  for (let i = 0; i < sql.length; ) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (sql[i] === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i + 1 < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
    } else {
      clean += sql[i];
      i++;
    }
  }
  return clean.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/**
 * The CHECK expressions of a CREATE TABLE statement, with whitespace and
 * identifier quoting removed and sorted (native `check_constraints`).
 */
export function checkConstraints(sql: string): string[] {
  const chars = [...normalizeSql(sql)];
  const isWord = (c: string | undefined) => c !== undefined && /[a-z0-9_]/i.test(c);
  const checks: string[] = [];
  let inQuote = false;
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    if (c === "'") {
      inQuote = !inQuote;
      i++;
      continue;
    }
    const atCheck =
      !inQuote &&
      chars.slice(i, i + 5).join("") === "check" &&
      (i === 0 || !isWord(chars[i - 1])) &&
      !isWord(chars[i + 5]);
    if (!atCheck) {
      i++;
      continue;
    }
    let j = i + 5;
    while (chars[j] === " ") j++;
    if (chars[j] !== "(") {
      i += 5;
      continue;
    }
    let depth = 0;
    let quoted = false;
    let expression = "";
    for (; j < chars.length; j++) {
      const d = chars[j]!;
      if (d === "'") quoted = !quoted;
      else if (!quoted && d === "(") depth++;
      else if (!quoted && d === ")") {
        depth--;
        if (depth === 0) break;
      }
      if (depth > 0 && !(depth === 1 && d === "(" && expression === "")) expression += d;
    }
    checks.push([...expression].filter((ch) => !/\s/.test(ch) && ch !== '"' && ch !== "`").join(""));
    i = j + 1;
  }
  return checks.sort();
}

/** A table's foreign keys, independent of declaration order and identifier case. */
async function foreignKeyShapes(query: ValidationQuery, table: string): Promise<string[]> {
  const rows = await query(
    `SELECT id, "table" AS parent, "from" AS child, "to" AS target, on_update, on_delete, "match" AS matching
     FROM pragma_foreign_key_list('${table}') ORDER BY id, seq`,
    [],
  );
  const grouped = new Map<number, { head: string; columns: string[] }>();
  for (const row of rows) {
    const id = int(row, "id");
    let entry = grouped.get(id);
    if (!entry) {
      entry = {
        head: [
          text(row, "parent").toLowerCase(),
          text(row, "on_update").toUpperCase(),
          text(row, "on_delete").toUpperCase(),
          text(row, "matching").toUpperCase(),
        ].join("|"),
        columns: [],
      };
      grouped.set(id, entry);
    }
    entry.columns.push(`${text(row, "child").toLowerCase()}>${optText(row, "target")?.toLowerCase() ?? ""}`);
  }
  return [...grouped.values()].map((entry) => `${entry.head}|${entry.columns.join(",")}`).sort();
}

async function tableSql(query: ValidationQuery, table: string): Promise<string> {
  const [row] = await query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  if (!row) refuse(`Could not read the definition of ${table}.`);
  return text(row, "sql");
}

async function indexColumns(query: ValidationQuery, index: string): Promise<string[]> {
  const rows = await query(`SELECT name FROM pragma_index_info('${index}') ORDER BY seqno ASC`, []);
  return rows.map((row) => text(row, "name"));
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ------------------------- entry points ------------------------- */

/**
 * Whole-database initialization checks (native `verify_application_connection`):
 * integrity, required tables, migration history and ceiling, then the
 * schema-11 practice contract.
 */
export async function validateApplicationDatabase(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  const [quick] = await query("PRAGMA quick_check", []);
  if (!quick || Object.values(quick)[0] !== "ok") refuse("The database is damaged or incomplete.");

  for (const table of ["settings", "study_materials"]) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing ${table}.`);
    }
  }
  let migrationTable: string | null = null;
  for (const table of ["_sqlx_migrations", "schema_migrations"]) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) === 1) {
      migrationTable = table;
      break;
    }
  }
  if (!migrationTable) refuse("The database has no migration history.");
  const newest = await count(query, `SELECT COALESCE(MAX(version), 0) AS n FROM ${migrationTable}`);
  const supported = Math.max(...MIGRATIONS.map((migration) => migration.version));
  if (newest > supported) refuse("The database was created by a newer format.");
  if (newest >= 11) await validatePracticeState(query, reference);
  if (newest >= 12) await validateCardReviewState(query, reference);
  if (newest >= 13) await validateSplitLineageState(query, reference);
  if (newest >= 14) await validateSkillEvidenceState(query, reference);
  if (newest >= 15) await validateNavigationState(query, reference);
  if (newest >= 16) await validateManualStudyState(query, reference);
  if (newest >= 17) await validatePracticeAuthoringState(query, reference);
  if (newest >= 18) await validatePdfKitState(query, reference);
  if (newest >= 19) await validateStudySetReceiptState(query, reference);
  if (newest >= 20) await validateHomeworkState(query, reference);
}

/** The schema-11 practice contract (native `verify_schema_11_semantics`). */
export async function validatePracticeState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  // 1. Rows against the foreign keys that exist.
  if ((await query("PRAGMA foreign_key_check", [])).length > 0) {
    refuse("The database violates foreign key constraints.");
  }

  // 2. Tables, columns, foreign keys and CHECK constraints against the reference.
  for (const table of PRACTICE_TABLES) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing required table: ${table}`);
    }
    const columnsSql = `SELECT name, type, "notnull" AS required, pk FROM pragma_table_info('${table}')`;
    const actual = new Map((await query(columnsSql, [])).map((row) => [text(row, "name"), row]));
    for (const ref of await reference(columnsSql, [])) {
      const name = text(ref, "name");
      if (table === "practice_tests" && !["legacy_migrated_at", "legacy_error"].includes(name)) continue;
      // 0017 adds authoring columns to the immutable items table; historical
      // databases are checked against their own version, and databases that
      // have them are checked by the schema-17 gate below.
      if (table === "practice_test_items" && (name === "logical_id" || name === "replaces_id")) continue;
      const column = actual.get(name);
      if (!column) refuse(`Table ${table} is missing required column: ${name}`);
      if (text(column, "type").toLowerCase() !== text(ref, "type").toLowerCase()) refuse(`Table ${table} column ${name} type mismatch.`);
      if (int(column, "required") !== int(ref, "required")) refuse(`Table ${table} column ${name} notnull mismatch.`);
      if (int(column, "pk") !== int(ref, "pk")) refuse(`Table ${table} column ${name} pk mismatch.`);
    }
    if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {
      refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    }
  }

  // 3. Compound uniqueness.
  for (const [table, columns] of [
    ["practice_test_items", ["version_id", "ordinal"]],
    ["practice_responses", ["attempt_id", "item_id"]],
  ] as const) {
    let found = false;
    for (const index of await query(`SELECT name, "unique" AS is_unique FROM pragma_index_list('${table}')`, [])) {
      if (int(index, "is_unique") === 1 && same(await indexColumns(query, text(index, "name")), columns)) found = true;
    }
    if (!found) refuse(`Table ${table} is missing compound UNIQUE constraint on (${columns.join(", ")}).`);
  }

  // 4. Partial unique indexes with key and predicate.
  for (const [table, index, columns, predicate] of [
    ["practice_test_versions", "uq_active_practice_version", ["source_material_id"], "is_active = 1"],
    ["practice_attempts", "uq_single_in_progress_attempt", ["source_material_id"], "status = 'in_progress'"],
  ] as const) {
    const [listed] = await query(`SELECT "unique" AS is_unique FROM pragma_index_list('${table}') WHERE name = ?`, [index]);
    if (!listed) refuse(`The database is missing required unique index: ${index}`);
    if (int(listed, "is_unique") !== 1) refuse(`The index ${index} must be a UNIQUE index.`);
    if (!same(await indexColumns(query, index), columns)) refuse(`The unique index ${index} has invalid key columns.`);
    const [definition] = await query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", [index]);
    const sql = definition ? optText(definition, "sql") : null;
    if (sql !== null) {
      const lower = sql.toLowerCase();
      if (!lower.includes("unique") || !lower.includes(predicate) || !lower.includes("source_material_id is not null")) {
        refuse(`The unique index ${index} does not match expected predicate.`);
      }
    }
  }

  // Secondary indexes against the reference.
  for (const [table, index] of [
    ["practice_test_versions", "idx_practice_versions_history"],
    ["practice_test_items", "idx_practice_items_version"],
    ["practice_attempts", "idx_practice_attempts_material"],
    ["practice_attempts", "idx_practice_attempts_version"],
    ["practice_responses", "idx_practice_responses_attempt"],
    ["practice_session_operations", "idx_practice_ops_history"],
    ["practice_session_operations", "idx_practice_ops_attempt"],
  ] as const) {
    if ((await query(`SELECT 1 FROM pragma_index_list('${table}') WHERE name = ?`, [index])).length === 0) {
      refuse(`The database is missing required index: ${index}`);
    }
    if (!same(await indexColumns(query, index), await indexColumns(reference, index))) {
      refuse(`Index ${index} key columns do not match the registered migration contract.`);
    }
  }

  // 5. Relations and ownership.
  const relationChecks: [string, string][] = [
    [
      "SELECT COUNT(*) AS n FROM practice_test_items i LEFT JOIN practice_test_versions v ON i.version_id = v.id WHERE v.id IS NULL",
      "practice test items without a parent version",
    ],
    [
      "SELECT COUNT(*) AS n FROM practice_attempts a LEFT JOIN practice_test_versions v ON a.version_id = v.id WHERE v.id IS NULL",
      "practice attempts without a parent version",
    ],
    [
      `SELECT COUNT(*) AS n FROM practice_responses r
       LEFT JOIN practice_attempts a ON r.attempt_id = a.id
       LEFT JOIN practice_test_items i ON r.item_id = i.id
       WHERE a.id IS NULL OR i.id IS NULL`,
      "practice responses without a parent attempt or item",
    ],
    [
      `SELECT COUNT(*) AS n FROM practice_responses r
       JOIN practice_attempts a ON r.attempt_id = a.id
       JOIN practice_test_items i ON r.item_id = i.id
       WHERE a.version_id != i.version_id`,
      "practice responses referencing items from a different version",
    ],
    [
      `SELECT COUNT(*) AS n FROM practice_attempts a
       JOIN practice_test_versions v ON a.version_id = v.id
       WHERE (a.source_material_id IS NOT NULL AND (v.source_material_id IS NULL OR a.source_material_id != v.source_material_id))
          OR (a.source_material_id IS NULL AND v.source_material_id IS NOT NULL AND v.is_active = 1)`,
      "practice attempts whose material ownership does not match their version",
    ],
    [
      `SELECT COUNT(*) AS n FROM practice_session_operations o
       JOIN practice_attempts a ON o.attempt_id = a.id
       JOIN practice_test_versions v ON a.version_id = v.id
       WHERE o.history_key != v.history_key`,
      "operation receipts whose history key does not match the attempt version",
    ],
    [
      `SELECT COUNT(*) AS n FROM (
         SELECT source_material_id FROM practice_test_versions
         WHERE is_active = 1 AND source_material_id IS NOT NULL
         GROUP BY source_material_id HAVING COUNT(*) > 1)`,
      "multiple active versions for the same study material",
    ],
    [
      `SELECT COUNT(*) AS n FROM (
         SELECT source_material_id FROM practice_attempts
         WHERE status = 'in_progress' AND source_material_id IS NOT NULL
         GROUP BY source_material_id HAVING COUNT(*) > 1)`,
      "multiple in-progress attempts for the same study material",
    ],
    [
      "SELECT COUNT(*) AS n FROM practice_test_versions WHERE source_material_id IS NULL AND is_active = 1",
      "detached practice test versions that are marked active",
    ],
  ];
  for (const [sql, problem] of relationChecks) {
    if ((await count(query, sql)) > 0) refuse(`The database contains ${problem}.`);
  }

  // 6. Every frozen version: 1–200 complete items with contiguous ordinals.
  for (const version of await query("SELECT id FROM practice_test_versions", [])) {
    const versionId = text(version, "id");
    const items = await query(
      `SELECT id, ordinal, question_text, options_json, correct_index, explanation, source_page
       FROM practice_test_items WHERE version_id = ? ORDER BY ordinal ASC`,
      [versionId],
    );
    if (items.length === 0 || items.length > 200) refuse(`Practice test version ${versionId} has invalid question count.`);
    items.forEach((item, expected) => {
      const itemId = text(item, "id");
      if (int(item, "ordinal") !== expected) refuse(`Item ${itemId} has a non-contiguous ordinal.`);
      const question = text(item, "question_text");
      if (question.trim() === "" || codePointLength(question) > 10_000) refuse(`Item ${itemId} has invalid question text length.`);
      if (codePointLength(text(item, "explanation")) > 5_000) refuse(`Item ${itemId} has an over-long explanation.`);
      const sourcePage = optInt(item, "source_page");
      if (sourcePage !== null && (sourcePage < 1 || sourcePage > 1_000)) refuse(`Item ${itemId} has an out-of-bounds source page.`);
      const options = parseOptions(text(item, "options_json"), itemId);
      if (options.length < 2 || options.length > 8) refuse(`Item ${itemId} has an out-of-bounds option count.`);
      for (const option of options) {
        if (typeof option !== "string") refuse(`Item ${itemId} options must be string values.`);
        if (option.trim() === "" || codePointLength(option) > 1_000) refuse(`Item ${itemId} has invalid option length.`);
      }
      const correct = int(item, "correct_index");
      if (correct < 0 || correct >= options.length) refuse(`Item ${itemId} has an out-of-bounds correct index.`);
    });
  }

  // 7. Responses: choice flags, selection bounds and correctness from frozen keys.
  for (const response of await query(
    `SELECT r.id, r.selected_index, r.is_dont_know, r.is_correct, i.options_json, i.correct_index, r.answered_at
     FROM practice_responses r JOIN practice_test_items i ON r.item_id = i.id`,
    [],
  )) {
    const id = text(response, "id");
    const selected = optInt(response, "selected_index");
    const dontKnow = int(response, "is_dont_know");
    const correct = int(response, "is_correct");
    const options = text(response, "options_json");
    const key = int(response, "correct_index");
    if (text(response, "answered_at").trim() === "") refuse(`Response ${id} has an empty answered_at timestamp.`);
    if (dontKnow === 1) {
      if (selected !== null || correct !== 0) refuse(`Response ${id} is a don't-know with a selection or correct flag.`);
    } else {
      if (selected === null) refuse(`Response ${id} has no selection.`);
      if (selected < 0) refuse(`Response ${id} has a negative selection.`);
      if (selected >= parseOptions(options, id).length) refuse(`Response ${id} has an out-of-bounds selection.`);
      if (correct !== (selected === key ? 1 : 0)) refuse(`Response ${id} has an incorrect is_correct value.`);
    }
  }

  // 8. Attempts: status, timing, revision, real counts, completed tallies and score.
  for (const attempt of await query(
    `SELECT id, version_id, status, started_at, completed_at, revision, total_questions,
            answered_count, correct_count, incorrect_count, dont_know_count, score_percent
     FROM practice_attempts`,
    [],
  )) {
    const id = text(attempt, "id");
    const versionId = text(attempt, "version_id");
    const status = text(attempt, "status");
    const startedAt = text(attempt, "started_at");
    const completedAt = optText(attempt, "completed_at");
    const revision = int(attempt, "revision");
    const total = int(attempt, "total_questions");
    const answered = int(attempt, "answered_count");
    const correct = int(attempt, "correct_count");
    const incorrect = int(attempt, "incorrect_count");
    const dontKnow = int(attempt, "dont_know_count");
    const score = optReal(attempt, "score_percent");

    if (startedAt.trim() === "") refuse(`Attempt ${id} has an empty started_at timestamp.`);
    if (revision < 0) refuse(`Attempt ${id} has a negative revision.`);
    if (answered < 0 || correct < 0 || incorrect < 0 || dontKnow < 0) refuse(`Attempt ${id} has negative counts.`);
    const actualTotal = await count(query, "SELECT COUNT(*) AS n FROM practice_test_items WHERE version_id = ?", [versionId]);
    const actualAnswered = await count(query, "SELECT COUNT(*) AS n FROM practice_responses WHERE attempt_id = ?", [id]);
    if (answered > total) refuse(`Attempt ${id} answered_count exceeds total_questions.`);

    if (status === "in_progress") {
      if (completedAt !== null) refuse(`In-progress attempt ${id} must have no completion time.`);
      if (total !== actualTotal) refuse(`In-progress attempt ${id} total_questions does not match its frozen version.`);
      if (answered !== actualAnswered) refuse(`In-progress attempt ${id} answered_count does not match its responses.`);
    } else if (status === "completed") {
      if (completedAt === null) refuse(`Completed attempt ${id} has no completion timestamp.`);
      if (completedAt.trim() === "") refuse(`Attempt ${id} has an empty completed_at timestamp.`);
      if (score === null) refuse(`Completed attempt ${id} has no score.`);
      if (total !== actualTotal) refuse(`Completed attempt ${id} total_questions does not match its frozen version.`);
      if (answered !== actualAnswered) refuse(`Completed attempt ${id} answered_count does not match its responses.`);
      const derivedCorrect = await count(
        query,
        `SELECT COUNT(*) AS n FROM practice_responses r JOIN practice_test_items i ON r.item_id = i.id
         WHERE r.attempt_id = ? AND r.is_dont_know = 0 AND r.selected_index = i.correct_index`,
        [id],
      );
      const actualDontKnow = await count(
        query,
        "SELECT COUNT(*) AS n FROM practice_responses WHERE attempt_id = ? AND is_dont_know = 1",
        [id],
      );
      const derivedIncorrect = await count(
        query,
        `SELECT COUNT(*) AS n FROM practice_responses r JOIN practice_test_items i ON r.item_id = i.id
         WHERE r.attempt_id = ? AND r.is_dont_know = 0 AND r.selected_index != i.correct_index`,
        [id],
      );
      if (correct !== derivedCorrect || dontKnow !== actualDontKnow || incorrect !== derivedIncorrect) {
        refuse(`Completed attempt ${id} tallies do not match its responses.`);
      }
      const expected = actualTotal > 0 ? Math.round((derivedCorrect / actualTotal) * 1000) / 10 : 0;
      if (Math.abs(score - expected) > 1e-6) refuse(`Completed attempt ${id} has an inconsistent score.`);
    } else if (status === "abandoned") {
      if (completedAt === null) refuse(`Abandoned attempt ${id} must have a completion timestamp.`);
      if (total !== actualTotal) refuse(`Abandoned attempt ${id} total_questions does not match its frozen version.`);
    } else {
      refuse(`Attempt ${id} has an invalid status.`);
    }
  }

  // 9. Receipts: typed fields, identity, hash, history and frozen owner; tombstones.
  for (const receipt of await query(
    `SELECT operation_id, action, request_hash, applied_at, result_json, history_key, attempt_id, is_erased
     FROM practice_session_operations`,
    [],
  )) {
    const operationId = text(receipt, "operation_id");
    const action = text(receipt, "action");
    const requestHash = text(receipt, "request_hash");
    const appliedAt = text(receipt, "applied_at");
    const resultJson = text(receipt, "result_json");
    const historyKey = text(receipt, "history_key");
    const attemptId = text(receipt, "attempt_id");
    const erased = int(receipt, "is_erased");

    if (!UUID_V4_ANY_CASE.test(operationId)) refuse(`Operation receipt ${operationId} is not a valid UUIDv4.`);
    if (!/^[0-9a-f]{64}$/i.test(requestHash)) refuse(`Operation receipt ${operationId} has an invalid request hash.`);
    if (appliedAt.trim() === "" || !appliedAt.includes("T") || appliedAt.length < 19) {
      refuse(`Operation receipt ${operationId} has an invalid applied_at timestamp.`);
    }
    if (historyKey.trim() === "" || attemptId.trim() === "") refuse("The database contains receipts with missing required fields.");
    if (!RECEIPT_ACTIONS.includes(action)) refuse(`Operation receipt ${operationId} has an unknown action.`);
    let result: unknown;
    try {
      result = JSON.parse(resultJson);
    } catch {
      refuse(`Operation receipt ${operationId} has malformed result JSON.`);
    }

    if (erased === 1) {
      if (resultJson !== "null" || result !== null) refuse("The database contains erased receipts that still retain result content.");
      continue;
    }
    if (result === null) refuse(`Operation receipt ${operationId} has a null result.`);
    if (typeof result !== "object" || Array.isArray(result)) refuse(`Operation receipt ${operationId} result must be an object.`);
    const obj = result as Record<string, unknown>;
    if (Object.keys(obj).length === 0) refuse(`Operation receipt ${operationId} has an empty result.`);

    if (action === "erase_history") {
      const hKey = obj["historyKey"];
      if (typeof hKey !== "string" || hKey !== historyKey) {
        refuse(`Operation receipt ${operationId} erase_history historyKey does not match receipt history_key.`);
      }
      if (obj["erased"] !== true) {
        refuse(`Operation receipt ${operationId} erase_history missing erased flag.`);
      }
      for (const forbidden of [
        "selectedIndex",
        "responses",
        "questions",
        "scorePercent",
        "correctIndex",
        "isCorrect",
      ]) {
        if (Object.prototype.hasOwnProperty.call(obj, forbidden)) {
          refuse("The database contains erased receipts that still retain result content.");
        }
      }
      continue;
    }

    if (typeof obj["attemptId"] !== "string") refuse(`Operation receipt ${operationId} result is missing attemptId.`);
    if (obj["attemptId"] !== attemptId) refuse(`Operation receipt ${operationId} result names another attempt.`);
    const revision = obj["revision"] !== undefined ? obj["revision"] : obj["currentRevision"];
    if (!Number.isInteger(revision)) refuse(`Operation receipt ${operationId} result is missing revision.`);
    if ((revision as number) < 0) refuse(`Operation receipt ${operationId} result has a negative revision.`);

    const nonEmpty = (key: string) => {
      const value = obj[key];
      if (typeof value !== "string") refuse(`Operation receipt ${operationId} result is missing ${key}.`);
      if (value.trim() === "") refuse(`Operation receipt ${operationId} result has an empty ${key}.`);
      return value;
    };
    const status = (expected: string) => {
      if (typeof obj["status"] !== "string") refuse(`Operation receipt ${operationId} result is missing status.`);
      if (obj["status"] !== expected) refuse(`Operation receipt ${operationId} result status must be ${expected}.`);
    };
    if (action === "start_or_resume" || action === "retake_attempt") {
      const versionId = nonEmpty("versionId");
      const [owner] = await query("SELECT version_id FROM practice_attempts WHERE id = ?", [attemptId]);
      if (owner && text(owner, "version_id") !== versionId) {
        refuse(`Operation receipt ${operationId} names a version other than the attempt's frozen version.`);
      }
      status("in_progress");
    } else if (action === "record_response") {
      nonEmpty("answeredAt");
    } else if (action === "complete_attempt") {
      status("completed");
      nonEmpty("completedAt");
      if (typeof obj["scorePercent"] !== "number") refuse(`Operation receipt ${operationId} result is missing scorePercent.`);
      for (const tally of ["correctCount", "incorrectCount", "dontKnowCount", "unansweredCount"]) {
        if (!Number.isInteger(obj[tally])) refuse(`Operation receipt ${operationId} result is missing tallies.`);
      }
    } else if (action === "abandon_attempt") {
      status("abandoned");
      nonEmpty("completedAt");
    }
  }

  // 10. Triggers against the registered migration contract.
  for (const trigger of [
    "trg_enforce_response_item_version_insert",
    "trg_enforce_response_item_version_update",
    "trg_cleanup_material_delete",
  ]) {
    const triggerSql = "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?";
    const [actual] = await query(triggerSql, [trigger]);
    if (!actual) refuse(`The database is missing required trigger: ${trigger}`);
    const [ref] = await reference(triggerSql, [trigger]);
    if (!ref || normalizeSql(text(actual, "sql")) !== normalizeSql(text(ref, "sql"))) {
      refuse(`The trigger ${trigger} does not match the registered migration contract.`);
    }
  }
}

function parseOptions(json: string, owner: string): unknown[] {
  let options: unknown;
  try {
    options = JSON.parse(json);
  } catch {
    refuse(`${owner} has invalid options JSON.`);
  }
  if (!Array.isArray(options)) refuse(`${owner} has invalid options JSON.`);
  return options;
}

/* ------------------------------------------------------------------ */
/* Schema 12: card reviews (native `verify_schema_12_card_semantics`)  */
/* ------------------------------------------------------------------ */

const CARD_TABLES = [
  "card_review_generations",
  "card_versions",
  "card_items",
  "card_review_state",
  "card_review_events",
  "card_review_operations",
] as const;

const CARD_ITEM_ACTIONS = ["rate", "suspend", "resume", "flag", "unflag"];
const CARD_FLAGS = ["wrong_answer", "unclear", "not_in_source"];
const UUID_V4_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64_LOWER = /^[0-9a-f]{64}$/;
const SCHEDULE_KEYS = ["dueAt", "lapses", "lastReviewedAt", "reps", "schedulerVersion", "step"];
const ITEM_RESULT_KEYS = ["action", "dueAt", "flag", "generation", "itemId", "reviewedAt", "revision", "suspended"];
const RESET_RESULT_KEYS = ["action", "generation", "materialId"];

function timestamp(value: unknown, owner: string): string {
  if (!isIsoInstant(value)) refuse(`${owner} has a malformed timestamp.`);
  return value;
}

function jsonObject(json: string, owner: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    refuse(`${owner} has malformed JSON.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse(`${owner} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function exactJsonKeys(object: Record<string, unknown>, keys: readonly string[], owner: string): void {
  const own = Object.keys(object).sort();
  if (own.length !== keys.length || own.some((key, i) => key !== keys[i])) refuse(`${owner} has unexpected fields.`);
}

const isNonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A stored `simple-v1` schedule: exact fields, the step's delay from the review time. */
function checkSchedule(value: Record<string, unknown>, owner: string): void {
  exactJsonKeys(value, SCHEDULE_KEYS, owner);
  if (value.schedulerVersion !== SCHEDULER_VERSION) refuse(`${owner} has an unknown scheduler version.`);
  const step = value.step;
  if (typeof step !== "number" || !Number.isInteger(step) || step < -1 || step > 7) refuse(`${owner} has an invalid step.`);
  if (!isNonNegativeInteger(value.reps) || value.reps < 1 || !isNonNegativeInteger(value.lapses)) refuse(`${owner} has invalid counts.`);
  const last = timestamp(value.lastReviewedAt, owner);
  const due = timestamp(value.dueAt, owner);
  if (Date.parse(due) - Date.parse(last) !== stepDelayMs(step)) refuse(`${owner} has a due time inconsistent with its step.`);
}

/** The schema-12 card-review contract (native `verify_schema_12_card_semantics`). */
export async function validateCardReviewState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  if ((await query("PRAGMA foreign_key_check", [])).length > 0) refuse("The database violates foreign key constraints.");

  // 1. Tables, columns, foreign keys and CHECK constraints against the reference.
  for (const table of CARD_TABLES) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing required table: ${table}`);
    }
    const columnsSql = `SELECT name, type, "notnull" AS required, pk FROM pragma_table_info('${table}')`;
    const actual = await query(columnsSql, []);
    const expected = await reference(columnsSql, []);
    const byName = new Map(actual.map((row) => [text(row, "name"), row]));
    if (actual.length !== expected.length) refuse(`Table ${table} columns do not match the registered migration contract.`);
    for (const ref of expected) {
      const name = text(ref, "name");
      const column = byName.get(name);
      if (!column) refuse(`Table ${table} is missing required column: ${name}`);
      if (
        text(column, "type").toLowerCase() !== text(ref, "type").toLowerCase() ||
        int(column, "required") !== int(ref, "required") ||
        int(column, "pk") !== int(ref, "pk")
      ) {
        refuse(`Table ${table} column ${name} does not match the registered migration contract.`);
      }
    }
    if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {
      refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    }
  }

  // 2. Uniqueness and indexes.
  for (const [table, columns] of [
    ["card_versions", ["source_material_id", "content_hash"]],
    ["card_items", ["version_id", "ordinal"]],
  ] as const) {
    let found = false;
    for (const index of await query(`SELECT name, "unique" AS is_unique, partial FROM pragma_index_list('${table}')`, [])) {
      if (int(index, "is_unique") === 1 && int(index, "partial") === 0 && same(await indexColumns(query, text(index, "name")), columns)) {
        found = true;
      }
    }
    if (!found) refuse(`Table ${table} is missing compound UNIQUE constraint on (${columns.join(", ")}).`);
  }
  const [active] = await query(`SELECT "unique" AS is_unique FROM pragma_index_list('card_versions') WHERE name = ?`, ["uq_active_card_version"]);
  if (!active || int(active, "is_unique") !== 1) refuse("The database is missing required unique index: uq_active_card_version");
  for (const [table, index] of [
    ["card_versions", "uq_active_card_version"],
    ["card_review_state", "idx_card_state_due"],
    ["card_review_events", "idx_card_events_item"],
    ["card_review_operations", "idx_card_ops_material"],
  ] as const) {
    if ((await query(`SELECT 1 FROM pragma_index_list('${table}') WHERE name = ?`, [index])).length === 0) {
      refuse(`The database is missing required index: ${index}`);
    }
    const indexSql = "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?";
    const [mine] = await query(indexSql, [index]);
    const [ref] = await reference(indexSql, [index]);
    if (!mine || !ref || normalizeSql(text(mine, "sql")) !== normalizeSql(text(ref, "sql"))) {
      refuse(`Index ${index} does not match the registered migration contract.`);
    }
  }

  // 3. The deletion trigger.
  {
    const triggerSql = "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?";
    const [mine] = await query(triggerSql, ["trg_card_ops_material_delete"]);
    if (!mine) refuse("The database is missing required trigger: trg_card_ops_material_delete");
    const [ref] = await reference(triggerSql, ["trg_card_ops_material_delete"]);
    if (!ref || normalizeSql(text(mine, "sql")) !== normalizeSql(text(ref, "sql"))) {
      refuse("The trigger trg_card_ops_material_delete does not match the registered migration contract.");
    }
  }

  // 4. Ownership.
  for (const [sql, problem] of [
    [
      `SELECT COUNT(*) AS n FROM card_review_state s
       JOIN card_items i ON i.id = s.item_id JOIN card_versions v ON v.id = i.version_id
       WHERE s.source_material_id != v.source_material_id`,
      "card review state owned by a material other than its card's",
    ],
    [
      `SELECT COUNT(*) AS n FROM (SELECT source_material_id FROM card_versions WHERE is_active = 1
       GROUP BY source_material_id HAVING COUNT(*) > 1)`,
      "more than one active card version for a material",
    ],
  ] as const) {
    if ((await count(query, sql)) > 0) refuse(`The database contains ${problem}.`);
  }

  // 5. Identity: every snapshot is recomputable from its stored text. Schema 16
  //    keeps who wrote each card beside it; that origin is part of the hash.
  const hasOrigins =
    (await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'card_item_origins'")) === 1;
  const itemSql = hasOrigins
    ? `SELECT i.id, i.ordinal, i.front, i.back, i.source_page, o.origin FROM card_items i
       LEFT JOIN card_item_origins o ON o.item_id = i.id
       WHERE i.version_id = ? ORDER BY i.ordinal ASC`
    : "SELECT id, ordinal, front, back, source_page, NULL AS origin FROM card_items WHERE version_id = ? ORDER BY ordinal ASC";
  for (const version of await query(
    "SELECT id, source_material_id, content_hash, card_count, created_at, first_reviewed_at FROM card_versions",
    [],
  )) {
    const versionId = text(version, "id");
    const owner = `Card version ${versionId}`;
    timestamp(text(version, "created_at"), owner);
    const firstReviewed = optText(version, "first_reviewed_at");
    if (firstReviewed !== null) timestamp(firstReviewed, owner);
    const contentHash = text(version, "content_hash");
    if ((await sha256Hex(`${text(version, "source_material_id")}\u0000${contentHash}`)) !== versionId) {
      refuse(`${owner} cannot be recomputed from its material and content.`);
    }
    const items = await query(itemSql, [versionId]);
    if (items.length !== int(version, "card_count")) refuse(`${owner} card_count does not match its cards.`);
    const cards: CanonicalCard[] = [];
    for (const [expected, item] of items.entries()) {
      const itemId = text(item, "id");
      if (int(item, "ordinal") !== expected) refuse(`Card ${itemId} has a non-contiguous ordinal.`);
      if ((await sha256Hex(`${versionId}\u0000${expected}`)) !== itemId) refuse(`Card ${itemId} cannot be recomputed.`);
      const front = text(item, "front");
      const back = text(item, "back");
      const sourcePage = optInt(item, "source_page");
      if (!isValidCardText(front, MAX_FRONT_CHARS) || !isValidCardText(back, MAX_BACK_CHARS)) refuse(`Card ${itemId} has invalid text.`);
      if (sourcePage !== null && (sourcePage < 1 || sourcePage > MAX_SOURCE_PAGE)) refuse(`Card ${itemId} has an out-of-bounds source page.`);
      const origin = optText(item, "origin");
      if (origin !== null && origin !== "user" && origin !== "instructor") refuse(`Card ${itemId} has an unknown origin.`);
      cards.push(origin ? { front, back, sourcePage, origin } : { front, back, sourcePage });
    }
    if ((await sha256Hex(canonicalJson(cards))) !== contentHash) refuse(`${owner} content hash does not match its cards.`);
    if (hasOrigins) {
      const [stored] = await query("SELECT origin FROM card_version_origins WHERE version_id = ?", [versionId]);
      if ((stored ? text(stored, "origin") : null) !== versionOrigin(cards)) refuse(`${owner} origin does not match its cards.`);
    }
  }

  // 6. Generations of existing materials (a missing row is generation 0).
  const generations = new Map<string, number>();
  for (const row of await query("SELECT source_material_id, generation FROM card_review_generations", [])) {
    generations.set(text(row, "source_material_id"), int(row, "generation"));
  }
  const generationOf = (materialId: string) => generations.get(materialId) ?? 0;

  // 7. Receipts: typed by action; tombstones keep routing metadata only.
  const liveRates = new Map<string, string>();
  for (const receipt of await query(
    `SELECT operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json
     FROM card_review_operations`,
    [],
  )) {
    const operationId = text(receipt, "operation_id");
    const owner = `Card review receipt ${operationId}`;
    if (!UUID_V4_LOWER.test(operationId)) refuse(`${owner} is not a valid UUIDv4.`);
    if (!HEX_64_LOWER.test(text(receipt, "request_hash"))) refuse(`${owner} has an invalid request hash.`);
    timestamp(text(receipt, "applied_at"), owner);
    const action = text(receipt, "action");
    const materialId = text(receipt, "source_material_id");
    const generation = int(receipt, "generation");
    if (materialId.trim() === "") refuse(`${owner} has no material.`);
    if (int(receipt, "is_erased") === 1) {
      if (optText(receipt, "result_json") !== null) refuse(`${owner} is erased but still holds a result.`);
      continue;
    }
    const resultJson = optText(receipt, "result_json");
    if (resultJson === null) refuse(`${owner} is live but has no result.`);
    const result = jsonObject(resultJson, owner);
    const current = generationOf(materialId);
    if (action === "reset") {
      exactJsonKeys(result, RESET_RESULT_KEYS, owner);
      if (result.action !== "reset" || result.materialId !== materialId) refuse(`${owner} result does not match its receipt.`);
      if (result.generation !== generation + 1) refuse(`${owner} result generation is not the captured generation plus one.`);
      if (generation + 1 !== current) refuse(`${owner} is a live reset older than the current generation.`);
      continue;
    }
    if (!CARD_ITEM_ACTIONS.includes(action)) refuse(`${owner} has an unknown action.`);
    exactJsonKeys(result, ITEM_RESULT_KEYS, owner);
    if (result.action !== action || result.generation !== generation) refuse(`${owner} result does not match its receipt.`);
    if (generation > current) refuse(`${owner} has a generation above its material's current generation.`);
    if (generation < current) refuse(`${owner} is a live item receipt from before the latest reset.`);
    const itemId = result.itemId;
    if (typeof itemId !== "string" || !HEX_64_LOWER.test(itemId)) refuse(`${owner} result names no card.`);
    const owned = await count(
      query,
      `SELECT COUNT(*) AS n FROM card_items i JOIN card_versions v ON v.id = i.version_id
       WHERE i.id = ? AND v.source_material_id = ?`,
      [itemId, materialId],
    );
    if (owned !== 1) refuse(`${owner} result names a card that is not this material's.`);
    if (typeof result.revision !== "number" || !Number.isInteger(result.revision) || result.revision < 1) {
      refuse(`${owner} result has an invalid revision.`);
    }
    if (result.dueAt !== null) timestamp(result.dueAt, owner);
    if (result.reviewedAt !== null) timestamp(result.reviewedAt, owner);
    if (typeof result.suspended !== "boolean") refuse(`${owner} result has an invalid paused flag.`);
    if (result.flag !== null && !CARD_FLAGS.includes(result.flag as string)) refuse(`${owner} result has an invalid flag.`);
    if (action === "rate") {
      if (result.reviewedAt === null || result.dueAt === null) refuse(`${owner} rating result has no review time.`);
      liveRates.set(operationId, itemId);
    } else if (result.reviewedAt !== null) {
      refuse(`${owner} non-rating result has a review time.`);
    }
  }

  // 8. Events: immutable ratings of the current generation, each with its receipt.
  const eventsByItem = new Map<string, Record<string, unknown>[]>();
  for (const event of await query(
    `SELECT e.id, e.item_id, e.generation, e.rating, e.reviewed_at, e.scheduler_version, e.prior_state_json, e.next_state_json,
            v.source_material_id
     FROM card_review_events e JOIN card_items i ON i.id = e.item_id JOIN card_versions v ON v.id = i.version_id`,
    [],
  )) {
    const id = text(event, "id");
    const owner = `Card review event ${id}`;
    if (!UUID_V4_LOWER.test(id)) refuse(`${owner} is not a valid UUIDv4.`);
    const itemId = text(event, "item_id");
    const generation = int(event, "generation");
    const current = generationOf(text(event, "source_material_id"));
    if (generation > current) refuse(`${owner} has a generation above its material's current generation.`);
    if (generation < current) refuse(`${owner} is from before the latest reset.`);
    if (liveRates.get(id) !== itemId) refuse(`${owner} has no matching live rating receipt.`);
    if (text(event, "scheduler_version") !== SCHEDULER_VERSION) refuse(`${owner} has an unknown scheduler version.`);
    const reviewedAt = timestamp(text(event, "reviewed_at"), owner);
    const next = jsonObject(text(event, "next_state_json"), owner);
    checkSchedule(next, owner);
    if (next.lastReviewedAt !== reviewedAt) refuse(`${owner} next state does not match its review time.`);
    const priorJson = text(event, "prior_state_json");
    if (priorJson !== "null") checkSchedule(jsonObject(priorJson, owner), owner);
    const list = eventsByItem.get(itemId) ?? [];
    list.push(next);
    eventsByItem.set(itemId, list);
  }

  // 9. Projection against its events.
  for (const state of await query(
    `SELECT item_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, revision FROM card_review_state`,
    [],
  )) {
    const itemId = text(state, "item_id");
    const owner = `Card review state ${itemId}`;
    if (text(state, "scheduler_version") !== SCHEDULER_VERSION) refuse(`${owner} has an unknown scheduler version.`);
    const events = eventsByItem.get(itemId) ?? [];
    const dueAt = optText(state, "due_at");
    const lastReviewedAt = optText(state, "last_reviewed_at");
    const reps = int(state, "reps");
    if (dueAt === null || lastReviewedAt === null) {
      if (events.length > 0) refuse(`${owner} is never rated but has rating events.`);
      if (dueAt !== lastReviewedAt) refuse(`${owner} has a due time without a review time.`);
      continue;
    }
    const step = int(state, "step");
    timestamp(dueAt, owner);
    timestamp(lastReviewedAt, owner);
    if (Date.parse(dueAt) - Date.parse(lastReviewedAt) !== stepDelayMs(step)) refuse(`${owner} has a due time inconsistent with its step.`);
    if (events.length !== reps) refuse(`${owner} reps does not match its rating events.`);
    if (int(state, "revision") < events.length) refuse(`${owner} revision is below its rating count.`);
    const repsSeen = events.map((next) => next.reps as number).sort((a, b) => a - b);
    if (repsSeen.some((value, i) => value !== i + 1)) refuse(`${owner} rating events do not form one history.`);
    const latest = events.find((next) => next.reps === reps)!;
    if (
      latest.step !== step ||
      latest.dueAt !== dueAt ||
      latest.lastReviewedAt !== lastReviewedAt ||
      latest.lapses !== int(state, "lapses")
    ) {
      refuse(`${owner} does not match its latest rating event.`);
    }
  }
  for (const itemId of eventsByItem.keys()) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM card_review_state WHERE item_id = ?", [itemId])) !== 1) {
      refuse(`Card ${itemId} has rating events but no review state.`);
    }
  }
}

/* ------------------- schema 13: split lineage ------------------- */

const LINEAGE_TABLES = ["material_split_lineage", "split_operation_log"] as const;
const LINEAGE_INDEXES = [
  ["material_split_lineage", "idx_split_lineage_parent"],
  ["material_split_lineage", "idx_split_lineage_root"],
  ["split_operation_log", "idx_split_operation_source"],
  ["split_operation_log", "idx_split_operation_status"],
] as const;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

/**
 * The schema-13 split-lineage contract (native `verify_schema_13_lineage_semantics`):
 * the tables exactly as migration 0013 defines them, its indexes, well-formed
 * fingerprints, and split records whose hash is the hash of their receipt.
 */
export async function validateSplitLineageState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  for (const table of LINEAGE_TABLES) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing required table: ${table}`);
    }
    const columnsSql = `SELECT name, type, "notnull" AS required, pk FROM pragma_table_info('${table}') ORDER BY name`;
    const shape = (rows: Record<string, unknown>[]) =>
      rows.map((row) => `${text(row, "name")}|${text(row, "type").toLowerCase()}|${int(row, "required")}|${int(row, "pk")}`);
    if (!same(shape(await query(columnsSql, [])), shape(await reference(columnsSql, [])))) {
      refuse(`Table ${table} columns do not match the registered migration contract.`);
    }
    if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {
      refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    }
  }
  for (const [table, index] of LINEAGE_INDEXES) {
    if ((await count(query, `SELECT COUNT(*) AS n FROM pragma_index_list('${table}') WHERE name = ?`, [index])) === 0) {
      refuse(`The database is missing required index: ${index}`);
    }
  }
  for (const row of await query(
    "SELECT material_id, source_content_sha256, parent_content_sha256 FROM material_split_lineage",
    [],
  )) {
    for (const key of ["source_content_sha256", "parent_content_sha256"]) {
      const hash = row[key];
      if (hash !== null && (typeof hash !== "string" || !LOWER_HEX_64.test(hash))) {
        refuse(`Split part ${text(row, "material_id")} has a malformed source fingerprint.`);
      }
    }
  }
  for (const row of await query(
    "SELECT operation_id, receipt_hash, receipt_canonical_json FROM split_operation_log",
    [],
  )) {
    const operation = text(row, "operation_id");
    const hash = text(row, "receipt_hash");
    if (!LOWER_HEX_64.test(hash) || operation !== hash || (await sha256Hex(text(row, "receipt_canonical_json"))) !== hash) {
      refuse(`Split record ${operation} does not match its receipt.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Schema 14: skills and feedback evidence                             */
/* (native twin: `verify_schema_14_skill_evidence_semantics`)          */
/* ------------------------------------------------------------------ */

export const SKILL_EVIDENCE_TABLES = [
  "skill_catalog_entries",
  "skill_catalog_revisions",
  "skill_observations",
  "skill_observation_revisions",
  "skill_self_assessments",
  "skill_evidence_operations",
] as const;

export const SKILL_EVIDENCE_INDEXES = [
  ["skill_observations", "idx_skill_observations_page"],
  ["skill_observations", "idx_skill_observations_skill_page"],
  ["skill_observations", "idx_skill_observations_journal"],
  ["skill_observations", "idx_skill_observations_source_journal"],
  ["skill_observations", "idx_skill_observations_action"],
  ["skill_evidence_operations", "idx_skill_evidence_operations_subject"],
] as const;

export const SKILL_EVIDENCE_TRIGGERS = [
  "trg_skill_catalog_revisions_no_update",
  "trg_skill_catalog_revisions_no_delete",
  "trg_skill_observation_revisions_no_update",
  "trg_skill_observation_revisions_no_partial_delete",
  "trg_skill_self_assessments_no_update",
  "trg_skill_self_assessments_no_delete",
] as const;

const MAX_CUSTOM_SKILLS = 200;

const m3Str = (v: unknown) => (v == null ? null : String(v));

async function m3Count(q: ValidationQuery, sql: string, params: SqlValue[] = []): Promise<number> {
  const [row] = await q(sql, params);
  return row ? Number(Object.values(row)[0]) : 0;
}

async function m3ForeignKeys(q: ValidationQuery, table: string): Promise<string[]> {
  const list = await q(
    `SELECT id, "table" AS parent, "from" AS child, "to" AS target, on_update, on_delete, "match" AS matching
       FROM pragma_foreign_key_list('${table}') ORDER BY id, seq`,
    [],
  );
  const grouped = new Map<number, string[]>();
  for (const r of list) {
    const id = Number(r["id"]);
    const head = [
      String(r["parent"]).toLowerCase(),
      String(r["on_update"]).toUpperCase(),
      String(r["on_delete"]).toUpperCase(),
      String(r["matching"]).toUpperCase(),
    ].join("|");
    const entry = grouped.get(id) ?? [head];
    entry.push(`${String(r["child"]).toLowerCase()}>${m3Str(r["target"])?.toLowerCase() ?? ""}`);
    grouped.set(id, entry);
  }
  return [...grouped.values()].map((e) => e.join("|")).sort();
}

async function m3Columns(q: ValidationQuery, table: string): Promise<string[]> {
  return (await q(`SELECT name, type, "notnull" AS required, pk, dflt_value FROM pragma_table_info('${table}') ORDER BY name`, [])).map(
    (r) => `${String(r["name"])}|${String(r["type"]).toLowerCase()}|${Number(r["required"])}|${Number(r["pk"])}|${m3Str(r["dflt_value"]) ?? ""}`,
  );
}

async function m3MasterSql(q: ValidationQuery, type: "table" | "trigger", name: string): Promise<string | null> {
  const [r] = await q("SELECT sql FROM sqlite_master WHERE type = ? AND name = ?", [type, name]);
  return r ? String(r["sql"]) : null;
}

/** Primary-key and UNIQUE constraint indexes, by columns (names are generated). */
async function m3KeyIndexes(q: ValidationQuery, table: string): Promise<string[]> {
  const out: string[] = [];
  for (const r of await q(`SELECT name, origin FROM pragma_index_list('${table}') WHERE origin IN ('pk', 'u')`, [])) {
    const cols = (await q(`SELECT name FROM pragma_index_info('${String(r["name"])}') ORDER BY seqno`, [])).map((c) => String(c["name"]));
    out.push(`${String(r["origin"])}|${cols.join(",")}`);
  }
  return out.sort();
}

async function m3IndexShape(q: ValidationQuery, table: string, index: string): Promise<string | null> {
  const [listed] = await q(`SELECT "unique" AS uniq FROM pragma_index_list('${table}') WHERE name = ?`, [index]);
  if (!listed) return null;
  const cols = (await q(`SELECT name FROM pragma_index_info('${index}') ORDER BY seqno`, [])).map((r) => String(r["name"]));
  return `${Number(listed["uniq"])}|${cols.join(",")}`;
}

/**
 * The schema-14 contract a restored or opened database must meet: exact
 * shape (columns, defaults, foreign keys, CHECKs, keys, indexes, triggers),
 * the shipped built-in catalog, contiguous histories whose latest entry is the
 * head, legal catalog steps with unique active names (M3-R6), receipts that
 * own exactly the history they name (M3-R5) and history owned by its receipt
 * (M3-R9). Shared contract: `src-tauri/fixtures/skill-evidence/validation-cases.json`.
 */
export async function validateSkillEvidenceState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  // 1. Exact table shape.
  for (const table of SKILL_EVIDENCE_TABLES) {
    const sql = await m3MasterSql(query, "table", table);
    if (sql === null) refuse(`The database is missing required table: ${table}`);
    const refSql = (await m3MasterSql(reference, "table", table))!;
    if (!same(await m3Columns(query, table), await m3Columns(reference, table))) {
      refuse(`Table ${table} columns do not match the registered migration contract.`);
    }
    if (!same(await m3ForeignKeys(query, table), await m3ForeignKeys(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(sql), checkConstraints(refSql))) refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    if (!same(await m3KeyIndexes(query, table), await m3KeyIndexes(reference, table))) {
      refuse(`Table ${table} keys do not match the registered migration contract.`);
    }
  }
  for (const [table, index] of SKILL_EVIDENCE_INDEXES) {
    const actual = await m3IndexShape(query, table, index);
    if (actual === null) refuse(`The database is missing required index: ${index}`);
    if (actual !== (await m3IndexShape(reference, table, index))) refuse(`Index ${index} does not match the registered migration contract.`);
  }
  for (const trigger of SKILL_EVIDENCE_TRIGGERS) {
    const sql = await m3MasterSql(query, "trigger", trigger);
    if (sql === null) refuse(`The database is missing required trigger: ${trigger}`);
    if (normalizeSql(sql) !== normalizeSql((await m3MasterSql(reference, "trigger", trigger))!)) {
      refuse(`Trigger ${trigger} does not match the registered migration contract.`);
    }
  }

  // 2. Relationships hold (foreign keys are not re-checked by SQLite on restore).
  for (const table of SKILL_EVIDENCE_TABLES) {
    if ((await query(`SELECT 1 FROM pragma_foreign_key_check('${table}') LIMIT 1`, [])).length > 0) {
      refuse(`Table ${table} has a record pointing at something that does not exist.`);
    }
  }

  // 3. The built-in catalog is exactly the shipped one: no unknown, no missing
  //    ids, and revision 1 of each is the shipped text.
  const shipped = new Map<string, Record<string, unknown>>();
  for (const r of await reference("SELECT * FROM skill_catalog_revisions WHERE revision = 1 AND changed_by = 'catalog'", [])) {
    shipped.set(String(r["skill_id"]), r);
  }
  const builtins = await query("SELECT id FROM skill_catalog_entries WHERE origin = 'builtin'", []);
  if (builtins.length !== shipped.size || builtins.some((r) => !shipped.has(String(r["id"])))) {
    refuse("The built-in skill catalog does not match this version of the app.");
  }
  for (const [id, ref] of shipped) {
    const [first] = await query("SELECT * FROM skill_catalog_revisions WHERE skill_id = ? AND revision = 1", [id]);
    if (!first || ["label", "description", "topic", "status", "catalog_version", "changed_by", "changed_at"].some((k) => m3Str(first[k]) !== m3Str(ref[k]))) {
      refuse(`Built-in skill ${id} does not match the shipped catalog.`);
    }
  }
  if ((await m3Count(query, "SELECT COUNT(*) AS n FROM skill_catalog_entries WHERE origin = 'custom'")) > MAX_CUSTOM_SKILLS) {
    refuse("There are more custom skills than this app supports.");
  }

  // 4. Skill history is contiguous, its latest entry is the current skill, and
  //    every step is a change the write path can make:
  //    - built-in wording (label, description, topic) and catalog version are
  //      pinned in every revision and the head; only retire/restore changes them;
  //    - custom revisions carry no catalog version and are all hers;
  //    - active -> active changes wording (an edit); active <-> retired keeps it.
  //    Active names are unique under the write path's labelKey (NFC, trimmed,
  //    whitespace collapsed, lower-cased). Retired names may repeat.
  const pinned = ["label", "description", "topic", "catalog_version"] as const;
  const wording = ["label", "description", "topic"] as const;
  const activeNames = new Map<string, string>();
  for (const skill of await query("SELECT * FROM skill_catalog_entries ORDER BY id", [])) {
    const id = String(skill["id"]);
    const history = await query("SELECT * FROM skill_catalog_revisions WHERE skill_id = ? ORDER BY revision", [id]);
    if (history.length !== Number(skill["revision"]) || history.some((h, i) => Number(h["revision"]) !== i + 1)) {
      refuse(`Skill ${id} has gaps in its history.`);
    }
    const latest = history.at(-1)!;
    if (["label", "description", "topic", "status", "catalog_version"].some((k) => m3Str(latest[k]) !== m3Str(skill[k]))) {
      refuse(`Skill ${id} does not match its latest history entry.`);
    }
    const builtin = skill["origin"] === "builtin";
    const ref = builtin ? shipped.get(id)! : null;
    history.forEach((h, i) => {
      if (ref && pinned.some((k) => m3Str(h[k]) !== m3Str(ref[k]))) refuse(`Built-in skill ${id} changed its catalog wording.`);
      if (!builtin && h["catalog_version"] != null) refuse(`Custom skill ${id} has a catalog version.`);
      if (i === 0) {
        if (!builtin && (h["changed_by"] !== "user" || h["status"] !== "active")) refuse(`Custom skill ${id} did not start as an active skill of yours.`);
        return;
      }
      const prev = history[i - 1]!;
      if (h["changed_by"] !== "user") refuse(`Skill ${id} has a later revision that is not a recorded change.`);
      const sameWording = wording.every((k) => m3Str(h[k]) === m3Str(prev[k]));
      const step = `${String(prev["status"])}>${String(h["status"])}`;
      const legal = step === "active>active" ? !sameWording : (step === "active>retired" || step === "retired>active") && sameWording;
      if (!legal) refuse(`Skill ${id} has a history step the app cannot make.`);
    });
    if (skill["status"] === "active") {
      const key = labelKey(String(skill["label"]));
      const other = activeNames.get(key);
      if (other !== undefined) refuse(`Active skills ${other} and ${id} have the same name.`);
      activeNames.set(key, id);
    }
  }

  // 5. Observation history is contiguous and its latest entry is the current observation.
  for (const obs of await query("SELECT * FROM skill_observations", [])) {
    const id = String(obs["id"]);
    const history = await query("SELECT * FROM skill_observation_revisions WHERE observation_id = ? ORDER BY revision", [id]);
    if (history.length !== Number(obs["revision"]) || history.some((h, i) => Number(h["revision"]) !== i + 1)) {
      refuse(`Observation ${id} has gaps in its history.`);
    }
    const latest = history.at(-1)!;
    const fields = ["wording", "observed_on", "attribution", "instructor_name", "linked_action_id", "linked_action_title", "addressed_at"];
    if (fields.some((k) => m3Str(obs[k]) !== m3Str(latest[k]))) refuse(`Observation ${id} does not match its latest history entry.`);
    if (obs["journal_id"] != null && obs["journal_id"] !== obs["source_journal_id"]) {
      refuse(`Observation ${id} points at a different debrief than it was recorded from.`);
    }
  }

  // 6. Self-assessment sequences are contiguous per skill and kind.
  for (const group of await query(
    "SELECT skill_id, kind, COUNT(*) AS n, MIN(sequence) AS lo, MAX(sequence) AS hi FROM skill_self_assessments GROUP BY skill_id, kind",
    [],
  )) {
    if (Number(group["lo"]) !== 1 || Number(group["hi"]) !== Number(group["n"])) {
      refuse(`Skill ${String(group["skill_id"])} has gaps in its ${String(group["kind"])} history.`);
    }
  }

  // 7. Receipts. A live receipt's result is decoded exactly for its action,
  //    names the receipt's own subject, and points at the history row that
  //    this same operation wrote, of the kind that action writes. Earlier
  //    receipts stay valid after later edits, a cleared status, or a deleted
  //    debrief or action, because the row they name never changes. Erasure:
  //    tombstones are non-content observation receipts whose subject is gone;
  //    a live erase receipt leaves no live receipt for its subject.
  const live = new Map<string, { action: SkillEvidenceActionName; subject: string; n: number }>();
  for (const op of await query("SELECT * FROM skill_evidence_operations ORDER BY rowid", [])) {
    const id = String(op["operation_id"]);
    const action = String(op["action"]) as SkillEvidenceActionName;
    const subject = String(op["subject_id"]);
    const observationPresent = async () => (await m3Count(query, "SELECT COUNT(*) AS n FROM skill_observations WHERE id = ?", [subject])) > 0;
    if (Number(op["is_erased"]) !== 0) {
      if (!OBSERVATION_HISTORY_ACTIONS.has(action)) refuse(`Operation ${id} is erased, but only observation changes can be erased.`);
      if (await observationPresent()) refuse(`Operation ${id} says its observation was erased, but it is still here.`);
      continue;
    }
    let result: Record<string, unknown>;
    try {
      result = decodeStoredResult(op["result_json"], { action, subjectId: subject }) as unknown as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ResultShapeError) refuse(`Operation ${id} has an invalid result: ${error.message}`);
      throw error;
    }
    live.set(id, { action, subject, n: Number(result["revision"] ?? result["sequence"] ?? 0) });
    if (SKILL_ACTIONS.has(action)) {
      const revision = Number(result["revision"]);
      const [row] = await query("SELECT * FROM skill_catalog_revisions WHERE skill_id = ? AND revision = ?", [subject, revision]);
      if (!row || row["operation_id"] !== id || row["changed_by"] !== "user") refuse(`Operation ${id} does not own the skill history it names.`);
      const [prev] =
        revision > 1 ? await query("SELECT status FROM skill_catalog_revisions WHERE skill_id = ? AND revision = ?", [subject, revision - 1]) : [];
      const fits =
        action === "create_custom_skill" ? subject.startsWith("custom.") && row["status"] === "active"
        : action === "edit_custom_skill" ? row["status"] === "active" && prev?.["status"] === "active"
        : action === "retire_skill" ? row["status"] === "retired"
        : row["status"] === "active" && prev?.["status"] === "retired";
      if (!fits) refuse(`Operation ${id} names a skill change of a different kind.`);
    } else if (OBSERVATION_HISTORY_ACTIONS.has(action)) {
      if (!(await observationPresent())) refuse(`Operation ${id} is a live record of an observation that is not here.`);
      const [row] = await query(
        "SELECT change_kind, operation_id FROM skill_observation_revisions WHERE observation_id = ? AND revision = ?",
        [subject, Number(result["revision"])],
      );
      const kinds: Record<string, string[]> = {
        create_observation: ["created"],
        edit_observation: ["edited"],
        link_action: ["linked_action"],
        unlink_action: ["unlinked_action"],
        set_addressed: ["marked_addressed", "cleared_addressed"],
      };
      if (!row || row["operation_id"] !== id) refuse(`Operation ${id} does not own the observation history it names.`);
      if (!kinds[action]!.includes(String(row["change_kind"]))) refuse(`Operation ${id} names an observation change of a different kind.`);
    } else if (ASSESSMENT_ACTIONS.has(action)) {
      const kind = action === "set_status" ? "status" : "confidence";
      const [row] = await query(
        "SELECT id, operation_id FROM skill_self_assessments WHERE skill_id = ? AND kind = ? AND sequence = ?",
        [subject, kind, Number(result["sequence"])],
      );
      if (!row || row["operation_id"] !== id || row["id"] !== id) refuse(`Operation ${id} does not own the self-assessment it names.`);
    } else {
      if (await observationPresent()) refuse(`Operation ${id} says it erased an observation that is still here.`);
      if (
        (await m3Count(
          query,
          "SELECT COUNT(*) AS n FROM skill_evidence_operations WHERE subject_id = ? AND is_erased = 0 AND action <> 'erase_observation'",
          [subject],
        )) > 0
      ) {
        refuse(`Operation ${id} erased an observation whose earlier records were not cleared.`);
      }
    }
  }

  // 8. History -> receipt (M3-R9). Every operation-owned history row has the
  //    live receipt that wrote it: same operation, an action of that family,
  //    the same subject and the same revision or sequence. With step 7 this is
  //    one-to-one, so a missing receipt or a reused operation id is refused.
  //    Catalog seeds (changed_by 'catalog', no operation) need none; erased
  //    observations have no history left, only their non-content tombstones.
  const owned = (operationId: unknown, families: ReadonlySet<SkillEvidenceActionName> | SkillEvidenceActionName, subject: unknown, n: unknown) => {
    const receipt = live.get(String(operationId));
    if (!receipt) return false;
    const familyOk = typeof families === "string" ? receipt.action === families : families.has(receipt.action);
    return familyOk && receipt.subject === String(subject) && receipt.n === Number(n);
  };
  for (const r of await query(
    "SELECT skill_id, revision, operation_id FROM skill_catalog_revisions WHERE changed_by = 'user' ORDER BY skill_id, revision",
    [],
  )) {
    if (!owned(r["operation_id"], SKILL_ACTIONS, r["skill_id"], r["revision"])) {
      refuse(`Skill ${String(r["skill_id"])} revision ${String(r["revision"])} has no matching operation record.`);
    }
  }
  for (const r of await query(
    "SELECT observation_id, revision, operation_id FROM skill_observation_revisions ORDER BY observation_id, revision",
    [],
  )) {
    if (!owned(r["operation_id"], OBSERVATION_HISTORY_ACTIONS, r["observation_id"], r["revision"])) {
      refuse(`Observation ${String(r["observation_id"])} revision ${String(r["revision"])} has no matching operation record.`);
    }
  }
  for (const r of await query(
    "SELECT skill_id, kind, sequence, operation_id FROM skill_self_assessments ORDER BY skill_id, kind, sequence",
    [],
  )) {
    const action: SkillEvidenceActionName = r["kind"] === "status" ? "set_status" : "set_confidence";
    if (!owned(r["operation_id"], action, r["skill_id"], r["sequence"])) {
      refuse(`Skill ${String(r["skill_id"])} ${String(r["kind"])} entry ${String(r["sequence"])} has no matching operation record.`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Schema 15: document navigation                                      */
/* (native twin: `verify_schema_15_navigation_semantics`)              */
/* ------------------------------------------------------------------ */

export const NAVIGATION_TABLES = [
  "material_content_identities",
  "material_reading_state",
  "material_bookmarks",
  "material_operation_claims",
] as const;

export const NAVIGATION_INDEXES = [
  ["material_content_identities", "idx_material_content_sha"],
  ["material_reading_state", "idx_material_reading_state_owner"],
  ["material_bookmarks", "idx_material_bookmarks_material"],
  ["material_bookmarks", "idx_material_bookmarks_page"],
  ["material_bookmarks", "idx_material_bookmarks_hash"],
] as const;

/** Bookmarks one material may hold (native `MAX_BOOKMARKS_PER_MATERIAL`). */
const NAVIGATION_BOOKMARKS_PER_MATERIAL = 500;

async function navigationColumns(query: ValidationQuery, table: string): Promise<string[]> {
  const rows = await query(
    `SELECT name, type, "notnull" AS required, pk, dflt_value FROM pragma_table_info('${table}') ORDER BY name`,
    [],
  );
  return rows.map(
    (row) => `${text(row, "name")}|${text(row, "type").toLowerCase()}|${int(row, "required")}|${int(row, "pk")}|${optText(row, "dflt_value") ?? ""}`,
  );
}

async function navigationKeyIndexes(query: ValidationQuery, table: string): Promise<string[]> {
  const out: string[] = [];
  for (const row of await query(`SELECT name, origin FROM pragma_index_list('${table}') WHERE origin IN ('pk', 'u')`, [])) {
    out.push(`${text(row, "origin")}|${(await indexColumns(query, text(row, "name"))).join(",")}`);
  }
  return out.sort();
}

async function navigationIndexShape(query: ValidationQuery, table: string, index: string): Promise<string | null> {
  const [listed] = await query(`SELECT "unique" AS uniq FROM pragma_index_list('${table}') WHERE name = ?`, [index]);
  if (!listed) return null;
  return `${int(listed, "uniq")}|${(await indexColumns(query, index)).join(",")}`;
}

/**
 * The schema-15 navigation contract: the four tables exactly as migration
 * 0015 defines them, their indexes, rows that point at real materials, and
 * ownership that is internally consistent.
 */
export async function validateNavigationState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  for (const table of NAVIGATION_TABLES) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing required table: ${table}`);
    }
    if (!same(await navigationColumns(query, table), await navigationColumns(reference, table))) {
      refuse(`Table ${table} columns do not match the registered migration contract.`);
    }
    if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {
      refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    }
    if (!same(await navigationKeyIndexes(query, table), await navigationKeyIndexes(reference, table))) {
      refuse(`Table ${table} keys do not match the registered migration contract.`);
    }
    if ((await query(`SELECT * FROM pragma_foreign_key_check('${table}')`, [])).length !== 0) {
      refuse(`Table ${table} has rows for study materials that no longer exist.`);
    }
  }
  for (const [table, index] of NAVIGATION_INDEXES) {
    if ((await navigationIndexShape(query, table, index)) !== (await navigationIndexShape(reference, table, index))) {
      refuse(`The database is missing required index: ${index}`);
    }
  }
  if ((await count(query, "SELECT COUNT(*) AS n FROM material_operation_claims WHERE cancelled_generation > reserved_generation")) !== 0) {
    refuse("A navigation claim cancels a request that was never issued.");
  }
  if (
    (await count(
      query,
      `SELECT COUNT(*) AS n FROM material_reading_state s
         LEFT JOIN material_operation_claims c ON c.material_id = s.material_id
        WHERE s.owner_generation > COALESCE(c.reserved_generation, 0)`,
    )) !== 0
  ) {
    refuse("A saved reading position belongs to a request that was never issued.");
  }
  if (
    (await count(
      query,
      `SELECT COUNT(*) AS n FROM (SELECT material_id FROM material_bookmarks GROUP BY material_id HAVING COUNT(*) > ${NAVIGATION_BOOKMARKS_PER_MATERIAL})`,
    )) !== 0
  ) {
    refuse("A study material has more bookmarks than the app supports.");
  }
}

/* ------------------------------------------------------------------ */
/* Schema 16: study material she makes herself                         */
/* (native twin: `verify_schema_16_manual_study_semantics`)            */
/* ------------------------------------------------------------------ */

export const MANUAL_STUDY_TABLES = [
  "study_set_history",
  "card_version_origins",
  "card_item_origins",
  "practice_item_origins",
  "ai_study_sets",
] as const;

/**
 * The OFFLINE-03 contract: the history and origin tables, and the two new
 * study-set columns, exactly as migration 0016 defines them; rows that point
 * at real materials, cards and questions; and well-formed stored provenance.
 * Card origins are checked against their snapshot hashes in schema 12.
 */
export async function validateManualStudyState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  for (const table of MANUAL_STUDY_TABLES) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing required table: ${table}`);
    }
    if (!same(await navigationColumns(query, table), await navigationColumns(reference, table))) {
      refuse(`Table ${table} columns do not match the registered migration contract.`);
    }
    if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {
      refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    }
    if (!same(await navigationKeyIndexes(query, table), await navigationKeyIndexes(reference, table))) {
      refuse(`Table ${table} keys do not match the registered migration contract.`);
    }
    if ((await query(`SELECT * FROM pragma_foreign_key_check('${table}')`, [])).length !== 0) {
      refuse(`Table ${table} has rows that point at nothing.`);
    }
  }
  if (
    (await navigationIndexShape(query, "study_set_history", "idx_study_set_history")) !==
    (await navigationIndexShape(reference, "study_set_history", "idx_study_set_history"))
  ) {
    refuse("The database is missing required index: idx_study_set_history");
  }
  const problem = await storedSetProblem(query);
  if (problem) refuse(problem);
}

/* ------------------------------------------------------------------ */
/* Schema 17: the practice questions she writes herself                */
/* (native twin: `verify_schema_17_practice_authoring_semantics`)      */
/* ------------------------------------------------------------------ */

export const PRACTICE_AUTHORING_TABLES = ["practice_save_operations"] as const;

const AUTHORING_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORING_ACTIONS = new Set(["create", "edit", "correct", "regenerate", "restore", "remove"]);

/**
 * The OFFLINE-03b contract: the receipts table exactly as migration 0017
 * defines it; the new columns on the two extended tables; receipts binding
 * material, action and the exact canonical payload bytes with a digest that
 * recomputes; retirement lists, historical envelopes and editor metadata
 * that decode strictly; identities that are unique per version and owned by
 * one living material; and a current mirror that agrees with the active
 * version. Column registration alone proves nothing.
 */
export async function validatePracticeAuthoringState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  for (const table of PRACTICE_AUTHORING_TABLES) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing required table: ${table}`);
    }
    if (!same(await navigationColumns(query, table), await navigationColumns(reference, table))) {
      refuse(`Table ${table} columns do not match the registered migration contract.`);
    }
    if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {
      refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    }
    if (!same(await navigationKeyIndexes(query, table), await navigationKeyIndexes(reference, table))) {
      refuse(`Table ${table} keys do not match the registered migration contract.`);
    }
    if ((await query(`SELECT * FROM pragma_foreign_key_check('${table}')`, [])).length !== 0) {
      refuse(`Table ${table} has rows that point at nothing.`);
    }
  }
  if (
    (await navigationIndexShape(query, "practice_save_operations", "idx_practice_save_ops_material")) !==
    (await navigationIndexShape(reference, "practice_save_operations", "idx_practice_save_ops_material"))
  ) {
    refuse("The database is missing required index: idx_practice_save_ops_material");
  }

  // The 0017 columns on the tables earlier migrations made.
  for (const [table, column, type, required] of [
    ["practice_tests", "retired_json", "TEXT", 1],
    ["practice_test_items", "logical_id", "TEXT", 0],
    ["practice_test_items", "replaces_id", "TEXT", 0],
  ] as const) {
    const [found] = await query(`SELECT type, "notnull" AS required FROM pragma_table_info('${table}') WHERE name = ?`, [column]);
    if (!found) refuse(`Table ${table} is missing required column: ${column}`);
    if (text(found, "type").toUpperCase() !== type) refuse(`Table ${table} column ${column} type mismatch.`);
    if (int(found, "required") !== required) refuse(`Table ${table} column ${column} notnull mismatch.`);
  }

  // Receipts: exact canonical payload bytes, a digest that recomputes, a
  // typed result, and the whole operation decoded by the writer's own strict
  // decoder, bound row-for-row to the operation id, material and action it is
  // keyed by. A reused operation id is only ever the same committed operation.
  for (const row of await query(
    "SELECT operation_id, material_id, action, payload_json, payload_hash, result_json FROM practice_save_operations",
    [],
  )) {
    const action = text(row, "action");
    if (!AUTHORING_ACTIONS.has(action)) refuse("A practice save receipt names an unknown action.");
    const payload = text(row, "payload_json");
    let operation: Record<string, unknown>;
    try {
      operation = JSON.parse(payload);
    } catch {
      refuse("A practice save receipt does not hold JSON.");
    }
    if (canonicalJson(operation) !== payload) {
      refuse("A practice save receipt does not hold its exact canonical payload bytes.");
    }
    let decoded: PracticeSaveOperation;
    try {
      decoded = decodePracticeOperation(operation);
    } catch {
      refuse("A practice save receipt does not hold a complete authoring operation.");
    }
    if (decoded.operationId !== text(row, "operation_id")) {
      refuse("A practice save receipt does not bind its operation id to its row key.");
    }
    if (decoded.sourceMaterialId !== text(row, "material_id") || decoded.reason !== action) {
      refuse("A practice save receipt does not bind its material and action.");
    }
    if (text(row, "payload_hash") !== (await sha256Hex(payload))) {
      refuse("A practice save receipt digest does not match its payload.");
    }
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text(row, "result_json"));
    } catch {
      refuse("A practice save receipt does not hold a typed result.");
    }
    const keys = Object.keys(result).sort().join(",");
    if (result["status"] !== "saved" || keys !== (action === "remove" ? "status" : "status,versionId")) {
      refuse("A practice save receipt does not hold a typed result.");
    }
    if (action !== "remove" && (typeof result["versionId"] !== "string" || !AUTHORING_UUID_V4.test(result["versionId"]))) {
      refuse("A practice save receipt does not name the version it saved.");
    }
  }

  // Editor metadata: identities and replacements are UUID v4, unique per
  // version, never shared by two living materials, and a recorded
  // replacement always sits beside an origin.
  for (const row of await query(
    "SELECT logical_id, replaces_id FROM practice_test_items WHERE logical_id IS NOT NULL OR replaces_id IS NOT NULL",
    [],
  )) {
    for (const column of ["logical_id", "replaces_id"] as const) {
      const value = row[column];
      if (value !== null && value !== undefined && !AUTHORING_UUID_V4.test(String(value))) {
        refuse(`A practice item carries a malformed ${column}.`);
      }
    }
  }
  if (
    (await count(query, `SELECT COUNT(*) AS n FROM (
        SELECT version_id, logical_id FROM practice_test_items
         WHERE logical_id IS NOT NULL GROUP BY version_id, logical_id HAVING COUNT(*) > 1)`, [])) !== 0
  ) {
    refuse("A practice version repeats one logical identity.");
  }
  if (
    (await count(query, `SELECT COUNT(*) AS n FROM (
        SELECT i.logical_id FROM practice_test_items i
          JOIN practice_test_versions v ON v.id = i.version_id
         WHERE i.logical_id IS NOT NULL AND v.source_material_id IS NOT NULL
         GROUP BY i.logical_id HAVING COUNT(DISTINCT v.source_material_id) > 1)`, [])) !== 0
  ) {
    refuse("Two study materials share one practice question identity.");
  }
  if (
    (await count(query, `SELECT COUNT(*) AS n FROM practice_test_items i
        WHERE i.replaces_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM practice_item_origins o WHERE o.item_id = i.id)`, [])) !== 0
  ) {
    refuse("A practice item records a replacement without an origin.");
  }

  // Stored retirement lists and historical envelopes decode strictly.
  for (const row of await query("SELECT retired_json FROM practice_tests", [])) {
    try {
      decodePracticeRetirements(JSON.parse(text(row, "retired_json")));
    } catch {
      refuse("A practice test carries a damaged retirement list.");
    }
  }
  for (const row of await query("SELECT previous_json FROM study_set_history WHERE kind = 'practice'", [])) {
    try {
      decodePracticeSnapshot(JSON.parse(text(row, "previous_json")));
    } catch {
      refuse("A saved practice history entry is not a valid snapshot.");
    }
  }

  // The current mirror agrees with the active version, and every active
  // version of a living material has its mirror row.
  if (
    (await count(query, `SELECT COUNT(*) AS n FROM practice_test_versions v
        WHERE v.is_active = 1 AND v.source_material_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM practice_tests t WHERE t.source_material_id = v.source_material_id)`, [])) !== 0
  ) {
    refuse("An active practice version has no current test row.");
  }
  for (const row of await query(
    "SELECT source_material_id, title, questions_json, provider, model, legacy_migrated_at FROM practice_tests",
    [],
  )) {
    const snapshot = await readCurrentSnapshot(query, text(row, "source_material_id"));
    if (!snapshot) {
      // A mirror with no active version is legitimate only while the legacy
      // row is unconverted or quarantined (established schema-11 states).
      // Once marked migrated — the state the authoring contract always
      // writes together with its version — the version must exist.
      if (row["legacy_migrated_at"] !== null && row["legacy_migrated_at"] !== undefined) {
        refuse("A migrated current practice test has no active version.");
      }
      continue;
    }
    if (
      snapshot.title !== text(row, "title") ||
      snapshot.provider !== text(row, "provider") ||
      snapshot.model !== text(row, "model")
    ) {
      refuse("The current practice test disagrees with its active version.");
    }
    let mirrored: unknown;
    try {
      mirrored = JSON.parse(text(row, "questions_json"));
    } catch {
      refuse("The current practice test does not hold JSON questions.");
    }
    const projected = snapshot.questions.map(({ question, options, correctIndex, explanation, sourcePage }) => ({
      question,
      options,
      correctIndex,
      explanation,
      sourcePage,
    }));
    if (canonicalJson(mirrored) !== canonicalJson(projected)) {
      refuse("The current practice test questions disagree with the active version.");
    }
  }
}

/* Schema 18: PDF-kit provenance (native twin: verify_schema_18_pdf_kit_semantics). */
export const PDF_KIT_TABLES = ["pdf_kit_runs", "pdf_kit_item_sources"] as const;

export async function validatePdfKitState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  for (const table of PDF_KIT_TABLES) {
    if ((await count(query, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])) !== 1) {
      refuse(`The database is missing required table: ${table}`);
    }
    if (!same(await navigationColumns(query, table), await navigationColumns(reference, table))) {
      refuse(`Table ${table} columns do not match the registered migration contract.`);
    }
    if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {
      refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    }
    if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {
      refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    }
    if (!same(await navigationKeyIndexes(query, table), await navigationKeyIndexes(reference, table))) {
      refuse(`Table ${table} keys do not match the registered migration contract.`);
    }
    if ((await query(`SELECT * FROM pragma_foreign_key_check('${table}')`, [])).length !== 0) {
      refuse(`Table ${table} has rows that point at nothing.`);
    }
  }
  if (
    (await navigationIndexShape(query, "pdf_kit_runs", "idx_pdf_kit_runs_material")) !==
    (await navigationIndexShape(reference, "pdf_kit_runs", "idx_pdf_kit_runs_material"))
  ) {
    refuse("The database is missing required index: idx_pdf_kit_runs_material");
  }

  if ((await count(query, `SELECT COUNT(*) FROM pdf_kit_runs
      WHERE typeof(extractor_version) != 'integer' OR typeof(algorithm_version) != 'integer'`)) !== 0) {
    refuse("A PDF kit has invalid versions.");
  }
  for (const row of await query("SELECT run_id, content_sha256, selected_pages_json, created_at FROM pdf_kit_runs", [])) {
    if (!AUTHORING_UUID_V4.test(text(row, "run_id"))) refuse("A PDF kit has an invalid run identity.");
    if (!/^[0-9a-f]{64}$/.test(text(row, "content_sha256"))) refuse("A PDF kit has an invalid source hash.");
    text(row, "created_at");
    const encoded = text(row, "selected_pages_json");
    let pages: unknown;
    try { pages = JSON.parse(encoded); } catch { refuse("A PDF kit has invalid selected pages."); }
    if (!Array.isArray(pages) || JSON.stringify(pages) !== encoded ||
        !pages.every((page: unknown, index: number) => typeof page === "number" && Number.isInteger(page) &&
          page >= 1 && page <= 1000 && (index === 0 || page > pages[index - 1]))) {
      refuse("A PDF kit has invalid selected pages.");
    }
  }
  if ((await count(query, `SELECT COUNT(*) FROM pdf_kit_item_sources s
      LEFT JOIN pdf_kit_runs r ON r.run_id = s.run_id
      LEFT JOIN study_materials m ON m.id = r.material_id
      WHERE r.run_id IS NULL OR m.id IS NULL`)) !== 0) refuse("A PDF kit source has no material.");
  if ((await count(query, `SELECT COUNT(*) FROM pdf_kit_item_sources
      WHERE typeof(page) != 'integer' OR typeof(start_offset) != 'integer' OR typeof(end_offset) != 'integer'
         OR page < 1 OR page > 1000 OR start_offset < 0 OR end_offset <= start_offset`)) !== 0) {
    refuse("A PDF kit source has invalid page offsets.");
  }
  for (const row of await query("SELECT item_kind, logical_id, content_hash, quote FROM pdf_kit_item_sources", [])) {
    if (!/^[0-9a-f]{64}$/.test(text(row, "content_hash"))) refuse("A PDF kit item has an invalid content hash.");
    if (!["summary", "section", "card", "question"].includes(text(row, "item_kind"))) refuse("A PDF kit item has an invalid kind.");
    text(row, "logical_id");
    const length = codePointLength(text(row, "quote"));
    if (length < 1 || length > 2000) refuse("A PDF kit source has an invalid quote.");
  }
}

/** Schema 19: only PDF-bound study operations need this new receipt table. */
export async function validateStudySetReceiptState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  const table = "study_set_save_operations";
  if (!same(await navigationColumns(query, table), await navigationColumns(reference, table)) ||
      !same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table)) ||
      !same(await navigationKeyIndexes(query, table), await navigationKeyIndexes(reference, table)) ||
      !same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table))) ||
      (await query(`SELECT * FROM pragma_foreign_key_check('${table}')`, [])).length) refuse("Study set save receipts do not match the migration contract.");
  const { decodeStudySetOperation } = await import("./studySetTransaction");
  const { validatePdfKitContent } = await import("./pdfKitSources");
  for (const row of await query(`SELECT * FROM ${table}`, [])) {
    try {
      const operation = decodeStudySetOperation(JSON.parse(text(row, "payload_json")));
      if (!operation.pdfKitSources || operation.materialId !== row.material_id || operation.operationId !== row.operation_id || canonicalJson(operation) !== row.payload_json || await sha256Hex(canonicalJson(operation)) !== row.payload_hash) throw new Error();
      await validatePdfKitContent(operation.pdfKitSources, operation.next as unknown as Record<string, unknown>);
    } catch { refuse("A study set save receipt is damaged."); }
  }
}

/** Schema 20. Structural comparison includes partial indexes and append-only triggers. */
export async function validateHomeworkState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  const { HOMEWORK_TABLES, parseHomeworkJson, decodeHomeworkOperation, validateHomeworkTransition, homeworkLiveMatches } = await import("@/domain/homework");
  for (const table of HOMEWORK_TABLES) {
    if (!same(await navigationColumns(query, table), await navigationColumns(reference, table)) ||
        !same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table)) ||
        !same(await navigationKeyIndexes(query, table), await navigationKeyIndexes(reference, table)) ||
        !same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table))) ||
        (await query(`SELECT * FROM pragma_foreign_key_check('${table}')`, [])).length) refuse("Homework tables do not match the migration contract.");
  }
  const objects = await reference("SELECT type,name,sql FROM sqlite_master WHERE tbl_name LIKE 'homework_%' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name", []);
  for (const object of objects) {
    const [actual] = await query("SELECT sql FROM sqlite_master WHERE type=? AND name=?", [text(object, "type"), text(object, "name")]);
    if (!actual || normalizeSql(text(actual, "sql")) !== normalizeSql(text(object, "sql"))) refuse("Homework indexes or history guards are missing.");
  }
  // Reserved HW-01d entities have no permitted producer in codec 1.
  homeworkAssert((await query("SELECT * FROM homework_runs", [])).length === 0);
  const assignments = await query("SELECT * FROM homework_assignments ORDER BY id", []);
  let historyCount = 0;
  const seenActivities = new Set<string>();
  for (const assignment of assignments) {
    const id = text(assignment, "id");
    const history = await query("SELECT * FROM homework_history WHERE assignment_id=? ORDER BY revision", [id]);
    let previous: import("@/domain/homework").HomeworkSnapshot | null = null;
    for (const row of history) {
      historyCount++;
      const [receipt] = await query("SELECT * FROM homework_operations WHERE operation_id=?", [text(row, "operation_id")]);
      homeworkAssert(receipt);
      const raw = text(receipt, "request_json");
      const operation = decodeHomeworkOperation(parseHomeworkJson(raw));
      homeworkAssert(operation.operationId === row.operation_id && operation.assignmentId === id && receipt.assignment_id === id);
      homeworkAssert(operation.baseRevision === (previous?.assignment.revision ?? 0) && row.revision === operation.baseRevision + 1);
      homeworkAssert(operation.changeKind === row.change_kind && row.recorded_at === operation.at && receipt.applied_at === operation.at);
      homeworkAssert(await sha256Hex(raw) === receipt.request_hash);
      homeworkAssert(canonicalJson(parseHomeworkJson(text(row, "snapshot_json"))) === canonicalJson(operation.next));
      homeworkAssert(text(receipt, "result_json") === canonicalJson({ version: 1, assignmentId: id, revision: row.revision }));
      previous = validateHomeworkTransition(previous, operation);
      await validateHomeworkSources(query, previous, false);
      for (const e of previous.activities) {
        homeworkAssert(!seenActivities.has(e.record.id));
      }
    }
    homeworkAssert(previous && previous.assignment.revision === assignment.revision);
    const activities = await query("SELECT * FROM homework_activities WHERE assignment_id=? ORDER BY id", [id]);
    homeworkAssert(homeworkLiveMatches(previous, assignment, activities));
    for (const e of previous.activities) seenActivities.add(e.record.id);
  }
  homeworkAssert((await count(query, "SELECT COUNT(*) FROM homework_operations")) === historyCount);
  homeworkAssert((await count(query, "SELECT COUNT(*) FROM homework_activities")) === seenActivities.size);
}

/** Live immutable identities are cross-checked; missing/drifted historical sources survive. */
export async function validateHomeworkSources(query: ValidationQuery, snapshot: import("@/domain/homework").HomeworkSnapshot, writing: boolean): Promise<void> {
  const { HomeworkError } = await import("@/domain/homework");
  const a = snapshot.assignment;
  if (writing && a.lesson_id) homeworkAssert((await query("SELECT id FROM schedule_events WHERE id=?", [a.lesson_id])).length === 1);
  for (const e of snapshot.activities) {
    const r = e.record;
    if (r.card_set_id) homeworkAssert(r.card_set_id === await sha256Hex(`${r.source_material_id}\0${r.source_revision}`));
    if (r.source_test_version_id) {
      const [v] = await query("SELECT source_material_id,history_key,content_hash FROM practice_test_versions WHERE id=?", [r.source_test_version_id]);
      if (v) homeworkAssert((v.source_material_id === r.source_material_id || v.source_material_id === null) && v.history_key === r.source_material_id && v.content_hash === r.source_revision);
      else if (writing && r.test_version_id) throw new HomeworkError("SOURCE");
    }
    if (writing && r.kind === "read" && r.state === "completed" && r.material_id === null) throw new HomeworkError("SOURCE");
    if (!writing || r.material_id === null) continue;
    if (!(await query("SELECT id FROM study_materials WHERE id=?", [r.material_id])).length) throw new HomeworkError("SOURCE");
    if (r.kind === "read" && r.source_revision) {
      const [identity] = await query("SELECT content_sha256,total_pages FROM material_content_identities WHERE material_id=?", [r.material_id]);
      if (!identity || identity.content_sha256 !== r.source_revision || identity.total_pages !== e.source?.total_pages || (r.page_end ?? 0) > Number(identity.total_pages)) throw new HomeworkError("SOURCE");
    }
    if (r.kind === "cards" && r.source_revision) {
      const { deriveCurrentCards } = await import("@/logic/cardIdentity");
      const [set] = await query("SELECT flashcards_json FROM ai_study_sets WHERE material_id=?", [r.material_id]);
      const cards = await deriveCurrentCards(r.material_id, typeof set?.flashcards_json === "string" ? set.flashcards_json : null);
      if (cards.status !== "ok" || cards.contentHash !== r.source_revision || cards.versionId !== r.card_set_id) throw new HomeworkError("SOURCE");
    }
  }
}
