/**
 * OFFLINE-03a authoring core. This module prepares immutable local data; it
 * never writes a database, changes review identities, or calls a provider.
 * Persistence/UI must integrate it with the approved atomic history contract.
 */
import { newId } from "@/lib/id";
import { sha256Hex } from "./cardIdentity";
import { LIMITS } from "./studyPacket/limits";

export const MAX_RETIRED_ITEMS = 2000;
export const MAX_RETIREMENT_TERMS = 64;
export const NEAR_MATCH_THRESHOLD = 0.6;
export type ItemOrigin = "user" | "instructor";
export type AuthoringProvider = "gemini" | "import" | "manual";
export type ItemKind = "summary" | "section" | "card";

/** Fields have the same order as saved-search digests: summary; heading/body; front/back. */
export interface StudyItem {
  readonly kind: ItemKind;
  readonly itemId: string;
  readonly fields: readonly string[];
  readonly origin?: ItemOrigin;
  readonly replaces?: string;
  readonly sourcePage?: number | null;
}
export type DraftItem = Omit<StudyItem, "itemId"> & { readonly itemId?: string };
export interface RetiredItem {
  readonly kind: ItemKind;
  readonly itemId: string;
  readonly reason: "deleted" | "corrected";
  readonly textKey: string;
  readonly terms: readonly string[];
}
export interface PreviewItem {
  readonly item: StudyItem;
  readonly status: "new" | "held" | "unresolved";
  /** The strongest related retired item; never copies all matching original text. */
  readonly match: RetiredItem | null;
}
export type PreviewChoice = "keep" | "omit";
export class StudyAuthoringError extends Error {
  constructor(readonly code: "invalid_content" | "retirement_limit" | "unresolved_match" | "invalid_choice" | "item_missing") {
    super({
      invalid_content: "This study content could not be prepared. Nothing has been saved.",
      retirement_limit: "This study set has reached its deletion and correction history limit. Your changes haven't been saved.",
      unresolved_match: "Choose whether to keep or leave out each similar item before saving.",
      invalid_choice: "These choices no longer match this preview. Review the items again.",
      item_missing: "That item is no longer in this study set. Review your changes before saving.",
    }[code]);
    this.name = "StudyAuthoringError";
  }
}
const invalid = (): never => { throw new StudyAuthoringError("invalid_content"); };
const kinds: readonly string[] = ["summary", "section", "card"];
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}
function origin(value: unknown): boolean {
  return value === undefined || value === "user" || value === "instructor";
}
function validItem(item: StudyItem): void {
  if (!item || !kinds.includes(item.kind) || !identifier(item.itemId) || !origin(item.origin) || !Array.isArray(item.fields)) invalid();
  if ((item.kind === "summary") !== (item.itemId === "summary")) invalid();
  if (item.replaces !== undefined && (!identifier(item.replaces) || item.origin === undefined)) invalid();
  if (item.sourcePage !== undefined && (item.kind !== "card" || (item.sourcePage !== null && (!Number.isInteger(item.sourcePage) || item.sourcePage < LIMITS.pageMin || item.sourcePage > LIMITS.pageMax)))) invalid();
  const caps = item.kind === "summary" ? [LIMITS.summary] : item.kind === "section" ? [LIMITS.heading, LIMITS.body] : [LIMITS.front, LIMITS.back];
  if (item.fields.length !== caps.length) invalid();
  item.fields.forEach((field, i) => {
    if (typeof field !== "string" || loneSurrogate.test(field) || Array.from(field).length > caps[i]!) invalid();
    if (item.kind !== "summary" && !field.trim()) invalid();
  });
}
function cloneItem(item: StudyItem): StudyItem {
  validItem(item);
  return Object.freeze({ kind: item.kind, itemId: item.itemId, fields: Object.freeze([...item.fields]), ...(item.origin ? { origin: item.origin } : {}), ...(item.replaces !== undefined ? { replaces: item.replaces } : {}), ...(item.sourcePage !== undefined ? { sourcePage: item.sourcePage } : {}) });
}
function validateItems(items: readonly StudyItem[]): void {
  if (!Array.isArray(items) || items.length > 1 + LIMITS.sections + LIMITS.flashcards) invalid();
  const ids = new Set<string>();
  const counts = { summary: 0, section: 0, card: 0 };
  for (const item of items) {
    validItem(item);
    if (ids.has(item.itemId)) invalid();
    ids.add(item.itemId); counts[item.kind]++;
  }
  if (counts.summary > 1 || counts.section > LIMITS.sections || counts.card > LIMITS.flashcards) invalid();
}

