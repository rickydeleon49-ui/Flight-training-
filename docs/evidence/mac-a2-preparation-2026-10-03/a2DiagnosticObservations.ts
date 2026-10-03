// Observation helpers for the PREPARED A2 diagnostics (a2ReviewDiagnostics.mac.test.ts) and their
// task-local oracle controls (a2ObservationOracle.check.ts). Added 3 October 2026 for the Codex
// preparation review corrections PREP-R1 to PREP-R3 (docs/MAC_A2_PREPARATION_REVIEW_2026-10-03.md).
//
// These helpers only read through the public `select` of a driver. They need no A2 API, so the
// oracle controls can validate them today on real node:sqlite and sql.js databases built from the
// project's migrations. Passing those controls validates the prepared observations; it is not an
// execution of the missing A2 implementation.
//
// Kept under docs/evidence like the diagnostics: outside Vitest discovery and outside tsc's
// `include: src`. Copy it next to the diagnostics when running them against matching source.
import { isDeepStrictEqual } from "node:util";

/** The read surface shared by every driver (SqlDatabase.select is assignable to it). */
export interface Queryable {
  select<T = Record<string, unknown>>(sql: string, params?: never[]): Promise<T[]>;
}
type Row = Record<string, unknown>;
const q = (db: Queryable, sql: string, params: unknown[] = []) => db.select<Row>(sql, params as never[]);

/* ------------------------------------------------------------------------------------------ */
/* PREP-R2: complete stored state, taken only after pending operations settle                  */
/* ------------------------------------------------------------------------------------------ */

export type UnrelatedState = { status: "absent" } | { status: "present"; rows: Row[] };

export interface FullState {
  /** Every study_materials column, ordered by id. */
  materials: Row[];
  /** Every tags column including the stored id, ordered by id. */
  tags: Row[];
  /** Every raw material_tags row (material_id, tag_id), ordered by both. */
  materialTags: Row[];
  /** Readable name view. LEFT JOIN, so a dangling link shows `tag: null` instead of vanishing. */
  resolvedLinks: Row[];
  /** Raw counts and referential consistency of the link table. */
  integrity: { materialCount: number; tagCount: number; linkCount: number; danglingMaterialRefs: number; danglingTagRefs: number };
  /** The `unrelated` table, or an explicit "absent" when the case never created it. */
  unrelated: UnrelatedState;
}

/**
 * Complete-state snapshot built from several separate public reads. It is NOT one transaction
 * snapshot: use it only for before/after comparisons after every pending operation has settled.
 * For a read that may race a save, use `observeMaterial` (one SQL statement) instead.
 * Any read failure propagates; only the absence of `unrelated` is reported, and only explicitly.
 */
