// Pure in-memory model of the proposed card-review contract boundary.
//
// SIMULATION ONLY: it shows the intended identity, replay, conflict,
// generation, revision, suspension and reset semantics. It is not SQLite, not
// the native pinned connection and not the browser transaction owner, so it
// proves nothing about atomic persistence or installed behavior.
//
// Corrected 6 October 2026 (CRS-R2): a persistent per-material review
// generation is the barrier across resets; receipts keep non-content routing
// metadata separately from nullable result content; reset is its own typed
// action. The pre-correction bytes are preserved under
// docs/evidence/m2-card-review-scope-corrections-2026-10-06/frozen-pre-correction/.
import { createHash } from "node:crypto";

import { SchedulerRefusal, schedule } from "./simpleScheduler.mjs";

/** Sorted-key JSON, matching the canonical form the app already hashes. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Content-addressed identity. The version is the material plus the canonical
 * hash of its ordered cards; an item is its version plus ordinal. Different
 * text can never share a version, so old reviews cannot attach to new text;
 * identical text (including A -> B -> A regeneration) maps back to the same
 * version and its history.
 */
export function cardVersion(materialId, flashcards) {
  const cards = flashcards.map(({ front, back, sourcePage }) => ({ front, back, sourcePage }));
  const contentHash = sha256(canonicalJson(cards));
  const versionId = sha256(`${materialId}\u0000${contentHash}`);
  return {
    versionId,
    contentHash,
    items: cards.map((card, ordinal) => ({ itemId: sha256(`${versionId}\u0000${ordinal}`), ordinal, ...card })),
  };
}

export class ContractRefusal extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const ITEM_ACTIONS = ["rate", "suspend", "resume", "flag", "unflag"];
const ITEM_KEYS = ["action", "operationId", "materialId", "versionContentHash", "itemId", "expectedGeneration", "expectedRevision"];
const EXTRA_KEYS = { rate: ["rating"], flag: ["reason"] };
const RESET_KEYS = ["action", "operationId", "materialId", "expectedGeneration"];
const FLAG_REASONS = ["wrong_answer", "unclear", "not_in_source"];

/** Exact-key validation per typed branch; reset carries no item fields. */
function validate(operation) {
  const keys = Object.keys(operation ?? {}).sort();
  const expected =
    operation?.action === "reset"
      ? RESET_KEYS
      : ITEM_ACTIONS.includes(operation?.action)
        ? [...ITEM_KEYS, ...(EXTRA_KEYS[operation.action] ?? [])]
        : null;
  if (!expected || keys.join() !== [...expected].sort().join()) throw new ContractRefusal("INVALID_ARGUMENT");
  if (!Number.isInteger(operation.expectedGeneration) || operation.expectedGeneration < 0) throw new ContractRefusal("INVALID_ARGUMENT");
  if (operation.action !== "reset" && (!Number.isInteger(operation.expectedRevision) || operation.expectedRevision < 0)) {
    throw new ContractRefusal("INVALID_ARGUMENT");
  }
  if (operation.action === "flag" && !FLAG_REASONS.includes(operation.reason)) throw new ContractRefusal("INVALID_ARGUMENT");
}

/**
 * A store holding the saved raw cards per material (the `ai_study_sets`
 * stand-in), generations, frozen snapshots, projections, immutable rating
 * events and receipts.
 */
export function createStore(rawCards = {}) {
  return {
    rawCards: new Map(Object.entries(rawCards)),
    generations: new Map(),
    versions: new Map(), // versionId -> { materialId, contentHash, itemIds, createdAt, firstReviewedAt }
    state: new Map(), // itemId -> { materialId, schedule|null, suspended, flag, revision }
    events: [],
    receipts: new Map(), // operationId -> { requestHash, action, materialId, generation, erased, result|null }
  };
}

/** Read representation of a material's generation, even before any rating. */
export const generationOf = (store, materialId) => store.generations.get(materialId) ?? 0;

/** Read the current item state the UI would show (revision 0 when untouched). */
export function readItem(store, itemId) {
  const state = store.state.get(itemId);
  return { revision: state?.revision ?? 0, suspended: state?.suspended ?? false, flag: state?.flag ?? null, schedule: state?.schedule ?? null };
}

export const counts = (store) => ({ states: store.state.size, events: store.events.length, receipts: store.receipts.size });

function materialize(store, materialId, version, nowIso) {
  if (store.versions.has(version.versionId)) return;
  store.versions.set(version.versionId, {
    materialId,
    contentHash: version.contentHash,
    itemIds: version.items.map((item) => item.itemId),
    createdAt: nowIso, // snapshot creation, by any first item action
    firstReviewedAt: null, // set only by the first rating
  });
}

/**
 * Apply one typed operation, all-or-nothing:
 *   1. exact-key validation of its branch
 *   2. same-ID replay first: different hash -> OPERATION_CONFLICT; tombstone ->
 *      OPERATION_ERASED; identical -> the stored result, nothing changes
 *   3. generation barrier: expectedGeneration must equal the current one
 *   4. reset branch, or item branch (content, item, revision, action)
 */