/** Allocate IDs only on the authoring path, never while merely reading old content. */
export function assignItemIds(items: readonly DraftItem[], makeId: () => string = newId): readonly StudyItem[] {
  // Validate shape/count before requesting secure randomness or allocating a result.
  if (!Array.isArray(items) || items.length > 1 + LIMITS.sections + LIMITS.flashcards) invalid();
  for (const item of items) {
    if (!item || typeof item !== "object") invalid();
    validItem({ ...item, itemId: item.itemId ?? (item.kind === "summary" ? "summary" : "pending-id") });
  }
  if (items.filter((i) => i.kind === "summary").length > 1 || items.filter((i) => i.kind === "section").length > LIMITS.sections || items.filter((i) => i.kind === "card").length > LIMITS.flashcards) invalid();
  const result = items.map((item) => cloneItem({ ...item, itemId: item.itemId ?? (item.kind === "summary" ? "summary" : makeId()) }));
  validateItems(result);
  return Object.freeze(result);
}

/** NFKC + locale-independent lowercasing + collapsed Unicode whitespace. */
export const normalizedStudyText = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
function scalarCompare(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (delta) return delta;
  }
  return left.length - right.length;
}
/** First 64 distinct normalized words in Unicode-scalar order, never locale order. */
export function retirementTerms(fields: readonly string[]): readonly string[] {
  const text = fields.map(normalizedStudyText).join(" ");
  const words = [...new Set(text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])].sort(scalarCompare);
  return Object.freeze(words.slice(0, MAX_RETIREMENT_TERMS));
}
/** JSON framing keeps separate fields distinct, including embedded NULs/newlines. */
export async function retirementTextKey(item: StudyItem): Promise<string> {
  validItem(item);
  return sha256Hex(JSON.stringify(item.fields.map(normalizedStudyText)));
}
function freezeRetired(item: RetiredItem): RetiredItem {
  if (!item || !kinds.includes(item.kind) || !identifier(item.itemId) || !["deleted", "corrected"].includes(item.reason) || !/^[a-f0-9]{64}$/.test(item.textKey) || !Array.isArray(item.terms) || item.terms.length > MAX_RETIREMENT_TERMS) invalid();
  if ((item.kind === "summary") !== (item.itemId === "summary")) invalid();
  let previous: string | undefined;
  for (const word of item.terms) {
    if (typeof word !== "string" || !word || Array.from(word).length > LIMITS.body || loneSurrogate.test(word) || normalizedStudyText(word) !== word || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M}]*$/u.test(word)) invalid();
    if (previous !== undefined && scalarCompare(previous, word) >= 0) invalid();
    previous = word;
  }
  return Object.freeze({ kind: item.kind, itemId: item.itemId, reason: item.reason, textKey: item.textKey, terms: Object.freeze([...item.terms]) });
}
export async function retireItem(item: StudyItem, reason: RetiredItem["reason"]): Promise<RetiredItem> {
  const stable = cloneItem(item);
  return freezeRetired({ kind: stable.kind, itemId: stable.itemId, reason, textKey: await retirementTextKey(stable), terms: retirementTerms(stable.fields) });
}
const recordKey = (item: RetiredItem) => JSON.stringify([item.kind, item.itemId, item.reason, item.textKey]);

/** No eviction: deduplicate exact records, then accept all or refuse all. */
export function appendRetirements(existing: readonly RetiredItem[], incoming: readonly RetiredItem[]): readonly RetiredItem[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming) || existing.length > MAX_RETIRED_ITEMS || incoming.length > MAX_RETIRED_ITEMS) throw new StudyAuthoringError("retirement_limit");
  const records = new Map<string, RetiredItem>();
  for (const item of [...existing, ...incoming]) {
    const copy = freezeRetired(item), key = recordKey(copy), prior = records.get(key);
    if (prior && JSON.stringify(prior.terms) !== JSON.stringify(copy.terms)) invalid();
    records.set(key, copy);
    if (records.size > MAX_RETIRED_ITEMS) throw new StudyAuthoringError("retirement_limit");
  }
  return Object.freeze([...records.values()]);
}
function jaccard(left: readonly string[], right: ReadonlySet<string>): number {
  // Empty word sets must not classify unrelated punctuation as a near match.
  if (!left.length || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.length + right.size - shared);
}

/**
 * Classify bounded, fresh generated/imported candidates. Matching uses the
 * same capped term representation on each side. Only the strongest match is
 * returned per candidate, so a common word cannot create a huge response.
 * This is approximate duplicate detection, never a semantic correctness test.
 */
export async function previewRegeneration(candidates: readonly StudyItem[], retired: readonly RetiredItem[]): Promise<readonly PreviewItem[]> {
  validateItems(candidates);
  const stable = candidates.map(cloneItem);
  const ledger = appendRetirements(retired, []).map((entry) => ({ entry, words: new Set(entry.terms) })).sort((a, b) => scalarCompare(recordKey(a.entry), recordKey(b.entry)));
  const result: PreviewItem[] = [];
  for (const item of stable) {
    const key = await retirementTextKey(item), words = retirementTerms(item.fields);
    let exact: RetiredItem | null = null, best: RetiredItem | null = null, score = NEAR_MATCH_THRESHOLD;
    for (const { entry, words: oldWords } of ledger) {
      if (entry.kind !== item.kind) continue;
      if (entry.textKey === key) { exact = entry; break; }
      const similarity = jaccard(words, oldWords);
      if (similarity >= score && (best === null || similarity > score)) { best = entry; score = similarity; }
    }
    result.push(Object.freeze({ item, status: exact ? "held" : best ? "unresolved" : "new", match: exact ?? best }));
  }
  return Object.freeze(result);
}