export async function fullState(db: Queryable): Promise<FullState> {
  const materials = await q(db, "SELECT * FROM study_materials ORDER BY id");
  const tags = await q(db, "SELECT * FROM tags ORDER BY id");
  const materialTags = await q(db, "SELECT material_id, tag_id FROM material_tags ORDER BY material_id, tag_id");
  const resolvedLinks = await q(
    db,
    `SELECT mt.material_id AS id, t.name AS tag FROM material_tags mt
       LEFT JOIN tags t ON t.id = mt.tag_id ORDER BY mt.material_id, t.name, mt.tag_id`,
  );
  const [counts] = await q(
    db,
    `SELECT (SELECT count(*) FROM study_materials) AS materialCount,
            (SELECT count(*) FROM tags) AS tagCount,
            (SELECT count(*) FROM material_tags) AS linkCount,
            (SELECT count(*) FROM material_tags mt WHERE NOT EXISTS
               (SELECT 1 FROM study_materials m WHERE m.id = mt.material_id)) AS danglingMaterialRefs,
            (SELECT count(*) FROM material_tags mt WHERE NOT EXISTS
               (SELECT 1 FROM tags t WHERE t.id = mt.tag_id)) AS danglingTagRefs`,
  );
  const present = await q(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unrelated'");
  const unrelated: UnrelatedState = present.length
    ? { status: "present", rows: await q(db, "SELECT * FROM unrelated ORDER BY id") }
    : { status: "absent" };
  const n = (key: string) => Number((counts as Row)[key]);
  return {
    materials,
    tags,
    materialTags,
    resolvedLinks,
    integrity: {
      materialCount: n("materialCount"),
      tagCount: n("tagCount"),
      linkCount: n("linkCount"),
      danglingMaterialRefs: n("danglingMaterialRefs"),
      danglingTagRefs: n("danglingTagRefs"),
    },
    unrelated,
  };
}

/** Strict structural equality of two complete states (row values, order and counts). */
export function sameState(a: FullState, b: FullState): boolean {
  return isDeepStrictEqual(normalize(a), normalize(b));
}
/** Top-level sections that differ, for readable failure messages and evidence lines. */
export function stateDifferences(a: FullState, b: FullState): string[] {
  const na = normalize(a) as unknown as Record<string, unknown>;
  const nb = normalize(b) as unknown as Record<string, unknown>;
  return Object.keys(na).filter((key) => !isDeepStrictEqual(na[key], nb[key]));
}
// Drivers return plain objects or null-prototype rows; compare values only.
function normalize(s: FullState): FullState {
  return JSON.parse(JSON.stringify(s)) as FullState;
}
/** Raw referential problems in one state, independent of any expectation. */
export function integrityProblems(s: FullState): string[] {
  const p: string[] = [];
  if (s.integrity.linkCount !== s.materialTags.length) p.push("link count disagrees with raw rows");
  if (s.integrity.danglingMaterialRefs) p.push(`${s.integrity.danglingMaterialRefs} link(s) to a missing material`);
  if (s.integrity.danglingTagRefs) p.push(`${s.integrity.danglingTagRefs} link(s) to a missing tag`);
  return p;
}

/* ------------------------------------------------------------------------------------------ */
/* PREP-R3: explicit expected outcome of an update                                             */
/* ------------------------------------------------------------------------------------------ */

export interface UpdateExpectation {
  id: string;
  title: string;
  /** Tag names the material must be linked to afterwards; undefined = links must be unchanged. */
  tags?: string[];
}

/**
 * Problems that make `after` something other than the complete, intended result of applying
 * `change` to `prior`. Empty array = accepted. Rules:
 * - the target row has the new title; every other column except updated_at is unchanged;
 * - every other material row is unchanged;
 * - the target's raw links resolve to exactly the intended names (or are unchanged if tags omitted);
 * - links of other materials are unchanged; no dangling link anywhere;
 * - every prior tag row is either unchanged (same id, name and other columns) or, only if no
 *   longer linked by anything, absent; prior tag ids are never reused for another name;
 * - every new tag row is linked by the target and named as intended (no stray tags);
 * - the unrelated table is conserved exactly.
 */
export function updateOutcomeProblems(prior: FullState, after: FullState, change: UpdateExpectation): string[] {
  const p: string[] = [...integrityProblems(after)];
  const plain = (rows: Row[]) => JSON.parse(JSON.stringify(rows)) as Row[];
  const [pm, am] = [plain(prior.materials), plain(after.materials)];
  const target = am.find((r) => r.id === change.id);
  const before = pm.find((r) => r.id === change.id);
  if (!before) p.push("target missing from prior state");
  if (!target) p.push("target missing after save");
  if (before && target) {
    if (target.title !== change.title) p.push(`title is ${JSON.stringify(target.title)}, expected ${JSON.stringify(change.title)}`);
    const { title: _a, updated_at: _b, ...restBefore } = before;
    const { title: _c, updated_at: _d, ...restAfter } = target;
    if (!isDeepStrictEqual(restBefore, restAfter)) p.push("a column outside the update contract changed");
  }
  const others = (rows: Row[]) => rows.filter((r) => r.id !== change.id);
  if (!isDeepStrictEqual(others(pm), others(am))) p.push("another material row changed");

  const tagById = new Map(plain(after.tags).map((t) => [t.id, t]));
  const priorTagById = new Map(plain(prior.tags).map((t) => [t.id, t]));
  const targetLinks = plain(after.materialTags).filter((l) => l.material_id === change.id);
  const linkedNames = targetLinks.map((l) => (tagById.get(l.tag_id) as Row | undefined)?.name).sort();
  const intended = change.tags === undefined
    ? plain(prior.materialTags).filter((l) => l.material_id === change.id).map((l) => (priorTagById.get(l.tag_id) as Row | undefined)?.name).sort()
    : [...change.tags].sort();
  if (!isDeepStrictEqual(linkedNames, intended)) p.push(`target links resolve to ${JSON.stringify(linkedNames)}, expected ${JSON.stringify(intended)}`);
  if (change.tags === undefined) {
    const raw = (s: FullState) => plain(s.materialTags).filter((l) => l.material_id === change.id);
    if (!isDeepStrictEqual(raw(prior), raw(after))) p.push("raw links changed although tags were omitted");
  }
  const otherLinks = (s: FullState) => plain(s.materialTags).filter((l) => l.material_id !== change.id);
  if (!isDeepStrictEqual(otherLinks(prior), otherLinks(after))) p.push("another material's links changed");

  const stillLinked = new Set(plain(after.materialTags).map((l) => l.tag_id));
  for (const [id, row] of priorTagById) {
    const now = tagById.get(id);
    if (now === undefined) {
      if (stillLinked.has(id)) p.push(`prior tag ${String(id)} removed while still linked`);
    } else if (!isDeepStrictEqual(now, row)) {
      p.push(`prior tag ${String(id)} changed`);
    }
  }
  const targetTagIds = new Set(targetLinks.map((l) => l.tag_id));
  for (const [id, row] of tagById) {
    if (priorTagById.has(id)) continue;
    if (!targetTagIds.has(id)) p.push(`stray new tag ${JSON.stringify(row.name)} (${String(id)})`);
  }
  if (!isDeepStrictEqual(JSON.parse(JSON.stringify(prior.unrelated)), JSON.parse(JSON.stringify(after.unrelated)))) {
    p.push("unrelated table changed");
  }
  return p;
}

/* ------------------------------------------------------------------------------------------ */
/* PREP-R1: one coherent observation from a single SQL statement                               */
/* ------------------------------------------------------------------------------------------ */

export interface MaterialObservation {
  materialRows: number;
  title: string | null;
  linkRows: number;
  danglingLinks: number;
  linkedNames: string | null;
  namedTagRows: number;
}

/**
 * Reads every value QT-02 needs in ONE public SELECT. SQLite evaluates a single statement against
 * one consistent view of the database, so the values cannot straddle a save that commits between
 * separate reads. No public BEGIN/COMMIT and no raw handle are involved.
 */
export async function observeMaterial(db: Queryable, id: string, tagNames: string[]): Promise<MaterialObservation> {
  const placeholders = tagNames.map(() => "?").join(", ") || "NULL";
  const [row] = await q(
    db,
    `SELECT
       (SELECT count(*) FROM study_materials WHERE id = ?) AS materialRows,
       (SELECT title FROM study_materials WHERE id = ?) AS title,
       (SELECT count(*) FROM material_tags WHERE material_id = ?) AS linkRows,
       (SELECT count(*) FROM material_tags mt WHERE mt.material_id = ?
          AND NOT EXISTS (SELECT 1 FROM tags t WHERE t.id = mt.tag_id)) AS danglingLinks,
       (SELECT group_concat(name, '|') FROM
          (SELECT t.name AS name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id
            WHERE mt.material_id = ? ORDER BY t.name)) AS linkedNames,
       (SELECT count(*) FROM tags WHERE name IN (${placeholders})) AS namedTagRows`,
    [id, id, id, id, id, ...tagNames],
  );
  const r = row as Row;
  return {
    materialRows: Number(r.materialRows),
    title: (r.title as string | null) ?? null,
    linkRows: Number(r.linkRows),
    danglingLinks: Number(r.danglingLinks),
    linkedNames: (r.linkedNames as string | null) ?? null,
    namedTagRows: Number(r.namedTagRows),
  };
}

export type ObservationClass = "none" | "complete" | "partial";

/**
 * Classifies one observation of a create that should add `expected.id` with `expected.title`
 * linked to `expected.tags` (all new tag names). "none" = nothing of the save is visible;
 * "complete" = all of it is; anything else is "partial", i.e. a read saw unfinished work.
 */
export function classifyCreate(o: MaterialObservation, expected: { title: string; tags: string[] }): ObservationClass {
  const names = [...expected.tags].sort().join("|") || null;
  if (o.materialRows === 0 && o.linkRows === 0 && o.namedTagRows === 0 && o.title === null) return "none";
  if (
    o.materialRows === 1 && o.title === expected.title && o.linkRows === expected.tags.length &&
    o.danglingLinks === 0 && o.linkedNames === names && o.namedTagRows === expected.tags.length
  ) return "complete";
  return "partial";
}

/* ------------------------------------------------------------------------------------------ */
/* Foreign-key proof that distinguishes a working engine from a refusing driver                */
/* ------------------------------------------------------------------------------------------ */

export interface WritableQueryable extends Queryable {
  execute(sql: string, params?: never[]): Promise<void>;
}
export type ForeignKeyOutcome =
  | { kind: "enforced"; setting: unknown; usableWrite: true; orphanError: string }
  | { kind: "fail-closed"; refusal: string }
  | { kind: "not-enforced"; setting: unknown; detail: string };

const FK_ERROR = /FOREIGN KEY constraint failed/i;
function describeError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 4; depth++) {
    parts.push(String((cur as { message?: unknown }).message ?? cur));
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" <- ");
}

