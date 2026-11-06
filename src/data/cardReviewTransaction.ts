/**
 * Single-connection atomic card-review transaction (M2-3 source slice C1):
 * the browser (sql.js) and test (node:sqlite) twin of the native
 * `save_card_review_atomically` in `src-tauri/src/card_reviews.rs`.
 *
 * Order, exactly as the scope's section 6:
 * 1. strict two-pass decode of the typed union (before any write)
 * 2. one immediate transaction on the owned connection
 * 3. same-ID replay first: conflict, then erased, then the stored result
 * 4. the generation barrier
 * 5. the item branch (content, item, materialize, revision, action), or
 * 6. the reset branch (no item fields)
 * 7. commit; any refusal leaves projection, event, receipt and generation
 *    counts unchanged
 *
 * `timestamp` is the system clock read at the start of the operation
 * (injectable for tests); the client never supplies the review time.
 */
import type {
  CardFlagReason,
  CardItemAction,
  CardItemActionName,
  CardItemResult,
  CardRating,
  CardResetResult,
  CardReviewAction,
  CardReviewResult,
} from "@/domain/types";
import { canonicalJson, cardVersion, parseSavedCards, sha256Hex, versionOrigin, type CanonicalCard, type CardVersion } from "@/logic/cardIdentity";
import { isIsoInstant, SCHEDULER_VERSION, scheduleCard, SchedulerRefusal, type CardSchedule } from "@/logic/cardScheduler";

import { freezeCardSources } from "./studyPageSources";
import { homeworkCardContextCodec } from "@/domain/homework";
import { recordHomeworkCardRating, invalidateHomeworkCardRuns } from "./homeworkCards";
import type { SqlValue } from "./db";
import { CardReviewError, type CardReviewErrorCode } from "./persistenceErrors";

export type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

export const MAX_CARD_REVIEW_PAYLOAD_BYTES = 64 * 1024;
export const MAX_EXPECTED_COUNTER = 1_000_000_000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const MATERIAL_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const ITEM_ACTIONS: readonly CardItemActionName[] = ["rate", "suspend", "resume", "flag", "unflag"];
const RATINGS: readonly CardRating[] = ["again", "hard", "good", "easy"];
const FLAG_REASONS: readonly CardFlagReason[] = ["wrong_answer", "unclear", "not_in_source"];
const ITEM_KEYS = ["action", "operationId", "materialId", "versionContentHash", "itemId", "expectedGeneration", "expectedRevision"];
const RESET_KEYS = ["action", "operationId", "materialId", "expectedGeneration"];

function refuse(code: CardReviewErrorCode): never {
  throw new CardReviewError(code);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    refuse("INVALID_ARGUMENT");
  }
}

function stringMatching(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) refuse("INVALID_ARGUMENT");
  return value;
}

function counter(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_EXPECTED_COUNTER) {
    refuse("INVALID_ARGUMENT");
  }
  return value;
}

/**
 * Strict two-pass decode: first the branch and its exact keys, then every
 * field's type and bounds. A reset carries no item fields; an item action
 * without a generation, or with a stray key, is invalid.
 */
export function decodeCardReviewAction(value: unknown): CardReviewAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse("INVALID_ARGUMENT");
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    refuse("INVALID_ARGUMENT");
  }
  if (new TextEncoder().encode(encoded).length > MAX_CARD_REVIEW_PAYLOAD_BYTES) refuse("INVALID_ARGUMENT");
  const object = value as Record<string, unknown>;
  const action = object.action;

  // Pass one: the branch and its exact keys.
  if (action === "reset") {
    exactKeys(object, RESET_KEYS);
  } else if (typeof action === "string" && (ITEM_ACTIONS as readonly string[]).includes(action)) {
    const extra = action === "rate" ? ["rating", ...(Object.hasOwn(object,"homework") ? ["homework"] : [])] : action === "flag" ? ["reason"] : [];
    exactKeys(object, [...ITEM_KEYS, ...extra]);
  } else {
    refuse("INVALID_ARGUMENT");
  }

  // Pass two: types and bounds.
  const operationId = stringMatching(object.operationId, UUID_V4);
  const materialId = stringMatching(object.materialId, MATERIAL_ID);
  const expectedGeneration = counter(object.expectedGeneration);
  if (action === "reset") return { action, operationId, materialId, expectedGeneration };

  const base = {
    operationId,
    materialId,
    versionContentHash: stringMatching(object.versionContentHash, HEX_64),
    itemId: stringMatching(object.itemId, HEX_64),
    expectedGeneration,
    expectedRevision: counter(object.expectedRevision),
  };
  if (action === "rate") {
    if (typeof object.rating !== "string" || !(RATINGS as readonly string[]).includes(object.rating)) refuse("INVALID_ARGUMENT");
    const context=Object.hasOwn(object,"homework") ? homeworkCardContextCodec.safeParse(object.homework) : null;
    if(context && !context.success) refuse("INVALID_ARGUMENT");
    return { ...base, action, rating: object.rating as CardRating, ...(context?.success ? {homework:context.data} : {}) };
  }
  if (action === "flag") {
    if (typeof object.reason !== "string" || !(FLAG_REASONS as readonly string[]).includes(object.reason)) refuse("INVALID_ARGUMENT");
    return { ...base, action, reason: object.reason as CardFlagReason };
  }
  return { ...base, action: action as "suspend" | "resume" | "unflag" };
}

