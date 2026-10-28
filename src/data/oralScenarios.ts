/**
 * ORAL-01c: her saved oral-question scenarios.
 *
 * One bounded codec (the native twin is `src-tauri/src/oral_scenarios.rs`),
 * one owned transaction for the browser and test drivers, and a reader.
 * Every edit adds a frozen version; a save is idempotent through
 * `oral_save_operations`, which keeps only a hash of the request, never her
 * text. Her answers and ticks are never stored here.
 */
import { canonicalJson, sha256Hex } from "@/logic/cardIdentity";
import type { SqlValue } from "./db";

export const ORAL_POINTS_MAX = 12;
export const ORAL_POINT_MAX_CHARS = 500;
export const ORAL_PROMPT_MAX_CHARS = 4000;
export const ORAL_ASSUMPTIONS_MAX_CHARS = 2000;
export const ORAL_SOURCE_PAGE_MAX = 100000;
/** Saved scenarios one material can hold. */
export const ORAL_SCENARIOS_MAX = 200;

export type OralOrigin = "user" | "instructor";
export type StoredOralOrigin = OralOrigin | "study_aid";

export interface OralScenarioContent {
  prompt: string;
  assumptions: string;
  points: string[];
  sourcePage: number | null;
  origin: OralOrigin;
}

export type OralOperation =
  | { action: "create"; operationId: string; materialId: string; at: string; scenarioId: string; versionId: string; content: OralScenarioContent }
  | { action: "edit"; operationId: string; materialId: string; at: string; scenarioId: string; versionId: string; baseVersion: number; content: OralScenarioContent }
  | { action: "reorder"; operationId: string; materialId: string; at: string; order: string[] }
  | { action: "remove"; operationId: string; materialId: string; at: string; scenarioId: string };

export interface OralResult {
  version: 1;
  action: OralOperation["action"];
  scenarioId: string | null;
  versionId: string | null;
  versionNumber: number | null;
}

export interface OralScenario extends Omit<OralScenarioContent, "origin"> {
  id: string;
  position: number;
  versionId: string;
  versionNumber: number;
  origin: StoredOralOrigin;
}

export const ORAL_MESSAGES = {
  INVALID: "Part of this scenario isn't valid. Nothing was saved.",
  CONFLICT: "This save clashed with an earlier one. Nothing was changed.",
  STALE: "Your scenarios changed in the meantime. Close this and try again.",
  MISSING: "That scenario or material is no longer here. Nothing was changed.",
  STORAGE: "The scenario could not be saved. Nothing was changed.",
} as const;
export type OralErrorCode = keyof typeof ORAL_MESSAGES;

export class OralScenarioError extends Error {
  constructor(public readonly code: OralErrorCode) {
    super(ORAL_MESSAGES[code]);
    this.name = "OralScenarioError";
  }
}

const fail = (code: OralErrorCode = "INVALID"): never => {
  throw new OralScenarioError(code);
};
const ensure = (ok: unknown, code: OralErrorCode = "INVALID"): void => {
  if (!ok) fail(code);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isOralId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Well-formed UTF-16 (no lone surrogates), so both engines read the same text. */
function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
const codePoints = (text: string) => Array.from(text).length;
/** Text of 1..max code points (`min` 1 also needs something besides whitespace). */
function boundedText(value: unknown, min: 0 | 1, max: number): value is string {
  return typeof value === "string" && wellFormed(value) && codePoints(value) <= max && (min === 0 || value.trim().length > 0);
}
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(value, k));
}

/** The one points codec: 1–12 strings, each 1–500 characters, nothing else. */
export function validOralPoints(points: unknown): points is string[] {
  return (
    Array.isArray(points) &&
    points.length >= 1 &&
    points.length <= ORAL_POINTS_MAX &&
    points.every((p) => boundedText(p, 1, ORAL_POINT_MAX_CHARS))
  );
}
export function encodeOralPoints(points: string[]): string {
  ensure(validOralPoints(points));
  return JSON.stringify(points);
}
/** Decodes only the exact encoding `encodeOralPoints` writes. */
export function decodeOralPoints(raw: unknown): string[] {
  ensure(typeof raw === "string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    return fail();
  }
  ensure(validOralPoints(parsed) && JSON.stringify(parsed) === raw);
  return parsed as string[];
}

function validSourcePage(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= ORAL_SOURCE_PAGE_MAX);
}

/** Content she can write (origin `user` or `instructor`); stored rows may also be `study_aid`. */
export function validOralContent(value: unknown, stored = false): value is OralScenarioContent {
  if (!exactKeys(value, ["prompt", "assumptions", "points", "sourcePage", "origin"])) return false;
  const origins = stored ? ["user", "instructor", "study_aid"] : ["user", "instructor"];
  return (
    boundedText(value.prompt, 1, ORAL_PROMPT_MAX_CHARS) &&
    boundedText(value.assumptions, 0, ORAL_ASSUMPTIONS_MAX_CHARS) &&
    validOralPoints(value.points) &&
    validSourcePage(value.sourcePage) &&
    typeof value.origin === "string" &&
    origins.includes(value.origin)
  );
}