/**
 * Proves foreign-key enforcement on a usable connection, or records that the driver failed closed.
 * Steps: (1) an ordinary safe write in a scratch table must succeed, otherwise the driver is
 * refusing all work ("fail-closed", never called enforced); (2) PRAGMA foreign_keys is read;
 * (3) an orphan material_tags insert must fail with SQLite's foreign-key error specifically.
 * The scratch table is dropped again when the write was admitted.
 */
export async function proveForeignKeyEnforcement(db: WritableQueryable): Promise<ForeignKeyOutcome> {
  try {
    await db.execute("CREATE TABLE IF NOT EXISTS fk_probe_scratch (id TEXT)");
    await db.execute("INSERT INTO fk_probe_scratch (id) VALUES ('usable')");
  } catch (e) {
    return { kind: "fail-closed", refusal: describeError(e) };
  }
  let setting: unknown = "unreadable";
  try {
    const [row] = await q(db, "PRAGMA foreign_keys");
    setting = row ? Object.values(row)[0] : "no row";
  } catch (e) {
    setting = `unreadable: ${describeError(e)}`;
  }
  let outcome: ForeignKeyOutcome;
  try {
    await db.execute("INSERT INTO material_tags (material_id, tag_id) VALUES ('fk-missing-material', 'fk-missing-tag')");
    outcome = { kind: "not-enforced", setting, detail: "orphan link insert was accepted" };
  } catch (e) {
    const message = describeError(e);
    outcome = FK_ERROR.test(message)
      ? { kind: "enforced", setting, usableWrite: true, orphanError: message }
      : { kind: "not-enforced", setting, detail: `orphan insert failed for another reason: ${message}` };
  }
  await db.execute("DROP TABLE IF EXISTS fk_probe_scratch");
  return outcome;
}

