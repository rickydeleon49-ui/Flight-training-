/**
 * Offline study readiness (OFFLINE-01).
 *
 * Preparing a document reads its text on this Mac, in a separate worker
 * process, so it can later be searched without a connection. Nothing is sent
 * anywhere and no AI is involved. The feature is switched off unless the
 * build opts in: it stays off in releases until its memory budget has been
 * accepted (see docs/OFFLINE_01C_REPORT_2026-10-19.md).
 */
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/data";

export type PartialReason = "imagePages" | "someUnreadable";

/** Mirrors `extraction::service::Readiness` in Rust. */
export type OfflineReadiness =
  | { state: "unsupported" }
  | { state: "missing" }
  | { state: "checking" }
  | { state: "notPrepared" }
  | { state: "preparing" }
  | { state: "searchable"; pages: number }
  | { state: "partial"; searchable: number; pages: number; imagePages: number; reason: PartialReason }
  | { state: "couldNotProcess"; code: string };

export interface MaterialReadiness {
  materialId: string;
  readiness: OfflineReadiness;
}

/**
 * Which file a material points at, for readiness purposes. Restoring or
 * reattaching a file keeps the material's id but changes this, so readiness
 * fetched for the old file is never shown for the new one.
 */
export function fileIdentity(m: {
  id: string;
  filePath: string | null;
  fileSize: number | null;
  updatedAt: string;
}): string {
  return [m.id, m.filePath ?? "", m.fileSize ?? "", m.updatedAt].join("\0");
}

/** True only in the desktop app, and only when this build opted in. */
export function offlineStudyEnabled(): boolean {
  return isTauri() && import.meta.env.VITE_OFFLINE_EXTRACTION === "1";
}

export async function offlineContentReadiness(materialIds: string[]): Promise<MaterialReadiness[]> {
  if (!offlineStudyEnabled() || materialIds.length === 0) return [];
  return invoke<MaterialReadiness[]>("offline_content_readiness", { materialIds });
}

export async function prepareOfflineContent(materialId: string): Promise<MaterialReadiness> {
  return invoke<MaterialReadiness>("prepare_offline_content", { materialId });
}

/* ------------------------------------------------------------------ */
/* Search inside prepared documents (OFFLINE-02b)                      */
/* ------------------------------------------------------------------ */

/** Mirrors `extraction::search::Passage`. The snippet carries U+E000/U+E001 match markers. */
export interface SearchPassage {
  contentSha256: string;
  pageIndex: number;
  snippet: string;
}

/** Mirrors `extraction::search::Group`: one material and its best passages. */
export interface SearchGroup {
  materialId: string;
  title: string;
  materialType: string;
  originalFileName: string | null;
  addedAt: string;
  passages: SearchPassage[];
}

/** Mirrors `extraction::search::Coverage`, over the filtered materials. */
export interface SearchCoverage {
  searchedDocuments: number;
  searchedPages: number;
  imagePages: number;
  otherUnsearchablePages: number;
  notPrepared: number;
  notChecked: number;
  preparing: number;
  couldNotPrepare: number;
  missing: number;
  notPdf: number;
}

/** Mirrors `extraction::search::saved::SavedPassage`. */
export interface SavedPassage {
  kind: "summary" | "guide" | "card" | "practice" | "note" | "question";
  /** A section or card index, or a record id. */
  recordId: string;
  /** Guides and cards: the digest of the item's own text. */
  rev: string | null;
  snippet: string;
}

/** Mirrors `SavedGroup`: one material, or her notes, or instructor questions. */
export interface SavedGroup {
  kind: "material" | "notes" | "questions";
  materialId: string | null;
  title: string;
  passages: SavedPassage[];
}

/** Mirrors `SavedCoverage`. */
export interface SavedCoverage {
  studySets: number;
  practiceVersions: number;
  notes: number;
  questions: number;
  tooLargeItems: number;
}

/** Mirrors `SavedSection`. */
export interface SavedSection {
  state: "ok" | "too_large" | "unavailable";
  groups: SavedGroup[];
  coverage: SavedCoverage;
  nextOffset: number | null;
  moreBeyondCap: boolean;
}

export interface SearchResponse {
  groups: SearchGroup[];
  coverage: SearchCoverage;
  nextOffset: number | null;
  moreBeyondCap: boolean;
  trimmed: boolean;
  /** Present when saved content was asked for. */
  saved?: SavedSection;
}

/** Everything one search covers (documents and saved study content). */
export const ALL_CONTENT_TYPES = ["documentPages", "guides", "cards", "practice", "notes", "questions"] as const;
export const SAVED_CONTENT_TYPES = ["guides", "cards", "practice", "notes", "questions"] as const;
export type ContentType = (typeof ALL_CONTENT_TYPES)[number];

export type DestinationCheck = "ok" | "changed" | "missing";

/** A failed search's code, as the native command reports it. */
export class OfflineSearchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OfflineSearchError";
  }
}

function codeOf(error: unknown): string {
  return typeof error === "string" ? error : "search_failed";
}

/** Search prepared PDFs and saved study content, as `contentTypes` asks. */
export async function searchOfflineContent(
  query: string,
  materialIds: string[],
  offset: number,
  contentTypes: readonly ContentType[] = ALL_CONTENT_TYPES,
): Promise<SearchResponse> {
  try {
    return await invoke<SearchResponse>("search_offline_content", {
      query,
      materialIds,
      contentTypes: [...contentTypes],
      offset,
    });
  } catch (error) {
    throw new OfflineSearchError(codeOf(error));
  }
}

/** Re-check, by hashing, that a result's file is still the one searched. */
export async function verifyOfflineDestination(materialId: string, contentSha256: string): Promise<DestinationCheck> {
  try {
    return await invoke<DestinationCheck>("verify_offline_destination", { materialId, contentSha256 });
  } catch (error) {
    throw new OfflineSearchError(codeOf(error));
  }
}
