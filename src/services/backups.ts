/**
 * Her data: where it lives, and copies of it.
 *
 * The desktop shell keeps everything in one application data directory and
 * copies the database aside before the first run of any new version. These
 * wrap the commands that expose that to her.
 */
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

import { isTauri } from "@/data";

export interface BackupInfo {
  name: string;
  path: string;
  bytes: number;
  /** Seconds since the Unix epoch. */
  createdAt: number;
}

export const backupsAvailable = (): boolean => isTauri();

export async function listBackups(): Promise<BackupInfo[]> {
  if (!isTauri()) return [];
  return invoke<BackupInfo[]>("list_backups");
}

export async function createBackup(): Promise<string> {
  if (!isTauri()) throw new Error("Backups need the desktop application.");
  return invoke<string>("create_backup");
}

export async function dataDirectory(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("data_directory");
}

/** Open a folder in the system file manager. */
export async function revealFolder(path: string): Promise<void> {
  if (!isTauri()) throw new Error("This needs the desktop application.");
  await openPath(path);
}

/** Describes an automatic copy in words, e.g. "before version 0.2.0". */
export function describeBackup(name: string): string {
  const upgrade = name.match(/-before-(.+)$/);
  if (upgrade) return `Taken before updating to ${upgrade[1]}`;
  if (name.endsWith("-manual")) return "Taken by you";
  return "Database copy";
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
