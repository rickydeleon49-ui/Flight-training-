/**
 * Candidate schema-14 semantic validation (TS twin of the native
 * `verify_schema_14_skill_evidence_semantics` in native/src/lib.rs). Runs on
 * open and on restore, after the accepted schema 11/12/13 validators, against
 * a reference database built from the registered migrations plus 0014.
 *
 * Shared contract: fixtures/validation-cases.json, run by node:sqlite,
 * sql.js and rusqlite with identical expected outcomes.
 *
 * DISPOSABLE PROTOTYPE.
 */
import {
  PracticeStateValidationError,
  checkConstraints,
  normalizeSql,
  validateCardReviewState,
  validatePracticeState,
  validateSplitLineageState,
  type ValidationQuery,
} from "@/data/practiceStateValidation";

export const CANDIDATE_VERSION = 14;

export const M3_TABLES = [
  "skill_catalog_entries",
  "skill_catalog_revisions",
  "skill_observations",
  "skill_observation_revisions",
  "skill_self_assessments",
  "skill_evidence_operations",
] as const;

export const M3_INDEXES = [
  ["skill_observations", "idx_skill_observations_page"],
  ["skill_observations", "idx_skill_observations_skill_page"],
  ["skill_observations", "idx_skill_observations_journal"],
  ["skill_observations", "idx_skill_observations_source_journal"],
  ["skill_observations", "idx_skill_observations_action"],
  ["skill_evidence_operations", "idx_skill_evidence_operations_subject"],
] as const;

export const M3_TRIGGERS = [
  "trg_skill_catalog_revisions_no_update",
  "trg_skill_catalog_revisions_no_delete",
  "trg_skill_observation_revisions_no_update",
  "trg_skill_observation_revisions_no_partial_delete",
  "trg_skill_self_assessments_no_update",
  "trg_skill_self_assessments_no_delete",
] as const;

const MAX_CUSTOM_SKILLS = 200;

function refuse(message: string): never {
  throw new PracticeStateValidationError(message);
}

const str = (v: unknown) => (v == null ? null : String(v));
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

async function rows(q: ValidationQuery, sql: string, params: (string | number | null)[] = []) {
  return await q(sql, params);
}

async function count(q: ValidationQuery, sql: string, params: (string | number | null)[] = []): Promise<number> {
  const [row] = await rows(q, sql, params);
  return row ? Number(Object.values(row)[0]) : 0;
}

async function foreignKeys(q: ValidationQuery, table: string): Promise<string[]> {
  const list = await rows(
    q,
    `SELECT id, "table" AS parent, "from" AS child, "to" AS target, on_update, on_delete, "match" AS matching
       FROM pragma_foreign_key_list('${table}') ORDER BY id, seq`,
  );
  const grouped = new Map<number, string[]>();
  for (const r of list) {
    const id = Number(r["id"]);
    const head = [String(r["parent"]).toLowerCase(), String(r["on_update"]).toUpperCase(), String(r["on_delete"]).toUpperCase(), String(r["matching"]).toUpperCase()].join("|");
    const entry = grouped.get(id) ?? [head];
    entry.push(`${String(r["child"]).toLowerCase()}>${str(r["target"])?.toLowerCase() ?? ""}`);
    grouped.set(id, entry);
  }
  return [...grouped.values()].map((e) => e.join("|")).sort();
}

async function columns(q: ValidationQuery, table: string): Promise<string[]> {
  return (await rows(q, `SELECT name, type, "notnull" AS required, pk, dflt_value FROM pragma_table_info('${table}') ORDER BY name`)).map(
    (r) => `${String(r["name"])}|${String(r["type"]).toLowerCase()}|${Number(r["required"])}|${Number(r["pk"])}|${str(r["dflt_value"]) ?? ""}`,
  );
}

async function masterSql(q: ValidationQuery, type: "table" | "trigger", name: string): Promise<string | null> {
  const [r] = await rows(q, "SELECT sql FROM sqlite_master WHERE type = ? AND name = ?", [type, name]);
  return r ? String(r["sql"]) : null;
}

