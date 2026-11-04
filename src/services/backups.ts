/**
 * The student's data: where it lives, and copies of it.
 *
 * The desktop shell keeps everything in one application data directory and
 * copies the database aside before the first run of any new version. These
 * wrap the commands that expose that to the student.
 */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import { isTauri } from "@/data";
import { formatLocalDay, todayIso } from "@/lib/dates";
import { airportWeather } from "./weather";
import { isIOS } from "./platform";

export interface BackupInfo {
  name: string;
  path: string;
  bytes: number;
  /** Seconds since the Unix epoch. */
  createdAt: number;
  /** Whether this copy holds a database the app could actually put back. */
  restorable: boolean;
}

export interface CompleteBackupInfo {
  /** The version that wrote the backup. */
  appVersion: string;
  /** The version running now. */
  currentAppVersion: string;
  /** Seconds since the Unix epoch. */
  createdAt: number;
  files: number;
  /** Size of the backup file on disk. */
  fileBytes: number;
  /** Uncompressed bytes represented by the archive. */
  bytes: number;
  path: string;
  missingDocuments?: string[];
  unreferencedDocuments?: string[];
  /** Picture cards whose picture is gone or no longer matches. */
  unavailablePictures?: number;
  /** FAA reference copies whose PDF is gone or no longer matches. */
  unavailableReferences?: number;
  /** Database version of the app that wrote the backup (absent in older backups). */
  schemaVersion?: number;
  /** Device that wrote the backup (absent in older backups). */
  deviceId?: string;
  /** Operating system that wrote the backup (absent in older backups). */
  platform?: string;
  /** The database version this app understands. */
  currentSchemaVersion: number;
}

export const backupsAvailable = (): boolean => isTauri();

/** Tauri command failures cross the boundary as strings, not Error objects. */
export function backupErrorMessage(error: unknown, fallback: string, writing = true): string {
  const message = error instanceof Error ? error.message
    : typeof error === "string" ? error
    : error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  if (typeof message !== "string" || !message.trim()) return fallback;
  if (writing && /read[- ]only|permission denied|access (?:is )?denied|os error (?:13|30)\b|EACCES|EROFS|EPERM/i.test(message)) {
    return "That folder can't be saved to. Choose another folder, like Documents.";
  }
  return message;
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
  const date = todayIso();
  return save({
    title: "Save a complete Your Flight Deck backup",
    defaultPath: `her-flight-deck-${date}.hfdbackup`,
    filters: [{ name: "Your Flight Deck backup", extensions: ["hfdbackup"] }],
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
    title: "Choose a Flight Deck backup",
    ...(!isIOS() ? { filters: [{ name: "Your Flight Deck backup", extensions: ["hfdbackup"] }] } : {}),
  });
  return typeof selected === "string" ? selected : null;
}

export async function inspectCompleteBackup(sourcePath: string): Promise<CompleteBackupInfo> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  return invoke<CompleteBackupInfo>("inspect_complete_backup", { sourcePath });
}

export async function stageCompleteRestore(sourcePath: string): Promise<CompleteBackupInfo> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  airportWeather.clear();
  return invoke<CompleteBackupInfo>("stage_complete_restore", { sourcePath });
}

/**
 * Stage one of the automatic safety copies, without touching uploaded files.
 *
 * These copies are the database as it stood before an update. The student's documents
 * never moved, so a restore from one deliberately leaves them alone.
 */
export async function stageLocalRestore(name: string): Promise<BackupInfo> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  airportWeather.clear();
  return invoke<BackupInfo>("stage_local_restore", { name });
}

export async function restartForRestore(): Promise<void> {
  if (!isTauri()) throw new Error("Restore needs the desktop application.");
  await invoke("restart_for_restore");
}

/** The version running right now, as the desktop shell reports it. */
export async function appVersion(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("app_version");
}

export async function dataDirectory(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("data_directory");
}

/**
 * Open the student's data folder in Finder or File Explorer.
 *
 * The desktop shell resolves the folder itself (`open_data_folder`), so the
 * page never passes a path and needs no file-system scope for it.
 */
export async function openDataFolder(): Promise<void> {
  if (!isTauri()) throw new Error("This needs the desktop application.");
  await invoke("open_data_folder");
}

/** Describes an automatic copy in words, e.g. "before version 0.2.0". */
export function describeBackup(name: string): string {
  if (name.endsWith("-before-restore")) return "Saved before a restore";
  const upgrade = name.match(/-before-(.+)$/);
  if (upgrade) return `Taken before updating to ${upgrade[1]}`;
  if (name.endsWith("-manual")) return "Taken by you";
  return "Database copy";
}