const int = (value: unknown): number => (typeof value === "bigint" ? Number(value) : Number(value));

interface StateRow {
  schedulerVersion: string;
  step: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  reps: number;
  lapses: number;
  suspended: boolean;
  flag: CardFlagReason | null;
  revision: number;
}

async function readGeneration(query: Query, materialId: string): Promise<number> {
  const [row] = await query("SELECT generation FROM card_review_generations WHERE source_material_id = ?", [materialId]);
  return row ? int(row.generation) : 0;
}

async function readState(query: Query, itemId: string): Promise<StateRow | null> {
  const [row] = await query(
    `SELECT scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
     FROM card_review_state WHERE item_id = ?`,
    [itemId],
  );
  if (!row) return null;
  return {
    schedulerVersion: String(row.scheduler_version),
    step: int(row.step),
    dueAt: row.due_at === null ? null : String(row.due_at),
    lastReviewedAt: row.last_reviewed_at === null ? null : String(row.last_reviewed_at),
    reps: int(row.reps),
    lapses: int(row.lapses),
    suspended: int(row.suspended) === 1,
    flag: row.flag === null ? null : (String(row.flag) as CardFlagReason),
    revision: int(row.revision),
  };
}

/** The saved cards of a material and their provider, or null when there is no set. */
async function readSavedSet(query: Query, materialId: string): Promise<{ flashcardsJson: string; provider: string } | null> {
  const [row] = await query("SELECT flashcards_json, provider FROM ai_study_sets WHERE source_material_id = ?", [materialId]);
  if (!row) return null;
  return { flashcardsJson: String(row.flashcards_json), provider: String(row.provider) };
}

/**
 * Write the snapshot of the current cards if it is absent (the first item
 * action of any kind), verify a stored one against the derived text, and
 * make it the material's only active version.
 */