/* ------------------------------------------------------------------------------------------ */
/* Deterministic "ownership is held" barrier (CONDITIONAL on the driver's statement route)     */
/* ------------------------------------------------------------------------------------------ */

export interface BarrierTarget {
  proto: object;
  methods: string[];
}
export interface BarrierEvent {
  sql: string;
  /** node:sqlite's own `isTransaction` at the event, or "unknown" where the engine has none. */
  engineReportsTransaction: boolean | "unknown";
}
export interface Barrier {
  fired(): number;
  events(): BarrierEvent[];
  restore(): void;
}
const installed = new Set<Barrier>();
/** Restores every barrier still installed; call from afterEach so a failing case cannot leak one. */
export function restoreAllBarriers() {
  for (const b of [...installed]) b.restore();
}
const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim();

/**
 * Wraps engine statement methods (for example DatabaseSync.prototype.prepare/exec, or sql.js
 * Database.prototype.prepare/run/exec). It tracks transaction-control statements reaching the
 * engine and fires `onEvent` exactly once, synchronously, when `isEvent(sql)` matches while a
 * transaction opened through those methods is still open. The event fires BEFORE the matching
 * statement runs, so earlier statements of the owning operation have executed and later ones
 * have not. Anything requested from `onEvent` is therefore requested while ownership is held.
 * Statements issued from inside `onEvent` pass straight through.
 */
export function installStatementBarrier(
  targets: BarrierTarget[],
  isEvent: (sql: string) => boolean,
  onEvent: (event: BarrierEvent) => void,
): Barrier {
  let open = false;
  let inEvent = false;
  const events: BarrierEvent[] = [];
  const originals: Array<[object, string, unknown]> = [];
  for (const { proto, methods } of targets) {
    for (const method of methods) {
      const original = (proto as Record<string, unknown>)[method] as (...args: unknown[]) => unknown;
      originals.push([proto, method, original]);
      (proto as Record<string, unknown>)[method] = function (this: unknown, ...args: unknown[]) {
        const sql = typeof args[0] === "string" ? args[0] : "";
        if (!inEvent && sql) {
          const head = stripComments(sql).toUpperCase();
          if (/^(BEGIN|SAVEPOINT)\b/.test(head)) open = true;
          else if (/^(COMMIT|END|RELEASE)\b/.test(head) || /^ROLLBACK\s*(TRANSACTION)?\s*;?$/.test(head)) open = false;
          else if (open && events.length === 0 && isEvent(sql)) {
            const tx = (this as { isTransaction?: unknown }).isTransaction;
            const event: BarrierEvent = { sql, engineReportsTransaction: typeof tx === "boolean" ? tx : "unknown" };
            events.push(event);
            inEvent = true;
            try {
              onEvent(event);
            } finally {
              inEvent = false;
            }
          }
        }
        return original.apply(this, args);
      };
    }
  }
  const barrier: Barrier = {
    fired: () => events.length,
    events: () => [...events],
    restore: () => {
      for (const [proto, method, original] of originals.reverse()) (proto as Record<string, unknown>)[method] = original;
      originals.length = 0;
      installed.delete(barrier);
    },
  };
  installed.add(barrier);
  return barrier;
}

/** The event used by QT-02b/QT-11b: the save's first tag-link insert reaches the engine. */
export const LINK_INSERT = (sql: string) => /\bINSERT\s+(OR\s+\w+\s+)?INTO\s+material_tags\b/i.test(sql);