/** SHA-256 of the canonical descriptor of one frozen version. */
export function oralContentHash(scenarioId: string, versionNumber: number, content: Omit<OralScenarioContent, "origin"> & { origin: string }): Promise<string> {
  return sha256Hex(
    canonicalJson({
      scenarioId,
      versionNumber,
      prompt: content.prompt,
      assumptions: content.assumptions,
      points: content.points,
      sourcePage: content.sourcePage,
      origin: content.origin,
    }),
  );
}

const MATERIAL_ID_MAX = 200;
const AT_MAX = 64;

export function decodeOralOperation(value: unknown): OralOperation {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value));
  const v = value as Record<string, unknown>;
  const common = ["action", "operationId", "materialId", "at"];
  const keys: Record<string, string[]> = {
    create: [...common, "scenarioId", "versionId", "content"],
    edit: [...common, "scenarioId", "versionId", "baseVersion", "content"],
    reorder: [...common, "order"],
    remove: [...common, "scenarioId"],
  };
  ensure(typeof v.action === "string" && Object.prototype.hasOwnProperty.call(keys, v.action));
  ensure(exactKeys(v, keys[v.action as string]!));
  ensure(isOralId(v.operationId));
  ensure(typeof v.materialId === "string" && v.materialId.length >= 1 && v.materialId.length <= MATERIAL_ID_MAX && wellFormed(v.materialId));
  ensure(typeof v.at === "string" && v.at.length >= 1 && v.at.length <= AT_MAX && wellFormed(v.at));
  if (v.action === "create" || v.action === "edit" || v.action === "remove") ensure(isOralId(v.scenarioId));
  if (v.action === "create" || v.action === "edit") {
    ensure(isOralId(v.versionId) && validOralContent(v.content));
  }
  if (v.action === "edit") ensure(Number.isSafeInteger(v.baseVersion) && (v.baseVersion as number) >= 1);
  if (v.action === "reorder") {
    const order = v.order;
    ensure(Array.isArray(order) && order.length >= 1 && order.length <= ORAL_SCENARIOS_MAX && order.every(isOralId));
    ensure(new Set(order as string[]).size === (order as string[]).length);
  }
  return v as unknown as OralOperation;
}

/** The stored result: ids and numbers only. */
export function decodeOralResult(raw: unknown, action: string): OralResult {
  ensure(typeof raw === "string");
  let r: unknown;
  try {
    r = JSON.parse(raw as string);
  } catch {
    return fail();
  }
  ensure(exactKeys(r, ["version", "action", "scenarioId", "versionId", "versionNumber"]) && canonicalJson(r) === raw);
  const result = r as unknown as OralResult;
  ensure(result.version === 1 && result.action === action);
  if (action === "create" || action === "edit") {
    ensure(isOralId(result.scenarioId) && isOralId(result.versionId) && Number.isSafeInteger(result.versionNumber) && (result.versionNumber as number) >= 1);
  } else if (action === "remove") {
    ensure(isOralId(result.scenarioId) && result.versionId === null && result.versionNumber === null);
  } else {
    ensure(action === "reorder" && result.scenarioId === null && result.versionId === null && result.versionNumber === null);
  }
  return result;
}

type Run = (sql: string, params: SqlValue[]) => void | Promise<void>;
type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

/** The owner (ConnectionOwner / sql.js) supplies exclusion and durability. */
export async function executeOralOperation(exec: (sql: string) => void, run: Run, query: Query, value: unknown): Promise<OralResult> {
  decodeOralOperation(value);
  exec("BEGIN IMMEDIATE");
  try {
    const result = await applyOralOperation(run, query, value);
    exec("COMMIT");
    return result;
  } catch (error) {
    try {
      exec("ROLLBACK");
    } catch {
      /* keep the first failure */
    }
    if (error instanceof OralScenarioError) throw error;
    throw new OralScenarioError("STORAGE");
  }
}