export function apply(store, operation, nowIso) {
  validate(operation);
  const requestHash = sha256(canonicalJson(operation));
  const receipt = store.receipts.get(operation.operationId);
  if (receipt) {
    if (receipt.requestHash !== requestHash) throw new ContractRefusal("OPERATION_CONFLICT");
    if (receipt.erased) throw new ContractRefusal("OPERATION_ERASED");
    return receipt.result;
  }
  const { materialId } = operation;
  const generation = generationOf(store, materialId);
  if (operation.expectedGeneration !== generation) throw new ContractRefusal("STALE_GENERATION");

  return operation.action === "reset"
    ? applyReset(store, operation, requestHash, generation)
    : applyItem(store, operation, requestHash, generation, nowIso);
}

function applyReset(store, operation, requestHash, generation) {
  const { materialId } = operation;
  const raw = store.rawCards.get(materialId);
  const keepVersion = raw ? cardVersion(materialId, raw).versionId : null;
  const next = generation + 1;
  // Projections and events for this material go.
  for (const [itemId, value] of [...store.state]) if (value.materialId === materialId) store.state.delete(itemId);
  for (const [versionId, version] of [...store.versions]) {
    if (version.materialId !== materialId) continue;
    if (versionId === keepVersion) {
      version.firstReviewedAt = null; // current cards stay; their review history does not
    } else {
      store.versions.delete(versionId); // prune snapshots not in the current raw set
    }
  }
  store.events = store.events.filter((event) => event.materialId !== materialId);
  // Tombstone this material's receipts by routing metadata; already
  // tombstoned receipts (result null) are skipped, never dereferenced.
  for (const value of store.receipts.values()) {
    if (value.materialId === materialId && !value.erased) {
      value.erased = true;
      value.result = null;
    }
  }
  store.generations.set(materialId, next);
  const result = { action: "reset", materialId, generation: next };
  store.receipts.set(operation.operationId, { requestHash, action: "reset", materialId, generation, erased: false, result });
  return result;
}

function applyItem(store, operation, requestHash, generation, nowIso) {
  const { materialId, itemId } = operation;
  const raw = store.rawCards.get(materialId);
  if (!raw) throw new ContractRefusal("NOT_FOUND");
  const version = cardVersion(materialId, raw);
  if (version.contentHash !== operation.versionContentHash) throw new ContractRefusal("STALE_CONTENT");
  if (!version.items.some((item) => item.itemId === itemId)) throw new ContractRefusal("NOT_FOUND");
  const current = store.state.get(itemId) ?? null;
  const revision = current?.revision ?? 0;
  if (operation.expectedRevision !== revision) throw new ContractRefusal("STALE_REVISION");

  let next;
  let event = null;
  const base = { materialId, schedule: current?.schedule ?? null, suspended: current?.suspended ?? false, flag: current?.flag ?? null };
  if (operation.action === "rate") {
    if (base.suspended) throw new ContractRefusal("CARD_SUSPENDED");
    if (base.flag) throw new ContractRefusal("CARD_FLAGGED");
    let scheduled;
    try {
      scheduled = schedule(base.schedule, operation.rating, nowIso);
    } catch (error) {
      if (error instanceof SchedulerRefusal) throw new ContractRefusal(error.code);
      throw error;
    }
    next = { ...base, schedule: scheduled };
    event = { eventId: operation.operationId, materialId, itemId, rating: operation.rating, reviewedAt: scheduled.lastReviewedAt };
  } else if (operation.action === "suspend" || operation.action === "resume") {
    next = { ...base, suspended: operation.action === "suspend" };
  } else {
    next = { ...base, flag: operation.action === "flag" ? operation.reason : null };
  }
  // Snapshot, projection, event and receipt change together or not at all.
  materialize(store, materialId, version, nowIso);
  if (event) {
    store.events.push(event);
    const snapshot = store.versions.get(version.versionId);
    snapshot.firstReviewedAt ??= event.reviewedAt;
  }
  next.revision = revision + 1;
  store.state.set(itemId, next);
  const result = {
    action: operation.action,
    itemId,
    generation,
    revision: next.revision,
    suspended: next.suspended,
    flag: next.flag,
    dueAt: next.schedule?.dueAt ?? null,
    reviewedAt: event?.reviewedAt ?? null,
  };
  store.receipts.set(operation.operationId, { requestHash, action: operation.action, materialId, generation, erased: false, result });
  return result;
}

/** Model-level due list for the current version only (the SQLite query is the authority). */
export function dueItems(store, materialId, isDueFn) {
  const raw = store.rawCards.get(materialId);
  if (!raw) return [];
  const currentIds = new Set(cardVersion(materialId, raw).items.map((item) => item.itemId));
  return [...store.state.entries()]
    .filter(([itemId, value]) => currentIds.has(itemId) && !value.suspended && !value.flag && value.schedule && isDueFn(value.schedule))
    .map(([itemId]) => itemId);
}
