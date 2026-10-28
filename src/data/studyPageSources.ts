/** Private page provenance. Never embedded in a card or an export payload. */
import { canonicalJson, sha256Hex } from "@/logic/cardIdentity";
import type { NavigationBookmark, PracticeAuthoringQuestion } from "@/domain/types";
import type { StoredCard, NextStudySet } from "./studySetTransaction";
import type { SqlValue } from "./db";
export interface PageSource {
  id: string; materialId: string | null; materialTitle: string;
  contentSha256: string | null; physicalPage: number; printedLabel: string | null;
}
export interface BookmarkCardSource {
  source: PageSource; bookmark: NavigationBookmark;
  preview: { contentSha256: string; totalPages: number } | null;
  itemId: string;
}
type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];
type Run = (sql: string, params: SqlValue[]) => Promise<void> | void;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex = /^[0-9a-f]{64}$/;
export const cardSourceFingerprint = (c: Pick<StoredCard, "front" | "back" | "sourcePage" | "origin">) => sha256Hex(canonicalJson([c.front, c.back, c.sourcePage, c.origin ?? null]));
/** A question made from a page note carries the same snapshot; its item is the question's identity. */
export type BookmarkQuestionSource = BookmarkCardSource;
type QuestionContent = Pick<PracticeAuthoringQuestion, "question" | "options" | "correctIndex" | "explanation" | "sourcePage" | "origin">;
export const questionSourceFingerprint = (q: QuestionContent) =>
  sha256Hex(canonicalJson([q.question, q.options, q.correctIndex, q.explanation, q.sourcePage, q.origin ?? null]));