/** Resolve a specific immutable preview; does not save or modify current content. */
export function resolveRegeneration(preview: readonly PreviewItem[], choices: ReadonlyMap<string, PreviewChoice>): readonly StudyItem[] {
  validateItems(preview.map((entry) => entry.item));
  const ids = new Set(preview.map((entry) => entry.item.itemId));
  for (const [id, choice] of choices) {
    if (!ids.has(id) || (choice !== "keep" && choice !== "omit")) throw new StudyAuthoringError("invalid_choice");
  }
  const result: StudyItem[] = [];
  for (const entry of preview) {
    if (!["new", "held", "unresolved"].includes(entry.status)) invalid();
    const choice = choices.get(entry.item.itemId);
    if (entry.status === "unresolved" && choice === undefined) throw new StudyAuthoringError("unresolved_match");
    if (choice === "keep" || (choice === undefined && entry.status === "new")) result.push(cloneItem(entry.item));
  }
  return Object.freeze(result);
}

/** Never let a manual/instructor item fall through to Gemini wording. */
export function itemOriginLabel(item: Pick<StudyItem, "origin">, provider: AuthoringProvider): string {
  if (!origin(item.origin) || !["gemini", "import", "manual"].includes(provider)) invalid();
  if (item.origin === "instructor") return "Instructor correction";
  if (item.origin === "user" || provider === "manual") return "User-created";
  return provider === "import" ? "Imported study packet" : "Gemini";
}
/** Selection policy only; packet-v1 serialization still needs its explicit label-loss warning. */
export function selectExportItems(items: readonly StudyItem[], includeInstructorCorrections = false): readonly StudyItem[] {
  validateItems(items);
  return Object.freeze(items.filter((item) => includeInstructorCorrections || item.origin !== "instructor").map(cloneItem));
}

export interface AuthoringState {
  readonly items: readonly StudyItem[];
  readonly retired: readonly RetiredItem[];
}
export type StudyEdit =
  | { readonly kind: "add"; readonly item: Omit<DraftItem, "origin" | "replaces">; readonly origin: ItemOrigin }
  | { readonly kind: "edit" | "correct"; readonly itemId: string; readonly fields: readonly string[]; readonly origin: ItemOrigin }
  | { readonly kind: "delete"; readonly itemId: string };
export interface PreparedStudyEdit {
  readonly previous: AuthoringState;
  readonly next: AuthoringState;
  readonly reason: "edit" | "correct" | "delete";
}
function stateCopy(state: AuthoringState): AuthoringState {
  validateItems(state.items);
  return Object.freeze({ items: Object.freeze(state.items.map(cloneItem)), retired: appendRetirements(state.retired, []) });
}

/**
 * A complete local edit plan, retaining both logical states. Atomic storage
 * must still check the current revision and persist the FULL prior set's
 * metadata/text with this change. This plan itself never writes history.
 */
export async function prepareStudyEdit(current: AuthoringState, edit: StudyEdit, makeId: () => string = newId): Promise<PreparedStudyEdit> {
  const previous = stateCopy(current);
  const action = edit.kind;
  let items = [...previous.items];
  let retirement: RetiredItem | null = null;
  if (action === "add") {
    if (edit.origin !== "user" && edit.origin !== "instructor") invalid();
    const item = assignItemIds([{ ...edit.item, origin: edit.origin }], makeId)[0]!;
    items.push(item);
  } else if (action === "edit" || action === "correct" || action === "delete") {
    const at = items.findIndex((item) => item.itemId === edit.itemId);
    if (at === -1) throw new StudyAuthoringError("item_missing");
    const original = items[at]!;
    if (action === "delete") {
      items.splice(at, 1);
      retirement = await retireItem(original, "deleted");
    } else {
      if (edit.origin !== "user" && edit.origin !== "instructor") invalid();
      const replacing = action === "correct";
      const nextId = replacing && original.kind !== "summary" ? makeId() : original.itemId;
      if (replacing && original.kind !== "summary" && nextId === original.itemId) invalid();
      items[at] = cloneItem({ ...original, fields: [...edit.fields], origin: edit.origin,
        ...(replacing ? { itemId: nextId, replaces: original.itemId } : {}) });
      validateItems(items);
      // An ordinary rewrite also retires the prior wording; regeneration
      // must not quietly bring it back next to her edited version.
      if (JSON.stringify(original.fields) !== JSON.stringify(items[at]!.fields) || replacing) retirement = await retireItem(original, "corrected");
    }
  } else invalid();
  validateItems(items);
  const next = Object.freeze({ items: Object.freeze(items), retired: appendRetirements(previous.retired, retirement ? [retirement] : []) });
  return Object.freeze({ previous, next, reason: action === "add" ? "edit" : action });
}
