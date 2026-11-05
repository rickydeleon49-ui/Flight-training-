/** Phone side: bring in the file of changes the Mac saved. */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { isTauri } from "@/data";

export interface MacChanges {
  outcome: "added" | "alreadyIn" | "nothingNew";
  materials: number;
  removed: number;
  cardSets: number;
  practiceTests: number;
  studyGuides: number;
  pdfsAdded: number;
  pdfsWaiting: number;
  macSavedAt: number | null;
  fromFuture: boolean;
}

/** Ask for the file from the Mac. Null when cancelled. */
export async function chooseMacChangesFile(): Promise<string | null> {
  if (!isTauri()) throw new Error("Getting changes needs the app on your iPhone.");
  const selected = await open({ multiple: false, directory: false, title: "Choose the file from your Mac" });
  return typeof selected === "string" ? selected : null;
}

export async function getMacChanges(sourcePath: string): Promise<MacChanges> {
  if (!isTauri()) throw new Error("Getting changes needs the app on your iPhone.");
  return invoke<MacChanges>("get_mac_changes", { sourcePath });
}

const pdfs = (n: number): string => (n === 1 ? "1 PDF" : `${n} PDFs`);

/** One calm sentence (or two) about what happened. */
export function macChangesSentence(got: MacChanges, list: string | null): string {
  const parts: string[] = [];
  if (got.outcome === "added" && list) parts.push(`Brought in from your Mac: ${list}.`);
  else if (got.outcome === "alreadyIn") parts.push("That file was already brought in.");
  else parts.push("Your Mac hasn't changed anything new since last time.");
  if (got.pdfsAdded > 0) parts.push(`${pdfs(got.pdfsAdded)} copied.`);
  if (got.pdfsWaiting > 0) {
    parts.push(`${pdfs(got.pdfsWaiting)} from your Mac ${got.pdfsWaiting === 1 ? "isn't" : "aren't"} here yet.`);
  }
  if (got.fromFuture) parts.push("That file's clock looks ahead of this phone's. Check the time on your Mac.");
  return parts.join(" ");
}
