/**
 * Her data: where it lives, and copies of it.
 *
 * The desktop shell keeps everything in one application data directory and
 * copies the database aside before the first run of any new version. These
 * wrap the commands that expose that to her.
 */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

import { isTauri } from "@/data";

export interface BackupInfo {
  name: string;
  path: string;
  bytes: number;
  /** Seconds since the Unix epoch. */
  createdAt: number;
}

export interface CompleteBackupInfo {
  appVersion: string;
  /** Seconds since the Unix epoch. */
  createdAt: number;
  files: number;
  /** Uncompressed bytes represented by the archive. */
  bytes: number;
  path: string;
}

export const backupsAvailable = (): boolean => isTauri();

/** Tauri command failures cross the boundary as strings, not Error objects. */
export function backupErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function listBackups(): Promise<BackupInfo[]> {
  if (!isTauri()) return [];
  return invoke<BackupInfo[]>("list_backups");
}

export async function createBackup(): Promise<string> {
  if (!isTauri()) throw new Error("Backups need the desktop application.");
  return invoke<string>("create_backup");
}

/** Ask where to save, then return the selected portable-backup path. */
export async function chooseCompleteBackupDestination(): Promise<string | null> {
  if (!isTauri()) throw new Error("Backups need the desktop application.");
  const date = new Date().toISOString().slice(0, 10);
  return save({
    title: "Save a complete Her Flight Deck backup",
    defaultPath: `her-flight-deck-${date}.hfdbackup`,
    filters: [{ name: "Her Flight Deck backup", extensions: ["hfdbackup"] }],
  });
}

export async function createCompleteBackup(destinationPath: string): Promise<CompleteBackupInfo> {
  if (!isTauri()) throw new Error("Backups need the desktop application.");
  return invoke<CompleteBackupInfo>("create_complete_backup", { destinationPath });
}

/** Ask for an archive without changing any current data. */
export async function chooseCompleteBackup(): Promise<string | null> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose a Her Flight Deck backup",
    filters: [{ name: "Her Flight Deck backup", extensions: ["hfdbackup"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function inspectCompleteBackup(sourcePath: string): Promise<CompleteBackupInfo> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  return invoke<CompleteBackupInfo>("inspect_complete_backup", { sourcePath });
}

export async function stageCompleteRestore(sourcePath: string): Promise<CompleteBackupInfo> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  return invoke<CompleteBackupInfo>("stage_complete_restore", { sourcePath });
}

export async function restartForRestore(): Promise<void> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  await invoke("restart_for_restore");
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
  if (name.endsWith("-before-restore")) return "Saved before a restore";
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

export const formatBackupDate = (createdAt: number): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(createdAt * 1000));