/**
 * The local day an automatic copy was made, read from its name.
 *
 * The desktop shell names copies by UTC time ("2026-10-16-035630-manual"), so
 * the first ten characters are the UTC day, which is tomorrow on a US evening.
 * Returns null when the name does not start with a readable time.
 */
export function backupLocalDay(name: string, today: string = todayIso()): string | null {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})(?:-|$)/);
  if (!match) return null;
  const [, day, hours, minutes, seconds] = match;
  return formatLocalDay(`${day}T${hours}:${minutes}:${seconds}Z`, today);
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

/** Whether a pre-update safety copy failed; kept until a later copy succeeds. */
export async function upgradeCopyFailed(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("upgrade_copy_failed");
}

export interface ActivitySummary {
  latestReviewAt: string | null;
  reviewsLast7Days: number;
  attemptsLast7Days: number;
}

export async function importPickedBackup(sourcePath: string): Promise<CompleteBackupInfo> {
  if (!isTauri()) throw new Error("Restore needs the application.");
  return invoke<CompleteBackupInfo>("import_picked_backup", { sourcePath });
}

export async function discardIncomingBackup(): Promise<void> {
  if (!isTauri()) return;
  await invoke("discard_incoming_backup");
}

export async function exitForRestore(): Promise<void> {
  if (!isTauri()) throw new Error("Restore needs the application.");
  await invoke("exit_for_restore");
}

export async function phoneActivitySummary(): Promise<ActivitySummary> {
  if (!isTauri()) return { latestReviewAt: null, reviewsLast7Days: 0, attemptsLast7Days: 0 };
  return invoke<ActivitySummary>("phone_activity_summary");
}

export interface UnsavedPhoneWork {
  reviews: number;
  tests: number;
  bookmarks: number;
  readingPositions: number;
  since: string | null;
}

export async function unsavedPhoneWork(): Promise<UnsavedPhoneWork> {
  if (!isTauri()) return { reviews: 0, tests: 0, bookmarks: 0, readingPositions: 0, since: null };
  return invoke<UnsavedPhoneWork>("unsaved_phone_work");
}

export function unsavedPhoneWorkTotal(work: Pick<UnsavedPhoneWork, "reviews" | "tests" | "bookmarks" | "readingPositions">): number {
  return work.reviews + work.tests + work.bookmarks + work.readingPositions;
}

export interface SavedPhoneWork {
  fileName: string;
  savedAt: string;
  fileBytes: number;
  keptFileName?: string | null;
}

export async function savePhoneWork(): Promise<SavedPhoneWork> {
  if (!isTauri()) throw new Error("Only the phone saves its work this way.");
  return invoke<SavedPhoneWork>("save_phone_work");
}

export function savedPhoneWorkSentence(saved: Pick<SavedPhoneWork, "fileName" | "keptFileName">): string {
  const base = `Saved in Files \u2192 Your Flight Deck \u2192 ${saved.fileName}.`;
  return saved.keptFileName ? `${base} Your earlier copy is kept as ${saved.keptFileName}.` : base;
}

/** "12 card reviews and 1 practice test", or null when nothing is unsaved. */
export function unsavedPhoneWorkCounts(
  work: Pick<UnsavedPhoneWork, "reviews" | "tests" | "bookmarks" | "readingPositions">,
): string | null {
  const part = (n: number, one: string, many: string) => (n === 0 ? null : n === 1 ? `1 ${one}` : `${n} ${many}`);
  const parts = [
    part(work.reviews, "card review", "card reviews"),
    part(work.tests, "practice test", "practice tests"),
    part(work.bookmarks, "bookmark", "bookmarks"),
    part(work.readingPositions, "reading position", "reading positions"),
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0]!
    : parts.length === 2 ? `${parts[0]} and ${parts[1]}`
    : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Mirrors the sentence the app itself refuses with (src-tauri/src/phone_work.rs). */
export function unsavedPhoneWorkSentence(
  work: Pick<UnsavedPhoneWork, "reviews" | "tests" | "bookmarks" | "readingPositions">,
): string | null {
  const list = unsavedPhoneWorkCounts(work);
  if (list === null) return null;
  return `This phone has ${list} that aren't saved anywhere else yet. Save my phone work first, then get your study material.`;
}