export function decodeBookmarkCardSource(value: unknown, materialId: string, next: NextStudySet): BookmarkCardSource {
  return decodeBookmarkSource(value, materialId, (itemId) => next.flashcards.some((c) => c.itemId === itemId));
}
export function decodeBookmarkSource(value: unknown, materialId: string, hasItem: (itemId: string) => boolean): BookmarkCardSource {
  const s = value as BookmarkCardSource;
  const exact = (v: object, keys: string[]) => v && Object.keys(v).sort().join() === keys.sort().join();
  if (!s || !exact(s, ["source", "bookmark", "preview", "itemId"]) || !s.source || !s.bookmark) throw Error("INVALID_ARGUMENT");
  const p = s.source, b = s.bookmark;
  if (!exact(p, ["id", "materialId", "materialTitle", "contentSha256", "physicalPage", "printedLabel"]) || !exact(b, ["id", "materialId", "physicalPage", "pageLabel", "originatingContentSha256", "title", "notes", "status", "createdAt", "updatedAt"]) ||
    !uuid.test(p.id) || p.materialId !== materialId || typeof p.materialTitle !== "string" || !p.materialTitle.trim() || Array.from(p.materialTitle).length > 500 ||
    (p.contentSha256 !== null && (typeof p.contentSha256 !== "string" || !hex.test(p.contentSha256))) || !Number.isInteger(p.physicalPage) || p.physicalPage < 1 ||
    (p.printedLabel !== null && (typeof p.printedLabel !== "string" || Array.from(p.printedLabel).length > 100)) ||
    b.materialId !== materialId || !uuid.test(b.id) || b.physicalPage !== p.physicalPage || b.pageLabel !== p.printedLabel || b.originatingContentSha256 !== p.contentSha256 ||
    typeof b.createdAt !== "string" || !["verified","unverified","drifted"].includes(b.status) || typeof b.title !== "string" || Array.from(b.title).length > 500 || typeof b.notes !== "string" || Array.from(b.notes).length > 20000 || typeof b.updatedAt !== "string" ||
    (s.preview !== null && (!exact(s.preview, ["contentSha256", "totalPages"]) || !hex.test(s.preview.contentSha256) || !Number.isInteger(s.preview.totalPages) || s.preview.totalPages < 0)) ||
    typeof s.itemId !== "string" || !hasItem(s.itemId)) throw Error("INVALID_ARGUMENT");
  return s;
}
/** Refuses unless the page note and its material are exactly as she saw them. */
async function checkBookmark(query: Query, s: BookmarkCardSource) {
  const p = s.source, b = s.bookmark;
  const [row] = await query("SELECT * FROM material_bookmarks WHERE id = ? AND material_id = ?", [b.id, p.materialId]);
  const [material] = await query("SELECT title FROM study_materials WHERE id = ?", [p.materialId]);
  if (!row || material?.title !== p.materialTitle || row.title !== b.title || row.notes !== b.notes || row.updated_at !== b.updatedAt || row.created_at !== b.createdAt || row.page_index !== p.physicalPage || row.page_label !== p.printedLabel || row.originating_content_sha256 !== p.contentSha256) throw Error("SOURCE_CHANGED");
}
export async function writeBookmarkCardSource(run: Run, query: Query, s: BookmarkCardSource, next: NextStudySet, now: string) {
  const p = s.source, b = s.bookmark;
  await checkBookmark(query, s);
  await run("INSERT INTO study_page_sources (id,source_material_id,material_title,content_sha256,physical_page,printed_label,bookmark_id,created_at) VALUES (?,?,?,?,?,?,?,?)", [p.id,p.materialId,p.materialTitle,p.contentSha256,p.physicalPage,p.printedLabel,b.id,now]);
  const c = next.flashcards.find(c => c.itemId === s.itemId)!;
  // A different page deliberately detaches the trusted reference.
  if (c.sourcePage === p.physicalPage) await run("INSERT INTO study_page_source_bindings VALUES (?,?,?,?,?)", [p.id,p.materialId,"authored_card",s.itemId,await cardSourceFingerprint(c)]);
  else await run("DELETE FROM study_page_sources WHERE id = ?", [p.id]);
}
export async function carryCardSources(run: Run, query: Query, materialId: string, before: StoredCard[], after: StoredCard[]) {
  if (!(await query("SELECT 1 FROM sqlite_master WHERE name = 'study_page_sources'", [])).length) return;
  for (const c of after) {
    const old = before.find(x => x.itemId && (x.itemId === c.itemId || x.itemId === c.replaces));
    if (!old || !c.itemId || old.sourcePage !== c.sourcePage) continue;
    await run(`INSERT OR IGNORE INTO study_page_source_bindings SELECT source_id,owner_key,binding_kind,?,? FROM study_page_source_bindings WHERE owner_key=? AND binding_kind='authored_card' AND item_key=? AND content_fingerprint=?`, [c.itemId,await cardSourceFingerprint(c),materialId,old.itemId!,await cardSourceFingerprint(old)]);
  }
}
export function mergeCardPageSources(a?: PageSource, b?: PageSource): PageSource | undefined {
  if (!a) return b;
  if (!b) return a;
  const same = a.materialId === b.materialId && a.materialTitle === b.materialTitle && a.contentSha256 === b.contentSha256 && a.physicalPage === b.physicalPage && a.printedLabel === b.printedLabel;
  return same ? a : {...a, contentSha256: null};
}
export async function readCardPageSource(query: Query, owner: string, kind: string, key: string, card: StoredCard): Promise<PageSource | undefined> {
  return readPageSource(query, owner, kind, key, await cardSourceFingerprint(card));
}
async function readPageSource(query: Query, owner: string, kind: string, key: string, fingerprint: string): Promise<PageSource | undefined> {
  if (!(await query("SELECT 1 FROM sqlite_master WHERE name = 'study_page_sources'", [])).length) return;
  const rows = await query(`SELECT DISTINCT s.* FROM study_page_sources s JOIN study_page_source_bindings b ON b.source_id=s.id WHERE b.owner_key=? AND b.binding_kind=? AND b.item_key=? AND b.content_fingerprint=?`, [owner,kind,key,fingerprint]);
  if (!rows.length) return;
  const r = rows[0]!;
  const ambiguous = rows.some(x => x.material_title !== r.material_title || x.source_material_id !== r.source_material_id || x.content_sha256 !== r.content_sha256 || x.physical_page !== r.physical_page || x.printed_label !== r.printed_label);
  return { id:String(r.id), materialId:r.source_material_id as string|null, materialTitle:String(r.material_title), contentSha256:ambiguous ? null : r.content_sha256 as string|null, physicalPage:Number(r.physical_page), printedLabel:r.printed_label as string|null };
}
export async function freezeCardSources(run: Run, query: Query, owner: string, items: {itemId:string}[], cards: StoredCard[]) {
  if (!(await query("SELECT 1 FROM sqlite_master WHERE name = 'study_page_sources'", [])).length) return;
  for (let i=0;i<cards.length;i++) {
    const c=cards[i]!;
    if (!c.itemId) continue;
    await run(`INSERT OR IGNORE INTO study_page_source_bindings SELECT source_id,owner_key,'frozen_card',?,content_fingerprint FROM study_page_source_bindings WHERE owner_key=? AND binding_kind='authored_card' AND item_key=? AND content_fingerprint=?`, [items[i]!.itemId,owner,c.itemId,await cardSourceFingerprint(c)]);
  }
}