async function materialize(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  materialId: string,
  version: CardVersion,
  provider: string,
  now: string,
): Promise<void> {
  const [stored] = await query("SELECT source_material_id, content_hash FROM card_versions WHERE id = ?", [version.versionId]);
  const hasVisual=(await query("SELECT 1 FROM sqlite_master WHERE name='card_item_visual_regions'",[])).length>0;
  if (stored) {
    if (stored.source_material_id !== materialId || stored.content_hash !== version.contentHash) refuse("INVALID_STATE");
    const items = await query(
      `SELECT i.id, i.ordinal, i.front, i.back, i.source_page, o.origin FROM card_items i
       LEFT JOIN card_item_origins o ON o.item_id = i.id
       WHERE i.version_id = ? ORDER BY i.ordinal`,
      [version.versionId],
    );
    if (items.length !== version.items.length) refuse("INVALID_STATE");
    for(const [index,row] of items.entries()) {
      const [sidecar]=hasVisual ? await query("SELECT region_id FROM card_item_visual_regions WHERE item_id=?",[String(row.id)]) : [];
      if((sidecar?.region_id??undefined)!==version.items[index]!.visualRegionId) refuse("INVALID_STATE");
    }
    items.forEach((row, index) => {
      const item = version.items[index]!;
      const sourcePage = row.source_page === null ? null : int(row.source_page);
      const origin = row.origin === null || row.origin === undefined ? undefined : row.origin;
      if (row.id !== item.itemId || int(row.ordinal) !== item.ordinal || row.front !== item.front || row.back !== item.back || sourcePage !== item.sourcePage || origin !== item.origin) {
        refuse("INVALID_STATE");
      }
    });
  } else {
    // The legacy CHECK allows only these two; a set the student made themselves records
    // 'import' as its placeholder, and its true origin in the side tables.
    if (provider === "manual") provider = "import";
    if (provider !== "gemini" && provider !== "import") refuse("INVALID_STATE");
    await run(
      `INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, first_reviewed_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
      [version.versionId, materialId, version.contentHash, version.items.length, provider, now],
    );
    for (const item of version.items) {
      await run(
        "INSERT INTO card_items (id, version_id, ordinal, front, back, source_page) VALUES (?, ?, ?, ?, ?, ?)",
        [item.itemId, version.versionId, item.ordinal, item.front, item.back, item.sourcePage],
      );
      if(item.visualRegionId) {
        const {readVisualRegion}=await import("./visualCards");
        try {await readVisualRegion(query,item.visualRegionId,materialId);} catch {refuse("INVALID_STATE");}
        await run("INSERT INTO card_item_visual_regions (item_id,region_id) VALUES (?,?)",[item.itemId,item.visualRegionId]);
      }
      if (item.origin) await run("INSERT INTO card_item_origins (item_id, origin) VALUES (?, ?)", [item.itemId, item.origin]);
    }
    const origin = versionOrigin(version.items);
    if (origin) await run("INSERT INTO card_version_origins (version_id, origin) VALUES (?, ?)", [version.versionId, origin]);
  }
  await run("UPDATE card_versions SET is_active = 0 WHERE source_material_id = ? AND id != ? AND is_active = 1", [
    materialId,
    version.versionId,
  ]);
  await run("UPDATE card_versions SET is_active = 1 WHERE id = ?", [version.versionId]);
}

/** A UUIDv4-shaped id derived from `seed`: the twin of native `derived_uuid_v4`. */
export async function derivedUuidV4(seed: string): Promise<string> {
  const h = await sha256Hex(seed);
  const variant = "89ab"[parseInt(h[16]!, 16) % 4]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* ------------------------------------------------------------------ */
/* Per-card carry-over (R13b1): the twin of native `carry_into`         */
/* ------------------------------------------------------------------ */

type Run = (sql: string, params: SqlValue[]) => Promise<void> | void;

/** The compared form of one card: sorted-key JSON, a missing origin or picture left out. */
function cardKey(card: CanonicalCard): string {
  return canonicalJson({
    front: card.front,
    back: card.back,
    sourcePage: card.sourcePage,
    ...(card.origin ? { origin: card.origin } : {}),
    ...(card.visualRegionId ? { visualRegionId: card.visualRegionId } : {}),
  });
}

/**
 * Pairs `[srcOrdinal, dstOrdinal]` of equal cards (the twin of native
 * `match_cards`). The k-th occurrence of a card in `src` maps to the k-th in
 * `dst`; extra copies on either side get no match. Bytes are compared exactly.
 */
export function matchCards(src: readonly CanonicalCard[], dst: readonly CanonicalCard[]): Array<[number, number]> {
  const slots = new Map<string, number[]>();
  dst.forEach((card, d) => {
    const key = cardKey(card);
    const list = slots.get(key);
    if (list) list.push(d);
    else slots.set(key, [d]);
  });
  const taken = new Map<string, number>();
  const out: Array<[number, number]> = [];
  src.forEach((card, s) => {
    const key = cardKey(card);
    const used = taken.get(key) ?? 0;
    const d = slots.get(key)?.[used];
    if (d !== undefined) {
      out.push([s, d]);
      taken.set(key, used + 1);
    }
  });
  return out;
}

interface StoredVersion {
  versionId: string;
  createdAt: string;
  firstReviewedAt: string | null;
  cards: CanonicalCard[];
  itemIds: string[];
  /** False when the recomputed hash or item ids differ from what is stored: never a source. */
  verified: boolean;
}

/** Every stored version of the material, ordered by `card_count, id`. */
async function loadVersions(query: Query, materialId: string): Promise<StoredVersion[]> {
  const hasVisual = (await query("SELECT 1 FROM sqlite_master WHERE name='card_item_visual_regions'", [])).length > 0;
  const heads = await query(
    "SELECT id, content_hash, created_at, first_reviewed_at FROM card_versions WHERE source_material_id = ? ORDER BY card_count, id",
    [materialId],
  );
  const out: StoredVersion[] = [];
  for (const head of heads) {
    const rows = await query(
      `SELECT i.id, i.front, i.back, i.source_page, o.origin${hasVisual ? ", r.region_id" : ""} FROM card_items i
       LEFT JOIN card_item_origins o ON o.item_id = i.id
       ${hasVisual ? "LEFT JOIN card_item_visual_regions r ON r.item_id = i.id" : ""}
       WHERE i.version_id = ? ORDER BY i.ordinal`,
      [String(head.id)],
    );
    const cards: CanonicalCard[] = rows.map((row) => ({
      front: String(row.front),
      back: String(row.back),
      sourcePage: row.source_page === null || row.source_page === undefined ? null : int(row.source_page),
      ...(row.origin ? { origin: String(row.origin) as CanonicalCard["origin"] } : {}),
      ...(row.region_id ? { visualRegionId: String(row.region_id) } : {}),
    }));
    const itemIds = rows.map((row) => String(row.id));
    const derived = await cardVersion(materialId, cards);
    out.push({
      versionId: String(head.id),
      createdAt: String(head.created_at),
      firstReviewedAt: head.first_reviewed_at === null || head.first_reviewed_at === undefined ? null : String(head.first_reviewed_at),
      cards,
      itemIds,
      verified:
        cards.length > 0 &&
        derived.versionId === String(head.id) &&
        derived.contentHash === String(head.content_hash) &&
        derived.items.every((item, i) => item.itemId === itemIds[i]),
    });
  }
  return out;
}

interface StoredEvent {
  id: string;
  itemId: string;
  generation: number;
  rating: CardRating;
  reviewedAt: string;
  schedulerVersion: string;
  prior: string;
  next: string;
}

type EventsByKey = Map<string, number[]>;
const timeKey = (e: { reviewedAt: string; rating: string }) => `${e.reviewedAt}\u0000${e.rating}`;

/**
 * The original rating behind event `start` (native `root_index`). Event x is a
 * copy when some event r with the same time and rating has
 * `derivedUuidV4(r.id, x.item) == x.id`; follow that to the root. A cycle makes
 * `start` its own root; the walk is bounded by the number of versions.
 */
async function rootIndex(
  events: StoredEvent[],
  byKey: EventsByKey,
  start: number,
  bound: number,
  carried: (parent: string, item: string) => Promise<string>,
): Promise<number> {
  const seen = [start];
  let current = start;
  for (let hop = 0; hop <= bound; hop++) {
    const x = events[current]!;
    let parent: number | undefined;
    for (const r of byKey.get(timeKey(x)) ?? []) {
      if (r !== current && (await carried(events[r]!.id, x.itemId)) === x.id) {
        parent = r;
        break;
      }
    }
    if (parent === undefined) return current;
    if (seen.includes(parent)) return start;
    seen.push(parent);
    current = parent;
  }
  return start;
}

/**
 * Lazy, memoized root lookup (native `RootResolver`): only events asked about are
 * resolved, and the first root found in a (time, rating) group is tried first, so
 * one hash confirms a one-hop copy. Only an old-build path id takes the full walk.
 */
function rootResolver(events: StoredEvent[], byKey: EventsByKey, bound: number) {
  const hashes = new Map<string, Promise<string>>();
  const carried = (parent: string, item: string) => {
    const key = `${parent}\u0000${item}`;
    let found = hashes.get(key);
    if (!found) {
      found = derivedUuidV4(key);
      hashes.set(key, found);
    }
    return found;
  };
  const memo = new Map<number, number>();
  const hint = new Map<string, number>();
  return async (i: number): Promise<number> => {
    const known = memo.get(i);
    if (known !== undefined) return known;
    const x = events[i]!;
    const key = timeKey(x);
    const h = hint.get(key);
    let root: number;
    if (h !== undefined && (h === i || (await carried(events[h]!.id, x.itemId)) === x.id)) root = h;
    else {
      root = await rootIndex(events, byKey, i, bound, carried);
      if (!hint.has(key)) hint.set(key, root);
    }
    memo.set(i, root);
    return root;
  };
}

interface Write {
  sql: string;
  params: SqlValue[];
}

interface Folded {
  id: string;
  prior: CardSchedule | null;
  next: CardSchedule;
}

/** D4 order without devices (the browser has no sync): (reviewed_at, id). */
function foldEvents(events: ReadonlyArray<{ id: string; rating: CardRating; reviewedAt: string; schedulerVersion: string }>): Folded[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: Folded[] = [];
  let prior: CardSchedule | null = null;
  for (const e of sorted) {
    if (e.schedulerVersion !== SCHEDULER_VERSION) throw new SchedulerRefusal("UNSUPPORTED_SCHEDULER_VERSION");
    const next = scheduleCard(prior, e.rating, e.reviewedAt);
    out.push({ id: e.id, prior, next });
    prior = next;
  }
  return out;
}

const STATE_COPY_SQL = `INSERT OR IGNORE INTO card_review_state
     (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
   SELECT ?, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
   FROM card_review_state WHERE item_id = ?`;

/**
 * Plans (reads only, nothing written) the carry of every other stored version
 * of the material onto `dst`, card by card: the twin of native `carry_into`
 * with `logged = true`. The browser has no savepoint, so everything that can
 * fail runs here, before the first write. Returns the writes in order, the
 * destination items that gained events, and the earliest first-review time of
 * the contributing versions.
 */
async function planCarry(
  query: Query,
  materialId: string,
  dst: CardVersion,
): Promise<{ writes: Write[]; gained: string[] }> {
  const generation = await readGeneration(query, materialId);
  const versions = await loadVersions(query, materialId);
  const sources = versions.filter((v) => v.verified && v.versionId !== dst.versionId);
  const dstCards: CanonicalCard[] = dst.items.map(({ front, back, sourcePage, origin, visualRegionId }) => ({
    front,
    back,
    sourcePage,
    ...(origin ? { origin } : {}),
    ...(visualRegionId ? { visualRegionId } : {}),
  }));
  const matches = sources.map((s) => matchCards(s.cards, dstCards));
  if (matches.every((m) => m.length === 0)) return { writes: [], gained: [] };

  const eventRows = await query(
    `SELECT e.id, e.item_id, e.generation, e.rating, e.reviewed_at, e.scheduler_version, e.prior_state_json, e.next_state_json
     FROM card_review_events e
     JOIN card_items i ON i.id = e.item_id
     JOIN card_versions v ON v.id = i.version_id
     WHERE v.source_material_id = ? AND e.generation = ?
     ORDER BY e.reviewed_at, e.id`,
    [materialId, generation],
  );
  const events: StoredEvent[] = eventRows.map((row) => ({
    id: String(row.id),
    itemId: String(row.item_id),
    generation: int(row.generation),
    rating: String(row.rating) as CardRating,
    reviewedAt: String(row.reviewed_at),
    schedulerVersion: String(row.scheduler_version),
    prior: String(row.prior_state_json),
    next: String(row.next_state_json),
  }));
  const byKey: EventsByKey = new Map();
  const byItem = new Map<string, number[]>();
  events.forEach((e, i) => {
    const k = timeKey(e);
    if (byKey.has(k)) byKey.get(k)!.push(i);
    else byKey.set(k, [i]);
    if (byItem.has(e.itemId)) byItem.get(e.itemId)!.push(i);
    else byItem.set(e.itemId, [i]);
  });
  const rootOf = rootResolver(events, byKey, versions.length);
  // Live rate receipts by operation id.
  const receiptRows = await query(
    `SELECT operation_id, generation, applied_at, result_json FROM card_review_operations
     WHERE source_material_id = ? AND action = 'rate' AND is_erased = 0 AND result_json IS NOT NULL`,
    [materialId],
  );
  const receipts = new Map(receiptRows.map((row) => [String(row.operation_id), { generation: int(row.generation), appliedAt: String(row.applied_at), result: String(row.result_json) }]));

  const writes: Write[] = [];
  interface Gain {
    item: string;
    sources: Set<string>;
    added: number;
    hadEvents: boolean;
    hadState: boolean;
    newEvents: StoredEvent[];
  }
  const gains: Gain[] = [];
  const contributing = new Set<number>();
  const preferred = (matched: Array<[number, string]>) =>
    [...matched].sort((a, b) => (sources[b[0]]!.createdAt < sources[a[0]]!.createdAt ? -1 : sources[b[0]]!.createdAt > sources[a[0]]!.createdAt ? 1 : sources[a[0]]!.versionId < sources[b[0]]!.versionId ? -1 : 1));

  for (let d = 0; d < dst.items.length; d++) {
    const dstItem = dst.items[d]!.itemId;
    const matched: Array<[number, string]> = [];
    matches.forEach((pairs, si) => {
      for (const [s, dd] of pairs) if (dd === d) matched.push([si, sources[si]!.itemIds[s]!]);
    });
    if (matched.length === 0) continue;
    const existing = byItem.get(dstItem) ?? [];
    const present = new Set(existing.map((i) => timeKey(events[i]!)));
    // time+rating -> root id -> [root index, source event index, source version]
    const groups = new Map<string, Map<string, [number, number, number]>>();
    for (const [si, srcItem] of matched) {
      for (const ei of byItem.get(srcItem) ?? []) {
        const root = await rootOf(ei);
        const k = timeKey(events[ei]!);
        if (!groups.has(k)) groups.set(k, new Map());
        const group = groups.get(k)!;
        if (!group.has(events[root]!.id)) group.set(events[root]!.id, [root, ei, si]);
      }
    }
    const gain: Gain = {
      item: dstItem,
      sources: new Set(),
      added: 0,
      hadEvents: existing.length > 0,
      hadState: (await readState(query, dstItem)) !== null,
      newEvents: [],
    };
    // Groups in (time, rating) order, roots in id order: nothing depends on map iteration.
    for (const k of [...groups.keys()].sort()) {
      if (present.has(k)) continue;
      const group = groups.get(k)!;
      const chosen = [...group.keys()]
        .sort()
        .map((id) => group.get(id)!)
        .find(([root]) => receipts.has(events[root]!.id));
      if (!chosen) continue;
      const [root, ei, si] = chosen;
      const rootEvent = events[root]!;
      const srcEvent = events[ei]!;
      const carried = await derivedUuidV4(`${rootEvent.id}\u0000${dstItem}`);
      const receipt = receipts.get(rootEvent.id)!;
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(receipt.result) as Record<string, unknown>;
      } catch {
        refuse("INVALID_STATE");
      }
      result.itemId = dstItem;
      writes.push({
        sql: `INSERT OR IGNORE INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [carried, dstItem, srcEvent.generation, srcEvent.rating, srcEvent.reviewedAt, srcEvent.schedulerVersion, srcEvent.prior, srcEvent.next],
      });
      writes.push({
        sql: `INSERT OR IGNORE INTO card_review_operations
                (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
              VALUES (?, 'rate', ?, ?, ?, ?, 0, ?)`,
        params: [carried, materialId, receipt.generation, await sha256Hex(carried), receipt.appliedAt, canonicalJson(result)],
      });
      gain.sources.add(srcEvent.itemId);
      gain.added += 1;
      gain.newEvents.push({ ...srcEvent, id: carried, itemId: dstItem });
      contributing.add(si);
    }
    if (gain.added > 0) gains.push(gain);
    else if (!gain.hadState) {
      // Nothing rated to carry: a paused or flagged card keeps that (unrated state rows only).
      for (const [, srcItem] of preferred(matched)) {
        const state = await readState(query, srcItem);
        if (!state) continue;
        if (state.dueAt === null && state.lastReviewedAt === null && state.reps === 0) {
          writes.push({ sql: STATE_COPY_SQL, params: [dstItem, srcItem] });
        }
        break;
      }
    }
  }

  for (const gain of gains) {
    let verbatim = false;
    if (!gain.hadEvents && !gain.hadState && gain.sources.size === 1) {
      const srcItem = [...gain.sources][0]!;
      const state = await readState(query, srcItem);
      if (state && state.reps === gain.added && (byItem.get(srcItem)?.length ?? 0) === gain.added) {
        writes.push({ sql: STATE_COPY_SQL, params: [gain.item, srcItem] });
        verbatim = true;
      }
    }
    if (verbatim) continue;
    // Re-fold: all of the item's events in order, each event's prior/next rewritten, the state set from the fold.
    const all = [...eventsOf(gain.item, byItem, events), ...gain.newEvents];
    const folded = foldEvents(all);
    const last = folded.at(-1);
    if (!last) continue;
    for (const f of folded) {
      const prior = f.prior ? canonicalJson(f.prior) : "null";
      const next = canonicalJson(f.next);
      writes.push({
        sql: `UPDATE card_review_events SET prior_state_json = ?, next_state_json = ?
              WHERE id = ? AND (prior_state_json IS NOT ? OR next_state_json IS NOT ?)`,
        params: [prior, next, f.id, prior, next],
      });
    }
    const local = await readState(query, gain.item);
    let suspended = local?.suspended ?? false;
    let flag: CardFlagReason | null = local?.flag ?? null;
    if (!local) {
      const d = dst.items.findIndex((item) => item.itemId === gain.item);
      const matched: Array<[number, string]> = [];
      matches.forEach((pairs, si) => {
        for (const [s, dd] of pairs) if (dd === d) matched.push([si, sources[si]!.itemIds[s]!]);
      });
      for (const [, srcItem] of preferred(matched)) {
        const state = await readState(query, srcItem);
        if (state) {
          suspended = state.suspended;
          flag = state.flag;
          break;
        }
      }
    }
    const revision = Math.max(local ? local.revision + 1 : 1, folded.length);
    const s = last.next;
    writes.push({
      sql: `INSERT INTO card_review_state
              (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(item_id) DO UPDATE SET
              scheduler_version = excluded.scheduler_version, step = excluded.step, due_at = excluded.due_at,
              last_reviewed_at = excluded.last_reviewed_at, reps = excluded.reps, lapses = excluded.lapses,
              suspended = excluded.suspended, flag = excluded.flag, revision = excluded.revision`,
      params: [gain.item, materialId, s.schedulerVersion, s.step, s.dueAt, s.lastReviewedAt, s.reps, s.lapses, suspended ? 1 : 0, flag, revision],
    });
  }

  if (gains.length > 0) {
    const times = [...contributing].map((si) => sources[si]!.firstReviewedAt).filter((t): t is string => t !== null).sort();
    if (times[0] !== undefined) {
      writes.push({
        sql: "UPDATE card_versions SET first_reviewed_at = ? WHERE id = ? AND first_reviewed_at IS NULL",
        params: [times[0], dst.versionId],
      });
    }
  }
  return { writes, gained: gains.map((g) => g.item).sort() };
}