async function applyOralOperation(run: Run, query: Query, value: unknown): Promise<OralResult> {
  const op = decodeOralOperation(value);
  const hash = await sha256Hex(canonicalJson(op));
  const [receipt] = await query("SELECT * FROM oral_save_operations WHERE operation_id=?", [op.operationId]);
  if (receipt) {
    ensure(receipt.payload_hash === hash && receipt.material_id === op.materialId && receipt.action === op.action, "CONFLICT");
    return decodeOralResult(receipt.result_json, op.action);
  }
  ensure((await query("SELECT id FROM study_materials WHERE id=?", [op.materialId])).length === 1, "MISSING");
  const active = (await query("SELECT id, position FROM oral_scenarios WHERE material_id=? AND removed_at IS NULL ORDER BY position", [op.materialId])).map((r) => ({
    id: String(r.id),
    position: Number(r.position),
  }));
  let result: OralResult;
  if (op.action === "create") {
    ensure(active.length < ORAL_SCENARIOS_MAX);
    ensure((await query("SELECT id FROM oral_scenarios WHERE id=?", [op.scenarioId])).length === 0, "CONFLICT");
    ensure((await query("SELECT id FROM oral_scenario_versions WHERE id=?", [op.versionId])).length === 0, "CONFLICT");
    const position = active.length ? active[active.length - 1]!.position + 1 : 0;
    await run("INSERT INTO oral_scenarios (id, material_id, position, removed_at, created_at, updated_at) VALUES (?,?,?,NULL,?,?)", [op.scenarioId, op.materialId, position, op.at, op.at]);
    await insertVersion(run, op.scenarioId, op.versionId, 1, op.content, op.at);
    result = { version: 1, action: "create", scenarioId: op.scenarioId, versionId: op.versionId, versionNumber: 1 };
  } else if (op.action === "edit") {
    ensure(active.some((s) => s.id === op.scenarioId), "MISSING");
    const [latest] = await query("SELECT MAX(version_number) AS n FROM oral_scenario_versions WHERE scenario_id=?", [op.scenarioId]);
    ensure(Number(latest?.n) === op.baseVersion, "STALE");
    ensure((await query("SELECT id FROM oral_scenario_versions WHERE id=?", [op.versionId])).length === 0, "CONFLICT");
    const versionNumber = op.baseVersion + 1;
    await insertVersion(run, op.scenarioId, op.versionId, versionNumber, op.content, op.at);
    await run("UPDATE oral_scenarios SET updated_at=? WHERE id=?", [op.at, op.scenarioId]);
    result = { version: 1, action: "edit", scenarioId: op.scenarioId, versionId: op.versionId, versionNumber };
  } else if (op.action === "reorder") {
    const current = new Set(active.map((s) => s.id));
    ensure(op.order.length === current.size && op.order.every((id) => current.has(id)), "STALE");
    // A high transaction-local offset avoids transient UNIQUE conflicts.
    const offset = (active.length ? active[active.length - 1]!.position : 0) + op.order.length + 1;
    await run("UPDATE oral_scenarios SET position=position+? WHERE material_id=? AND removed_at IS NULL", [offset, op.materialId]);
    for (const [index, id] of op.order.entries()) {
      await run("UPDATE oral_scenarios SET position=?, updated_at=? WHERE id=?", [index, op.at, id]);
    }
    result = { version: 1, action: "reorder", scenarioId: null, versionId: null, versionNumber: null };
  } else {
    ensure(active.some((s) => s.id === op.scenarioId), "MISSING");
    await run("UPDATE oral_scenarios SET removed_at=?, updated_at=? WHERE id=?", [op.at, op.at, op.scenarioId]);
    result = { version: 1, action: "remove", scenarioId: op.scenarioId, versionId: null, versionNumber: null };
  }
  await run("INSERT INTO oral_save_operations (operation_id, material_id, action, payload_hash, result_json, applied_at) VALUES (?,?,?,?,?,?)", [
    op.operationId,
    op.materialId,
    op.action,
    hash,
    canonicalJson(result),
    op.at,
  ]);
  return result;
}

async function insertVersion(run: Run, scenarioId: string, versionId: string, versionNumber: number, content: OralScenarioContent, at: string) {
  await run(
    "INSERT INTO oral_scenario_versions (id, scenario_id, version_number, prompt, assumptions, points_json, source_page, origin, content_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      versionId,
      scenarioId,
      versionNumber,
      content.prompt,
      content.assumptions,
      encodeOralPoints(content.points),
      content.sourcePage,
      content.origin,
      await oralContentHash(scenarioId, versionNumber, content),
      at,
    ],
  );
}

/** Her current scenarios for one material, in her order, each at its latest version. */
export async function readOralScenarios(query: Query, materialId: string): Promise<OralScenario[]> {
  const rows = await query(
    `SELECT s.id, s.position, v.id AS version_id, v.version_number, v.prompt, v.assumptions, v.points_json, v.source_page, v.origin
       FROM oral_scenarios s
       JOIN oral_scenario_versions v ON v.scenario_id = s.id
        AND v.version_number = (SELECT MAX(version_number) FROM oral_scenario_versions WHERE scenario_id = s.id)
      WHERE s.material_id = ? AND s.removed_at IS NULL
      ORDER BY s.position`,
    [materialId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    position: Number(r.position),
    versionId: String(r.version_id),
    versionNumber: Number(r.version_number),
    prompt: String(r.prompt),
    assumptions: String(r.assumptions),
    points: decodeOralPoints(r.points_json),
    sourcePage: r.source_page == null ? null : Number(r.source_page),
    origin: String(r.origin) as StoredOralOrigin,
  }));
}
