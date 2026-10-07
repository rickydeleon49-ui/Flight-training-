// Pure in-memory model of the proposed card-review contract boundary.
//
// SIMULATION ONLY: it shows the intended identity, replay, conflict,
// revision, suspension and erasure semantics. It is not SQLite, not the
// native pinned connection and not the browser transaction owner, so it
// proves nothing about atomic persistence or installed behavior.
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

/** A minimal store holding projections, immutable events and receipts. */
export function createStore() {
  return { state: new Map(), events: [], receipts: new Map() };
}

/**
 * Apply one rate/suspend/resume operation. Same operation ID + identical
 * payload returns the stored result without a second event; the same ID with
 * a different payload conflicts; an erased receipt refuses replay; a stale
 * expected revision refuses without writing.
 */
export function apply(store, operation, nowIso) {
  const requestHash = sha256(canonicalJson(operation));
  const receipt = store.receipts.get(operation.operationId);
  if (receipt) {
    if (receipt.requestHash !== requestHash) throw new ContractRefusal("OPERATION_CONFLICT");
    if (receipt.erased) throw new ContractRefusal("OPERATION_ERASED");
    return receipt.result;
  }
  const current = store.state.get(operation.itemId) ?? null;
  const revision = current?.revision ?? 0;
  if (operation.expectedRevision !== revision) throw new ContractRefusal("STALE_REVISION");

  let next;
  if (operation.action === "rate") {
    if (current?.suspended) throw new ContractRefusal("CARD_SUSPENDED");
    let scheduled;
    try {
      scheduled = schedule(current?.schedule ?? null, operation.rating, nowIso);
    } catch (error) {
      if (error instanceof SchedulerRefusal) throw new ContractRefusal(error.code);
      throw error;
    }
    next = { schedule: scheduled, suspended: false, revision: revision + 1 };
    store.events.push({ eventId: operation.operationId, itemId: operation.itemId, rating: operation.rating, reviewedAt: nowIso });
  } else if (operation.action === "suspend" || operation.action === "resume") {
    next = { schedule: current?.schedule ?? null, suspended: operation.action === "suspend", revision: revision + 1 };
  } else {
    throw new ContractRefusal("INVALID_ARGUMENT");
  }
  // Event, projection and receipt change together or not at all.
  store.state.set(operation.itemId, next);
  const result = { itemId: operation.itemId, revision: next.revision, suspended: next.suspended, dueAt: next.schedule?.dueAt ?? null };
  store.receipts.set(operation.operationId, { requestHash, result, erased: false });
  return result;
}

/** Explicit erasure: remove projections/events, keep non-content tombstones. */
export function erase(store, itemIds) {
  for (const itemId of itemIds) store.state.delete(itemId);
  store.events = store.events.filter((event) => !itemIds.includes(event.itemId));
  for (const receipt of store.receipts.values()) {
    if (itemIds.includes(receipt.result.itemId)) {
      receipt.erased = true;
      receipt.result = null;
    }
  }
}

/** Suspended cards leave due work; their history stays. */
export function dueItems(store, isDueFn) {
  return [...store.state.entries()]
    .filter(([, value]) => !value.suspended && value.schedule && isDueFn(value.schedule))
    .map(([itemId]) => itemId);
}
