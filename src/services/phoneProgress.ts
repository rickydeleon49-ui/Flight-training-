/** Bring in work done on the iPhone: the Mac reads the phone's saved file. */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { isTauri } from "@/data";
import { formatBackupDate, unsavedPhoneWorkCounts, type UnsavedPhoneWork } from "./backups";

export interface PhoneProgress {
  outcome: "added" | "alreadyIn" | "nothingNew";
  counts: UnsavedPhoneWork;
  pdfsAdded: number;
  pdfsWaiting: number;
  /** When the phone saved the file, unix seconds. */
  phoneSavedAt: number | null;
  fromFuture: boolean;
}

/** Ask for the file from the phone. Null when cancelled. */
export async function choosePhoneProgressFile(): Promise<string | null> {
  if (!isTauri()) throw new Error("Bringing in phone work needs the desktop application.");
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose the file from your iPhone",
    filters: [{ name: "Your Flight Deck file", extensions: ["hfdbackup"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function importPhoneProgress(sourcePath: string): Promise<PhoneProgress> {
  if (!isTauri()) throw new Error("Bringing in phone work needs the desktop application.");
  return invoke<PhoneProgress>("import_phone_progress", { sourcePath });
}

const pdfs = (n: number): string => (n === 1 ? "1 PDF" : `${n} PDFs`);

/** One calm sentence (or two) about what happened. */
export function phoneProgressSentence(progress: PhoneProgress): string {
  const parts: string[] = [];
  const counts = progress.counts ? unsavedPhoneWorkCounts(progress.counts) : null;
  if (progress.outcome === "added" && counts) {
    let line = `Brought in from your iPhone: ${counts}`;
    if (progress.phoneSavedAt) line += ` · saved on the phone ${formatBackupDate(progress.phoneSavedAt)}`;
    if (progress.pdfsAdded > 0) line += ` · ${pdfs(progress.pdfsAdded)} copied`;
    parts.push(`${line}.`);
  } else if (progress.outcome === "alreadyIn") {
    parts.push("That file was already brought in.");
    if (progress.pdfsAdded > 0) parts.push(`${pdfs(progress.pdfsAdded)} from your phone copied.`);
  } else {
    parts.push("Your iPhone hasn't done anything new since last time.");
    if (progress.pdfsAdded > 0) parts.push(`${pdfs(progress.pdfsAdded)} from your phone copied.`);
  }
  if (progress.pdfsWaiting > 0) {
    parts.push(`${pdfs(progress.pdfsWaiting)} from your phone ${progress.pdfsWaiting === 1 ? "isn't" : "aren't"} here yet.`);
  }
  if (progress.fromFuture) {
    parts.push("That file's clock looks ahead of this Mac's — check the time on your phone.");
  }
  return parts.join(" ");
}
