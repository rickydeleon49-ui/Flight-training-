/** Save a complete copy where her iPhone can open it. */
import { invoke } from "@tauri-apps/api/core";

import {
  chooseCompleteBackupDestination,
  createCompleteBackup,
  type CompleteBackupInfo,
} from "./backups";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Her local "YYYY-MM-DD HHmm", used in the file name. */
export function localStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Saves into iCloud Drive when it is on; otherwise asks where to save.
 * Returns null if she cancels the dialog.
 */
export async function sendToIphone(): Promise<{ info: CompleteBackupInfo; viaICloud: boolean } | null> {
  const info = await invoke<CompleteBackupInfo | null>("create_iphone_backup", {
    localStamp: localStamp(),
  });
  if (info) return { info, viaICloud: true };
  const destination = await chooseCompleteBackupDestination();
  if (!destination) return null;
  return { info: await createCompleteBackup(destination), viaICloud: false };
}

export async function revealIphoneBackup(path: string): Promise<void> {
  await invoke("reveal_iphone_backup", { path });
}
