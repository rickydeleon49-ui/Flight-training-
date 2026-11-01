/**
 * Downloading official FAA handbooks (Slice 3a).
 *
 * The webview sends only a manifest id; the Rust side owns the address, the
 * size limit and the file name, and talks to www.faa.gov. Desktop only.
 */
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/data";
import type { ImportedDocument } from "./documents";

export type FaaDownloadKind = "afhChapter" | "afhAddendum" | "phakFull";

/** Mirrors `faa_downloads::EntryInfo` in Rust. */
export interface FaaDownloadEntry {
  id: string;
  title: string;
  edition: string;
  published: string;
  maxBytes: number;
  kind: FaaDownloadKind;
  /** False for the full Pilot's Handbook until it gets its own button. */
  offeredNow: boolean;
}

/** Mirrors `faa_downloads::Downloaded`; slice 3b stores the provenance. */
export interface FaaDownloaded {
  document: ImportedDocument;
  manifestId: string;
  sourceUrl: string;
  edition: string;
  sha256: string;
  bytes: number;
  httpLastModified: string | null;
}

export interface FaaDownloadProgress {
  received: number;
  /** 0 when faa.gov did not say. */
  total: number;
}

export type FaaFailureKind =
  | "blocked" | "unknown" | "busy" | "offline" | "timeout" | "moved" | "notFound"
  | "server" | "badType" | "tooBig" | "interrupted" | "notPdf" | "cancelled" | "storage" | "unavailable";

export interface FaaFailure { kind: FaaFailureKind; message: string }

const UNAVAILABLE: FaaFailure = {
  kind: "unavailable",
  message: "Getting a handbook from faa.gov needs the desktop app.",
};

/** Narrow whatever the native side rejected with to a failure the UI can show. */
export function faaFailure(error: unknown): FaaFailure {
  if (error && typeof error === "object" && "kind" in error && "message" in error) {
    const { kind, message } = error as { kind: unknown; message: unknown };
    if (typeof kind === "string" && typeof message === "string") {
      return { kind: kind as FaaFailureKind, message };
    }
  }
  return { kind: "unavailable", message: "faa.gov didn't answer. Try again later, or add the PDF yourself." };
}

export async function listFaaDownloads(): Promise<FaaDownloadEntry[]> {
  if (!isTauri()) return [];
  return invoke<FaaDownloadEntry[]>("list_faa_downloads");
}

export async function downloadFaaHandbook(id: string, materialId: string): Promise<FaaDownloaded> {
  if (!isTauri()) throw UNAVAILABLE;
  try {
    return await invoke<FaaDownloaded>("download_faa_handbook", { id, materialId });
  } catch (error) {
    throw faaFailure(error);
  }
}

export async function faaDownloadProgress(): Promise<FaaDownloadProgress | null> {
  if (!isTauri()) return null;
  return invoke<FaaDownloadProgress | null>("faa_download_progress");
}

export async function cancelFaaDownload(): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_faa_download");
}
