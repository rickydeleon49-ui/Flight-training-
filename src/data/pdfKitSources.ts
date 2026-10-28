/** PDF extraction evidence, shared by the two atomic authoring writers.
 * Item hashes cover content only; identity and later human origins are separate.
 * No absent evidence is interpreted as human or AI authorship here.
 */
import type { SqlValue } from "./db";
import { canonicalJson, sha256Hex } from "@/logic/cardIdentity";

export interface PdfKitSources {
  runId: string;
  run: { materialId: string; contentSha256: string; selectedPages: number[]; extractorVersion: number; algorithmVersion: number; createdAt: string };
  items: PdfKitSource[];
}
export interface PdfKitSource {
  itemKind: "summary" | "section" | "card" | "question";
  logicalId: string;
  contentHash: string;
  page: number;
  startOffset: number;
  endOffset: number;
  quote: string;
}
type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];
type Run = (sql: string, params: SqlValue[]) => Promise<void> | void;
const hex = /^[0-9a-f]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).sort().join() === [...fields].sort().join();
const integer = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;

export function decodePdfKitSources(value: unknown, materialId: string): PdfKitSources {
  const invalid = (): never => { throw new Error("INVALID_PDF_KIT_SOURCES"); };
  if (!record(value) || !keys(value, ["runId", "run", "items"]) || typeof value.runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.runId)) return invalid();
  const r = value.run;
  if (!record(r) || !keys(r, ["materialId", "contentSha256", "selectedPages", "extractorVersion", "algorithmVersion", "createdAt"]) ||
      r.materialId !== materialId || typeof r.contentSha256 !== "string" || !hex.test(r.contentSha256) ||
      !integer(r.extractorVersion, 1, 2147483647) || !integer(r.algorithmVersion, 1, 2147483647) ||
      typeof r.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.createdAt) ||
      (!Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString() !== r.createdAt) || !Array.isArray(r.selectedPages) || !r.selectedPages.length || r.selectedPages.length > 1000 ||
      r.selectedPages.some((p, i, a) => !integer(p, 1, 1000) || (i > 0 && p <= a[i - 1]))) return invalid();
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 2000) return invalid();
  const seen = new Set<string>();
  for (const s of value.items) {
    if (!record(s) || !keys(s, ["itemKind", "logicalId", "contentHash", "page", "startOffset", "endOffset", "quote"]) ||
        !["summary", "section", "card", "question"].includes(String(s.itemKind)) || typeof s.logicalId !== "string" || !id.test(s.logicalId) ||
        (s.itemKind === "summary" && s.logicalId !== `summary:${value.runId}`) ||
        typeof s.contentHash !== "string" || !hex.test(s.contentHash) || !integer(s.page, 1, 1000) || !r.selectedPages.includes(s.page) ||
        !integer(s.startOffset, 0, 131072) || !integer(s.endOffset, s.startOffset + 1, 131072) ||
        typeof s.quote !== "string" || !s.quote.length || Array.from(s.quote).length > 2000 || new TextEncoder().encode(s.quote).length !== s.endOffset - s.startOffset) return invalid();
    const key = canonicalJson([s.itemKind, s.logicalId, s.contentHash, s.page, s.startOffset]);
    if (seen.has(key)) return invalid();
    seen.add(key);
  }
  return structuredClone(value) as unknown as PdfKitSources;
}

/** Canonical content projections are deliberately independent of editor origin. */
export function pdfKitContent(itemKind: PdfKitSource["itemKind"], item: Record<string, unknown> | string): unknown {
  if (itemKind === "summary") return item;
  const q = item as Record<string, unknown>;
  const fields = itemKind === "question" ? ["question", "options", "correctIndex", "explanation", "sourcePage"] : itemKind === "card" ? ["front", "back", "sourcePage"] : ["heading", "body"];
  return Object.fromEntries([...fields.map(k => [k, q[k]]), ...(itemKind === "card" && q.visualRegionId ? [["visualRegionId",q.visualRegionId]] : [])]);
}
export const pdfKitContentHash = (kind: PdfKitSource["itemKind"], item: Record<string, unknown> | string) => sha256Hex(canonicalJson(pdfKitContent(kind, item)));