const hasPageSources = async (query: Query) =>
  (await query("SELECT 1 FROM sqlite_master WHERE name = 'study_page_sources'", [])).length > 0;

/**
 * Saves the page source of a question made from a page note, in the same
 * transaction as the question. A different page detaches the reference.
 */
export async function writeBookmarkQuestionSource(run: Run, query: Query, s: BookmarkQuestionSource, question: QuestionContent, now: string) {
  await checkBookmark(query, s);
  const p = s.source;
  if (question.sourcePage !== p.physicalPage) return;
  await run(
    "INSERT INTO study_page_sources (id,source_material_id,material_title,content_sha256,physical_page,printed_label,bookmark_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [p.id, p.materialId, p.materialTitle, p.contentSha256, p.physicalPage, p.printedLabel, s.bookmark.id, now],
  );
  await run(
    "INSERT INTO study_page_source_bindings VALUES (?,?,?,?,?)",
    [p.id, p.materialId, "authored_question", s.itemId, await questionSourceFingerprint(question)],
  );
}

/**
 * After a practice save: an edit or correction that keeps a question's page
 * keeps its source, and every saved item row gets a frozen copy so attempts
 * on that version keep showing it after later edits.
 */
export async function carryQuestionSources(
  run: Run,
  query: Query,
  materialId: string,
  carry: boolean,
  before: readonly PracticeAuthoringQuestion[],
  after: readonly PracticeAuthoringQuestion[],
  itemIds: readonly string[],
) {
  if (!(await hasPageSources(query))) return;
  for (const [index, question] of after.entries()) {
    const fingerprint = await questionSourceFingerprint(question);
    const old = carry ? before.find((q) => q.identity === question.identity || q.identity === question.replaces) : undefined;
    if (old && old.sourcePage === question.sourcePage) {
      await run(
        `INSERT OR IGNORE INTO study_page_source_bindings
           SELECT source_id, owner_key, binding_kind, ?, ? FROM study_page_source_bindings
            WHERE owner_key = ? AND binding_kind = 'authored_question' AND item_key = ? AND content_fingerprint = ?`,
        [question.identity, fingerprint, materialId, old.identity, await questionSourceFingerprint(old)],
      );
    }
    await run(
      `INSERT OR IGNORE INTO study_page_source_bindings
         SELECT source_id, owner_key, 'frozen_question', ?, content_fingerprint FROM study_page_source_bindings
          WHERE owner_key = ? AND binding_kind = 'authored_question' AND item_key = ? AND content_fingerprint = ?`,
      [itemIds[index]!, materialId, question.identity, fingerprint],
    );
  }
}

/** The items of one practice version that have a frozen page source. */
export async function readSourcedQuestionItems(query: Query, versionId: string): Promise<string[]> {
  if (!(await hasPageSources(query))) return [];
  const rows = await query(
    "SELECT item_key FROM study_page_source_bindings WHERE binding_kind = 'frozen_question' AND item_key IN (SELECT id FROM practice_test_items WHERE version_id = ?)",
    [versionId],
  );
  return rows.map((row) => String(row.item_key));
}

/** A saved practice item's source, read against its own frozen wording. */
export async function readQuestionPageSource(query: Query, owner: string, itemId: string, question: QuestionContent): Promise<PageSource | undefined> {
  return readPageSource(query, owner, "frozen_question", itemId, await questionSourceFingerprint(question));
}

/**
 * Question sources nothing can show any more: a pruned item row, or the
 * drafts of a deleted material. Saved attempts keep their frozen ones.
 */
export async function collectQuestionSources(run: Run, query: Query) {
  if (!(await hasPageSources(query))) return;
  await run("DELETE FROM study_page_source_bindings WHERE binding_kind = 'frozen_question' AND item_key NOT IN (SELECT id FROM practice_test_items)", []);
  await run("DELETE FROM study_page_source_bindings WHERE binding_kind = 'authored_question' AND owner_key NOT IN (SELECT id FROM study_materials)", []);
}