/** Primary-key and UNIQUE constraint indexes, by columns (names are generated). */
async function keyIndexes(q: ValidationQuery, table: string): Promise<string[]> {
  const out: string[] = [];
  for (const r of await rows(q, `SELECT name, origin FROM pragma_index_list('${table}') WHERE origin IN ('pk', 'u')`)) {
    const cols = (await rows(q, `SELECT name FROM pragma_index_info('${String(r["name"])}') ORDER BY seqno`)).map((c) => String(c["name"]));
    out.push(`${String(r["origin"])}|${cols.join(",")}`);
  }
  return out.sort();
}

async function indexShape(q: ValidationQuery, table: string, index: string): Promise<string | null> {
  const [listed] = await rows(q, `SELECT "unique" AS uniq FROM pragma_index_list('${table}') WHERE name = ?`, [index]);
  if (!listed) return null;
  const cols = (await rows(q, `SELECT name FROM pragma_index_info('${index}') ORDER BY seqno`)).map((r) => String(r["name"]));
  return `${Number(listed["uniq"])}|${cols.join(",")}`;
}

/** The schema-14 contract: exact shape, triggers, catalog and history invariants. */
export async function validateSkillEvidenceState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  // 1. Exact table shape.
  for (const table of M3_TABLES) {
    const sql = await masterSql(query, "table", table);
    if (sql === null) refuse(`The database is missing required table: ${table}`);
    const refSql = (await masterSql(reference, "table", table))!;
    if (!same(await columns(query, table), await columns(reference, table))) refuse(`Table ${table} columns do not match the registered migration contract.`);
    if (!same(await foreignKeys(query, table), await foreignKeys(reference, table))) refuse(`Table ${table} foreign keys do not match the registered migration contract.`);
    if (!same(checkConstraints(sql), checkConstraints(refSql))) refuse(`Table ${table} CHECK constraints do not match the registered migration contract.`);
    if (!same(await keyIndexes(query, table), await keyIndexes(reference, table))) refuse(`Table ${table} keys do not match the registered migration contract.`);
  }
  for (const [table, index] of M3_INDEXES) {
    const actual = await indexShape(query, table, index);
    if (actual === null) refuse(`The database is missing required index: ${index}`);
    if (actual !== (await indexShape(reference, table, index))) refuse(`Index ${index} does not match the registered migration contract.`);
  }
  for (const trigger of M3_TRIGGERS) {
    const sql = await masterSql(query, "trigger", trigger);
    if (sql === null) refuse(`The database is missing required trigger: ${trigger}`);
    if (normalizeSql(sql) !== normalizeSql((await masterSql(reference, "trigger", trigger))!)) refuse(`Trigger ${trigger} does not match the registered migration contract.`);
  }

  // 2. Relationships hold (foreign keys are not re-checked by SQLite on restore).
  for (const table of M3_TABLES) {
    if ((await rows(query, `SELECT 1 FROM pragma_foreign_key_check('${table}') LIMIT 1`)).length > 0) {
      refuse(`Table ${table} has a record pointing at something that does not exist.`);
    }
  }

  // 3. The built-in catalog is exactly the shipped one: no unknown, no missing ids,
  //    and revision 1 of each is the shipped text.
  const shipped = new Map<string, Record<string, unknown>>();
  for (const r of await rows(reference, "SELECT * FROM skill_catalog_revisions WHERE revision = 1 AND changed_by = 'catalog'")) shipped.set(String(r["skill_id"]), r);
  const builtins = await rows(query, "SELECT id FROM skill_catalog_entries WHERE origin = 'builtin'");
  if (builtins.length !== shipped.size || builtins.some((r) => !shipped.has(String(r["id"])))) refuse("The built-in skill catalog does not match this version of the app.");
  for (const [id, ref] of shipped) {
    const [first] = await rows(query, "SELECT * FROM skill_catalog_revisions WHERE skill_id = ? AND revision = 1", [id]);
    if (!first || ["label", "description", "topic", "status", "catalog_version", "changed_by", "changed_at"].some((k) => str(first[k]) !== str(ref[k]))) {
      refuse(`Built-in skill ${id} does not match the shipped catalog.`);
    }
  }
  if ((await count(query, "SELECT COUNT(*) AS n FROM skill_catalog_entries WHERE origin = 'custom'")) > MAX_CUSTOM_SKILLS) refuse("There are more custom skills than this app supports.");

  // 4. Skill history is contiguous and its latest entry is the current skill.
  for (const skill of await rows(query, "SELECT * FROM skill_catalog_entries")) {
    const history = await rows(query, "SELECT * FROM skill_catalog_revisions WHERE skill_id = ? ORDER BY revision", [String(skill["id"])]);
    if (history.length !== Number(skill["revision"]) || history.some((h, i) => Number(h["revision"]) !== i + 1)) refuse(`Skill ${String(skill["id"])} has gaps in its history.`);
    const latest = history.at(-1)!;
    if (["label", "description", "topic", "status"].some((k) => str(latest[k]) !== str(skill[k]))) refuse(`Skill ${String(skill["id"])} does not match its latest history entry.`);
  }

  // 5. Observation history is contiguous and its latest entry is the current observation.
  for (const obs of await rows(query, "SELECT * FROM skill_observations")) {
    const id = String(obs["id"]);
    const history = await rows(query, "SELECT * FROM skill_observation_revisions WHERE observation_id = ? ORDER BY revision", [id]);
    if (history.length !== Number(obs["revision"]) || history.some((h, i) => Number(h["revision"]) !== i + 1)) refuse(`Observation ${id} has gaps in its history.`);
    const latest = history.at(-1)!;
    const pairs: [string, string][] = [
      ["wording", "wording"], ["observed_on", "observed_on"], ["attribution", "attribution"], ["instructor_name", "instructor_name"],
      ["linked_action_id", "linked_action_id"], ["linked_action_title", "linked_action_title"], ["addressed_at", "addressed_at"],
    ];
    if (pairs.some(([a, b]) => str(obs[a]) !== str(latest[b]))) refuse(`Observation ${id} does not match its latest history entry.`);
    if (obs["journal_id"] != null && obs["journal_id"] !== obs["source_journal_id"]) refuse(`Observation ${id} points at a different debrief than it was recorded from.`);
  }

  // 6. Self-assessment sequences are contiguous per skill and kind.
  for (const group of await rows(query, "SELECT skill_id, kind, COUNT(*) AS n, MIN(sequence) AS lo, MAX(sequence) AS hi FROM skill_self_assessments GROUP BY skill_id, kind")) {
    if (Number(group["lo"]) !== 1 || Number(group["hi"]) !== Number(group["n"])) refuse(`Skill ${String(group["skill_id"])} has gaps in its ${String(group["kind"])} history.`);
  }

  // 7. Receipts: live receipts carry a result for their own action; erased
  //    subjects are really gone.
  for (const op of await rows(query, "SELECT * FROM skill_evidence_operations")) {
    const id = String(op["operation_id"]);
    if (Number(op["is_erased"]) === 0) {
      let result: unknown;
      try {
        result = JSON.parse(String(op["result_json"]));
      } catch {
        refuse(`Operation ${id} has an unreadable result.`);
      }
      if (result === null || typeof result !== "object" || (result as Record<string, unknown>)["action"] !== op["action"]) refuse(`Operation ${id} has a result for a different action.`);
    } else if ((await count(query, "SELECT COUNT(*) AS n FROM skill_observations WHERE id = ?", [String(op["subject_id"])])) > 0) {
      refuse(`Operation ${id} says its observation was erased, but it is still here.`);
    }
  }
}

/**
 * Candidate whole-database check: the accepted checks for 11-13, then 14.
 * The ceiling is the candidate version, so this models the NEW binary.
 */
export async function validateCandidateDatabase(query: ValidationQuery, reference: ValidationQuery): Promise<void> {
  const [quick] = await rows(query, "PRAGMA quick_check");
  if (!quick || Object.values(quick)[0] !== "ok") refuse("The database is damaged or incomplete.");
  const newest = await count(query, "SELECT COALESCE(MAX(version), 0) AS n FROM schema_migrations");
  if (newest > CANDIDATE_VERSION) refuse("The database was created by a newer format.");
  if (newest >= 11) await validatePracticeState(query, reference);
  if (newest >= 12) await validateCardReviewState(query, reference);
  if (newest >= 13) await validateSplitLineageState(query, reference);
  if (newest >= 14) await validateSkillEvidenceState(query, reference);
}
