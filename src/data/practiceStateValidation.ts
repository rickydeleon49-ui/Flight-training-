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
import { canonicalJson, isValidCardText, MAX_BACK_CHARS, MAX_FRONT_CHARS, MAX_SOURCE_PAGE, sha256Hex } from "@/logic/cardIdentity";
import { isIsoInstant, SCHEDULER_VERSION, stepDelayMs } from "@/logic/cardScheduler";

import type { SqlValue } from "./db";
import { MIGRATIONS } from "./migrations";
import { codePointLength } from "./practiceSessionTransaction";

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

  // 5. Identity: every snapshot is recomputable from its stored text.
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
    const items = await query(
      "SELECT id, ordinal, front, back, source_page FROM card_items WHERE version_id = ? ORDER BY ordinal ASC",
      [versionId],
    );
    if (items.length !== int(version, "card_count")) refuse(`${owner} card_count does not match its cards.`);
    const cards: { front: string; back: string; sourcePage: number | null }[] = [];
    for (const [expected, item] of items.entries()) {
      const itemId = text(item, "id");
      if (int(item, "ordinal") !== expected) refuse(`Card ${itemId} has a non-contiguous ordinal.`);
      if ((await sha256Hex(`${versionId}\u0000${expected}`)) !== itemId) refuse(`Card ${itemId} cannot be recomputed.`);
      const front = text(item, "front");
      const back = text(item, "back");
      const sourcePage = optInt(item, "source_page");
      if (!isValidCardText(front, MAX_FRONT_CHARS) || !isValidCardText(back, MAX_BACK_CHARS)) refuse(`Card ${itemId} has invalid text.`);
      if (sourcePage !== null && (sourcePage < 1 || sourcePage > MAX_SOURCE_PAGE)) refuse(`Card ${itemId} has an out-of-bounds source page.`);
      cards.push({ front, back, sourcePage });
    }
    if ((await sha256Hex(canonicalJson(cards))) !== contentHash) refuse(`${owner} content hash does not match its cards.`);
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
