/** Save a complete copy where the student's iPhone can open it. */
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import {
  chooseCompleteBackupDestination,
  createCompleteBackup,
  type CompleteBackupInfo,
} from "./backups";

const pad = (n: number): string => String(n).padStart(2, "0");

/** The student's local "YYYY-MM-DD HHmm", used in the file name. */
export function localStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Saves into iCloud Drive when it is on; otherwise asks where to save.
 * Returns null if the student cancels the dialog.
 */
export async function sendToIphone(): Promise<{ info: CompleteBackupInfo; viaICloud: boolean } | null> {
  const info = await invoke<CompleteBackupInfo | null>("create_iphone_backup", {
    localStamp: localStamp(),
  });
  if (info) return { info, viaICloud: true };
  const destination = await chooseCompleteBackupDestination();
  if (!destination) return null;
  // Read before the copy starts, used only once it is saved: the Mac's later
  // changes then start after it. A problem here never stops the copy.
  let mark: number | null = null;
  try {
    mark = await invoke<number | null>("change_stream_mark_before_copy");
  } catch (error) {
    console.warn("Could not note where the copy starts", error);
  }
  const copy = await createCompleteBackup(destination);
  if (mark !== null) {
    try {
      await invoke("restart_change_stream_after_copy", { markBeforeCopy: mark });
    } catch (error) {
      console.warn("Could not restart the Mac's changes after the copy", error);
    }
  }
  return { info: copy, viaICloud: false };
}

/** The file name the Mac's changes are always saved under. */
export const MAC_CHANGES_FILE = "Changes from my Mac.hfdprogress";

export interface SentMacChanges {
  fileName: string;
  sentAt: string;
  nothingNew: boolean;
  counts: { materials: number; removed: number; cardSets: number; practiceTests: number; studyGuides: number };
  pdfsIncluded: number;
  pdfsLeft: number;
  fileBytes: number;
  path: string;
}

/**
 * Saves the Mac's changes since the last full copy: into iCloud Drive when it
 * is on, otherwise where the student chooses. Null on cancel.
 */
export async function sendChangesToIphone(): Promise<{ sent: SentMacChanges; viaICloud: boolean } | null> {
  const inICloud = await invoke<SentMacChanges | null>("send_mac_changes");
  if (inICloud) return { sent: inICloud, viaICloud: true };
  const destination = await save({
    title: "Save your changes for your iPhone",
    defaultPath: MAC_CHANGES_FILE,
    filters: [{ name: "Your Flight Deck changes", extensions: ["hfdprogress"] }],
  });
  if (!destination) return null;
  const sent = await invoke<SentMacChanges>("send_mac_changes_to", { destinationPath: destination });
  return { sent, viaICloud: false };
}

const count = (n: number, one: string, many: string): string | null =>
  n === 0 ? null : n === 1 ? `1 ${one}` : `${n} ${many}`;

/** "3 study materials and 1 card set", or null when the file holds nothing to list. */
export function macChangesCounts(c: Pick<SentMacChanges["counts"], keyof SentMacChanges["counts"]>): string | null {
  const parts = [
    count(c.materials, "study material", "study materials"),
    count(c.cardSets, "card set", "card sets"),
    count(c.practiceTests, "practice test", "practice tests"),
    count(c.studyGuides, "study guide", "study guides"),
    count(c.removed, "removed study material", "removed study materials"),
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0]!
    : parts.length === 2 ? `${parts[0]} and ${parts[1]}`
    : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export async function revealIphoneBackup(path: string): Promise<void> {
  await invoke("reveal_iphone_backup", { path });
}
