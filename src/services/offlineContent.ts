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