function eventsOf(item: string, byItem: Map<string, number[]>, events: StoredEvent[]): StoredEvent[] {
  return (byItem.get(item) ?? []).map((i) => events[i]!);
}

/**
 * PER-CARD CARRY-OVER, the twin of native `carry_review_state` (owner decision
 * 05 Nov: an edit changes only the edited card). Every card of the new
 * list that is the same card as a card of ANY stored version of the material
 * keeps that card's ratings: they are copied onto the new version's item with
 * their receipts, the state row follows, and nothing existing is deleted. A
 * card is the same card when `matchCards` pairs it (front, back, page, origin,
 * picture region), so an edited card starts fresh, a moved card keeps its
 * ratings and a deleted card does not stop the others. A save that matches no
 * stored card makes no version, and a save that changes no card does nothing.
 * Unlike native there is no savepoint (the single-connection drivers refuse
 * them), so what could make `materialize` refuse (a picture region the material
 * does not own, unknown providers) is checked first, and the whole carry is
 * planned from reads before the first write. The browser has no sync, so a
 * never-studied list is not snapshotted when nothing is stored to carry.
 */
export async function carryReviewState(
  run: Run,
  query: Query,
  materialId: string,
  beforeJson: string,
  afterJson: string,
  provider: string,
  now: string,
): Promise<void> {
  if (!["gemini", "import", "manual"].includes(provider)) return;
  const before = parseSavedCards(beforeJson);
  const after = parseSavedCards(afterJson);
  if (before.status !== "ok" || after.status !== "ok") return;
  const old = before.cards;
  const next = after.cards;
  const oldVersion = await cardVersion(materialId, old);
  const newVersion = await cardVersion(materialId, next);
  // A save with no change: nothing to carry and no activation to record.
  if (oldVersion.versionId === newVersion.versionId) return;
  // Picture cards carry like any other card. The browser has no savepoint, so
  // check first what native `materialize` would refuse: a region this material
  // does not own (or that is damaged) carries nothing.
  const { readVisualRegion } = await import("./visualCards");
  for (const card of next) {
    if (!card.visualRegionId) continue;
    try {
      await readVisualRegion(query, card.visualRegionId, materialId);
    } catch {
      return;
    }
  }
  // Everything that can refuse runs before the first write and only skips the
  // carry (native rolls the carry back and the save stands): a damaged stored
  // version, a refused `materialize`, a scheduler refusal.
  let plan: { writes: Write[]; gained: string[] };
  try {
    const stored = await loadVersions(query, materialId);
    const sharesACard = (cards: readonly CanonicalCard[]) => matchCards(cards, next).length > 0;
    const storedShares = stored.some((v) => v.verified && v.versionId !== newVersion.versionId && sharesACard(v.cards));
    if (!sharesACard(old) && !storedShares) return;
    // Native snapshots a never-studied list so sync can carry into it; the browser has no sync.
    if (!stored.some((v) => v.versionId === oldVersion.versionId) && !storedShares) return;
    // A stored copy of the new list that no longer matches its hash, items or pictures: carry nothing.
    const storedNew = stored.find((v) => v.versionId === newVersion.versionId);
    if (storedNew && !storedNew.verified) return;
    plan = await planCarry(query, materialId, newVersion);
    await materialize(run, query, materialId, newVersion, provider, now);
  } catch {
    return;
  }
  for (const write of plan.writes) await run(write.sql, write.params);
}