export async function validatePdfKitContent(sources: PdfKitSources, next: Record<string, unknown>): Promise<void> {
  for (const s of sources.items) {
    const items = (s.itemKind === "question" ? next.questions : s.itemKind === "card" ? next.flashcards : next.sections) as Record<string, unknown>[] | undefined;
    const item = s.itemKind === "summary" ? next.summary : items?.find(i => (i.identity ?? i.itemId) === s.logicalId);
    if ((typeof item !== "string" && !record(item)) || await pdfKitContentHash(s.itemKind, item) !== s.contentHash) throw new Error("INVALID_PDF_KIT_CONTENT");
  }
}

/** Called inside the content transaction. Existing runs are immutable. */
export async function writePdfKitSources(run: Run, query: Query, sources: PdfKitSources): Promise<void> {
  const r = sources.run;
  const values: SqlValue[] = [sources.runId, r.materialId, r.contentSha256, JSON.stringify(r.selectedPages), r.extractorVersion, r.algorithmVersion, r.createdAt];
  const existing = await query("SELECT * FROM pdf_kit_runs WHERE run_id = ?", [sources.runId]);
  if (existing.length) {
    const e = existing[0]!;
    if (canonicalJson([e.run_id, e.material_id, e.content_sha256, e.selected_pages_json, e.extractor_version, e.algorithm_version, e.created_at]) !== canonicalJson(values)) throw new Error("SOURCE_CHANGED");
  } else {
    await run("INSERT INTO pdf_kit_runs (run_id, material_id, content_sha256, selected_pages_json, extractor_version, algorithm_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", values);
  }
  for (const s of sources.items) {
    const values: SqlValue[] = [sources.runId, s.itemKind, s.logicalId, s.contentHash, s.page, s.startOffset, s.endOffset, s.quote];
    const [prior] = await query("SELECT end_offset, quote FROM pdf_kit_item_sources WHERE run_id = ? AND item_kind = ? AND logical_id = ? AND content_hash = ? AND page = ? AND start_offset = ?", values.slice(0, 6));
    if (prior) {
      if (prior.end_offset !== s.endOffset || prior.quote !== s.quote) throw new Error("SOURCE_CHANGED");
    } else await run("INSERT INTO pdf_kit_item_sources (run_id, item_kind, logical_id, content_hash, page, start_offset, end_offset, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values);
  }
}

export interface PdfItemProvenance {
  status: "valid" | "invalid";
  label: "Pulled from your PDF on this Mac" | "PDF source details unavailable";
  editOrigin?: "user" | "instructor";
  sources: (PdfKitSource & { runId: string })[];
}
/** Read-only lineage resolution. A broken row carries an explicit invalid state;
 * callers must use that state before any provider or human-origin fallback.
 */
export async function readPdfItemProvenance(
  query: Query, materialId: string, kind: PdfKitSource["itemKind"], logicalId: string,
  current: Record<string, unknown> | string, editOrigin?: "user" | "instructor",
): Promise<PdfItemProvenance | undefined> {
  const invalid = (): PdfItemProvenance => ({ status: "invalid", label: "PDF source details unavailable", sources: [], ...(editOrigin ? { editOrigin } : {}) });
  const rows = await query(`SELECT s.*, r.material_id, r.content_sha256, r.selected_pages_json, r.extractor_version, r.algorithm_version, r.created_at
    FROM pdf_kit_item_sources s LEFT JOIN pdf_kit_runs r ON r.run_id = s.run_id
    WHERE s.item_kind = ? AND (r.material_id = ? OR r.run_id IS NULL)
    ORDER BY s.run_id, s.page, s.start_offset`, [kind, materialId]);
  if (!rows.length) {
    const runs = await query("SELECT run_id FROM pdf_kit_runs WHERE material_id = ? LIMIT 1", [materialId]);
    return runs.length && !editOrigin ? invalid() : undefined;
  }
  const content = new Map<string, (Record<string, unknown> | string)[]>();
  const add = (id: string, item: Record<string, unknown> | string) => content.set(id, [...(content.get(id) ?? []), item]);
  add(logicalId, current);
  const addSet = (summary: unknown, sections: unknown, cards: unknown) => {
    if (kind === "summary" && typeof summary === "string") add(logicalId, summary);
    const list = kind === "section" ? sections : kind === "card" ? cards : [];
    if (Array.isArray(list)) for (const item of list) if (record(item) && typeof item.itemId === "string") add(item.itemId, item);
  };
  try {
    if (kind === "question") {
      for (const r of await query(`SELECT i.*, COALESCE(i.logical_id, i.id) AS identity FROM practice_test_items i JOIN practice_test_versions v ON v.id = i.version_id WHERE v.source_material_id = ?`, [materialId])) {
        add(String(r.identity), { question: r.question_text, options: JSON.parse(String(r.options_json)), correctIndex: r.correct_index, explanation: r.explanation, sourcePage: r.source_page, replaces: r.replaces_id });
      }
    } else {
      for (const r of await query("SELECT summary, sections_json, flashcards_json FROM ai_study_sets WHERE source_material_id = ?", [materialId])) addSet(r.summary, JSON.parse(String(r.sections_json)), JSON.parse(String(r.flashcards_json)));
    }
    for (const r of await query("SELECT previous_json FROM study_set_history WHERE material_id = ? AND kind = ?", [materialId, kind === "question" ? "practice" : "study_set"])) {
      const s = JSON.parse(String(r.previous_json));
      if (kind === "question") { for (const q of s.questions ?? []) if (record(q) && typeof q.identity === "string") add(q.identity, q); }
      else addSet(s.summary, JSON.parse(s.sections_json), JSON.parse(s.flashcards_json));
    }
  } catch { return invalid(); }
  const lineage = new Set([logicalId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...lineage]) for (const item of content.get(id) ?? []) if (record(item) && typeof item.replaces === "string" && !lineage.has(item.replaces)) { lineage.add(item.replaces); changed = true; }
  }
  const relevant = rows.filter(r => kind === "summary" || lineage.has(String(r.logical_id)));
  if (!relevant.length) return !editOrigin ? invalid() : undefined;
  const sources: (PdfKitSource & { runId: string })[] = [];
  for (const row of relevant) {
    try {
      const s = decodePdfKitSources({ runId: row.run_id, run: { materialId: row.material_id, contentSha256: row.content_sha256, selectedPages: JSON.parse(String(row.selected_pages_json)), extractorVersion: row.extractor_version, algorithmVersion: row.algorithm_version, createdAt: row.created_at }, items: [{ itemKind: row.item_kind, logicalId: row.logical_id, contentHash: row.content_hash, page: row.page, startOffset: row.start_offset, endOffset: row.end_offset, quote: row.quote }] }, materialId);
      const item = s.items[0]!;
      const prior = content.get(kind === "summary" ? logicalId : item.logicalId) ?? [];
      const hashes = await Promise.all(prior.map(v => pdfKitContentHash(kind, v)));
      if (!hashes.includes(item.contentHash)) return invalid();
      // An immutable older question may share its logical id with a later edit.
      // Valid evidence for that later stored version is not evidence for this one.
      if (!editOrigin && await pdfKitContentHash(kind, current) !== item.contentHash) continue;
      sources.push({ ...item, runId: s.runId });
    } catch { return invalid(); }
  }
  return sources.length ? { status: "valid", label: "Pulled from your PDF on this Mac", sources, ...(editOrigin ? { editOrigin } : {}) } : invalid();
}