async function applyItem(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  action: CardItemAction,
  generation: number,
  requestHash: string,
  now: string,
): Promise<CardItemResult> {
  const saved = await readSavedSet(query, action.materialId);
  if (!saved) refuse("NOT_FOUND");
  const cards = parseSavedCards(saved.flashcardsJson);
  if (cards.status === "malformed") refuse("MALFORMED_CARDS");
  if (cards.status === "none") refuse("NOT_FOUND");
  const version = await cardVersion(action.materialId, cards.cards);
  if (version.contentHash !== action.versionContentHash) refuse("STALE_CONTENT");
  if (!version.items.some((item) => item.itemId === action.itemId)) refuse("NOT_FOUND");
  const target=version.items.find(i=>i.itemId===action.itemId)!;
  if(target.visualRegionId) {
    try {const {readVisualRegion}=await import("./visualCards"); const r=await readVisualRegion(query,target.visualRegionId,action.materialId); if(action.action==="rate" && !r.imageMaterialId) refuse("INVALID_STATE");} catch {refuse("INVALID_STATE");}
  }

  await materialize(run, query, action.materialId, version, saved.provider, now);
  await freezeCardSources(run, query, action.materialId, version.items, JSON.parse(saved.flashcardsJson));

  const current = await readState(query, action.itemId);
  const revision = current?.revision ?? 0;
  if (action.expectedRevision !== revision) refuse("STALE_REVISION");

  const next: StateRow = current
    ? { ...current, revision: revision + 1 }
    : {
        schedulerVersion: SCHEDULER_VERSION,
        step: -1,
        dueAt: null,
        lastReviewedAt: null,
        reps: 0,
        lapses: 0,
        suspended: false,
        flag: null,
        revision: 1,
      };
  let reviewedAt: string | null = null;

  if (action.action === "rate") {
    if (next.suspended) refuse("CARD_SUSPENDED");
    if (next.flag !== null) refuse("CARD_FLAGGED");
    const prior: CardSchedule | null =
      current && current.dueAt !== null && current.lastReviewedAt !== null
        ? {
            schedulerVersion: current.schedulerVersion,
            step: current.step,
            reps: current.reps,
            lapses: current.lapses,
            lastReviewedAt: current.lastReviewedAt,
            dueAt: current.dueAt,
          }
        : null;
    let scheduled: CardSchedule;
    try {
      scheduled = scheduleCard(prior, action.rating, now);
    } catch (error) {
      if (error instanceof SchedulerRefusal) {
        refuse(error.code === "CLOCK_BEHIND_LAST_REVIEW" ? "CLOCK_BEHIND_LAST_REVIEW" : "INVALID_STATE");
      }
      throw error;
    }
    Object.assign(next, {
      schedulerVersion: scheduled.schedulerVersion,
      step: scheduled.step,
      dueAt: scheduled.dueAt,
      lastReviewedAt: scheduled.lastReviewedAt,
      reps: scheduled.reps,
      lapses: scheduled.lapses,
    });
    reviewedAt = scheduled.lastReviewedAt;
    await run(
      `INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        action.operationId,
        action.itemId,
        generation,
        action.rating,
        reviewedAt,
        scheduled.schedulerVersion,
        canonicalJson(prior),
        canonicalJson(scheduled),
      ],
    );
    await run("UPDATE card_versions SET first_reviewed_at = ? WHERE id = ? AND first_reviewed_at IS NULL", [
      reviewedAt,
      version.versionId,
    ]);
  } else if (action.action === "suspend" || action.action === "resume") {
    next.suspended = action.action === "suspend";
  } else {
    next.flag = action.action === "flag" ? action.reason : null;
  }

  await run(
    `INSERT INTO card_review_state
       (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       scheduler_version = excluded.scheduler_version, step = excluded.step, due_at = excluded.due_at,
       last_reviewed_at = excluded.last_reviewed_at, reps = excluded.reps, lapses = excluded.lapses,
       suspended = excluded.suspended, flag = excluded.flag, revision = excluded.revision`,
    [
      action.itemId,
      action.materialId,
      next.schedulerVersion,
      next.step,
      next.dueAt,
      next.lastReviewedAt,
      next.reps,
      next.lapses,
      next.suspended ? 1 : 0,
      next.flag,
      next.revision,
    ],
  );

  const result: CardItemResult = {
    action: action.action,
    itemId: action.itemId,
    generation,
    revision: next.revision,
    dueAt: next.dueAt,
    reviewedAt,
    suspended: next.suspended,
    flag: next.flag,
  };
  await run(
    `INSERT INTO card_review_operations
       (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [action.operationId, action.action, action.materialId, generation, requestHash, now, canonicalJson(result)],
  );
  return result;
}

async function applyReset(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  action: Extract<CardReviewAction, { action: "reset" }>,
  generation: number,
  requestHash: string,
  now: string,
): Promise<CardResetResult> {
  const { materialId } = action;
  if ((await query("SELECT 1 AS present FROM study_materials WHERE id = ?", [materialId])).length === 0) refuse("NOT_FOUND");
  const saved = await readSavedSet(query, materialId);
  const cards = saved ? parseSavedCards(saved.flashcardsJson) : ({ status: "none" } as const);
  const keep = cards.status === "ok" ? (await cardVersion(materialId, cards.cards)).versionId : null;

  await run(
    `DELETE FROM card_review_events WHERE item_id IN (
       SELECT i.id FROM card_items i JOIN card_versions v ON v.id = i.version_id WHERE v.source_material_id = ?)`,
    [materialId],
  );
  await run("DELETE FROM card_review_state WHERE source_material_id = ?", [materialId]);
  if (keep === null) {
    await run("DELETE FROM card_versions WHERE source_material_id = ?", [materialId]);
  } else {
    await run("DELETE FROM card_versions WHERE source_material_id = ? AND id != ?", [materialId, keep]);
    await run("UPDATE card_versions SET first_reviewed_at = NULL, is_active = 1 WHERE id = ?", [keep]);
  }
  // Already tombstoned receipts are skipped, never rewritten.
  await run(
    "UPDATE card_review_operations SET is_erased = 1, result_json = NULL WHERE source_material_id = ? AND is_erased = 0",
    [materialId],
  );
  const next = generation + 1;
  await run(
    `INSERT INTO card_review_generations (source_material_id, generation) VALUES (?, ?)
     ON CONFLICT(source_material_id) DO UPDATE SET generation = excluded.generation`,
    [materialId, next],
  );
  const result: CardResetResult = { action: "reset", materialId, generation: next };
  await run(
    `INSERT INTO card_review_operations
       (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
     VALUES (?, 'reset', ?, ?, ?, ?, 0, ?)`,
    [action.operationId, materialId, generation, requestHash, now, canonicalJson(result)],
  );
  return result;
}

/** The request identity: SHA-256 of the canonical JSON of the whole typed payload. */
export function cardReviewRequestHash(action: CardReviewAction): Promise<string> {
  return sha256Hex(canonicalJson(action));
}

export async function executeCardReviewAction(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  actionInput: unknown,
  timestamp: string = new Date().toISOString(),
): Promise<CardReviewResult> {
  const action = decodeCardReviewAction(actionInput);
  const requestHash = await cardReviewRequestHash(action);
  if (!isIsoInstant(timestamp)) refuse("INVALID_STATE");

  await exec("BEGIN IMMEDIATE");
  try {
    const [receipt] = await query(
      "SELECT request_hash, is_erased, result_json FROM card_review_operations WHERE operation_id = ?",
      [action.operationId],
    );
    if (receipt) {
      if (receipt.request_hash !== requestHash) refuse("OPERATION_CONFLICT");
      if (int(receipt.is_erased) === 1) refuse("OPERATION_ERASED");
      const stored = JSON.parse(String(receipt.result_json)) as CardReviewResult;
      await exec("COMMIT");
      return stored;
    }

    const generation = await readGeneration(query, action.materialId);
    if (action.expectedGeneration !== generation) refuse("STALE_GENERATION");

    const result =
      action.action === "reset"
        ? await applyReset(run, query, action, generation, requestHash, timestamp)
        : await applyItem(run, query, action, generation, requestHash, timestamp);
    if(action.action==="rate" && action.homework) await recordHomeworkCardRating(run,query,action,timestamp);
    if(action.action==="reset") await invalidateHomeworkCardRuns(run,query,action.materialId,timestamp);
    await exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // Rollback is best effort; the caller restores durable bytes.
    }
    if (error instanceof CardReviewError) throw error;
    throw new CardReviewError("STORAGE_ERROR", { cause: error });
  }
}
