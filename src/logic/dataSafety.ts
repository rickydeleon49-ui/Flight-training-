/**
 * Knowing whether her training record is actually protected.
 *
 * Two questions have to be answerable without opening a file manager:
 *
 *   1. When did she last save a complete backup, and is it still current?
 *   2. Is the backup she is about to restore older or newer than this app?
 *
 * Both are pure decisions about strings and dates, so they are decided here
 * and tested, rather than being worked out inside a screen.
 */
import { daysBetween, todayIso } from "@/lib/dates";

/** After this long without a complete backup, the app says so. */
export const BACKUP_REMINDER_DAYS = 14;

/**
 * Compare two version strings the way `0.10.0` deserves.
 *
 * Returns a negative number when `a` is older, positive when it is newer, and
 * zero when they are the same. Anything unparseable sorts as 0, which makes an
 * unknown version compare equal rather than falsely "newer".
 */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string): number[] =>
    value
      .trim()
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));

  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Was this backup written by a version newer than the one running now? */
export const isFromNewerVersion = (backupVersion: string, appVersion: string): boolean =>
  Boolean(backupVersion) && Boolean(appVersion) && compareVersions(backupVersion, appVersion) > 0;

export type BackupState = "never" | "after-update" | "stale" | "protected";

export interface BackupHealth {
  state: BackupState;
  /** What to tell her, in one sentence. */
  message: string;
  /** True when she should be nudged to save one now. */
  needsAttention: boolean;
}

export interface BackupHealthInput {
  /** ISO timestamp of the last complete backup, or null if there is none. */
  lastBackupAt: string | null;
  /** The app version that wrote it. */
  lastBackupVersion: string | null;
  /** The version running now. */
  appVersion: string;
  now: Date;
}

/**
 * Say whether a complete backup is current.
 *
 * The version check matters more than the calendar: an update is the moment
 * data is most at risk, so a backup taken under an older version is called out
 * even if it was made this morning.
 */
export function backupHealth({
  lastBackupAt,
  lastBackupVersion,
  appVersion,
  now,
}: BackupHealthInput): BackupHealth {
  const taken = lastBackupAt ? new Date(lastBackupAt) : null;
  if (!taken || Number.isNaN(taken.getTime())) {
    return {
      state: "never",
      message:
        "No complete backup has been saved yet. Save one now, and keep it somewhere other than this computer.",
      needsAttention: true,
    };
  }

  // Local calendar days, so a backup saved late last night reads "yesterday"
  // this morning rather than "today".
  const days = daysBetween(todayIso(taken), todayIso(now));
  const when = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;

  if (lastBackupVersion && appVersion && compareVersions(lastBackupVersion, appVersion) !== 0) {
    return {
      state: "after-update",
      message: `Your last complete backup was saved ${when}, under version ${lastBackupVersion}. This app is now version ${appVersion} — save a fresh backup so it matches what you have today.`,
      needsAttention: true,
    };
  }

  if (days >= BACKUP_REMINDER_DAYS) {
    return {
      state: "stale",
      message: `Your last complete backup was saved ${when}. Saving a new one keeps your recent lessons, notes and uploads protected.`,
      needsAttention: true,
    };
  }

  return {
    state: "protected",
    message: `Complete backup saved ${when}, from version ${lastBackupVersion || appVersion}.`,
    needsAttention: false,
  };
}

/**
 * The warning shown before restoring, or null when there is nothing to warn about.
 *
 * Restoring a backup written by a newer version means the database arrives with
 * a schema this build has never seen, which it cannot migrate backwards.
 */
export function restoreWarning(backupVersion: string, appVersion: string): string | null {
  if (!isFromNewerVersion(backupVersion, appVersion)) return null;
  return `This backup was made by version ${backupVersion}, which is newer than the version you are running (${appVersion}). Install the newer version first, then restore — an older app cannot read a newer training record.`;
}

export interface MaterialTitleRef {
  title: string;
  filePath?: string | null;
}

/**
 * Resolve a plain display name for a document file path, using material titles
 * if available, falling back to the filename component.
 */
export function resolveDocumentDisplayName(
  docPath: string,
  materials?: MaterialTitleRef[],
): string {
  const normalized = docPath.replace(/\\/g, "/");
  if (materials && materials.length > 0) {
    const match = materials.find((m) => {
      if (!m.filePath) return false;
      const mNorm = m.filePath.replace(/\\/g, "/");
      return (
        mNorm === normalized ||
        mNorm.endsWith(`/${normalized}`) ||
        normalized.endsWith(`/${mNorm}`)
      );
    });
    if (match && match.title.trim()) {
      return match.title.trim();
    }
  }
  const fileName = normalized.split("/").pop();
  return fileName || docPath;
}

/**
 * Format a plain-language warning about study files that were missing from app storage
 * during a complete backup.
 */
export function formatMissingDocumentsWarning(
  missingDocuments: string[],
  materials?: MaterialTitleRef[],
): string {
  if (missingDocuments.length === 0) return "";
  const count = missingDocuments.length;
  const names = missingDocuments.map(
    (path) => `"${resolveDocumentDisplayName(path, materials)}"`,
  );
  let nameList = "";
  if (names.length === 1) {
    nameList = names[0] ?? "";
  } else if (names.length === 2) {
    nameList = `${names[0] ?? ""} and ${names[1] ?? ""}`;
  } else if (names.length === 3) {
    nameList = `${names[0] ?? ""}, ${names[1] ?? ""}, and ${names[2] ?? ""}`;
  } else {
    nameList = `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
  }

  const filesWord = count === 1 ? "1 study file was" : `${count} study files were`;
  const includedVerb = count === 1 ? "wasn't included" : "weren't included";
  const pronoun = count === 1 ? "it" : "them";
  return `${filesWord} missing from app storage and ${includedVerb}: ${nameList}. You can re-attach ${pronoun} in the Study Library.`;
}

/**
 * Format a plain-language notice about storage files unlinked to any material.
 */
export function formatUnreferencedDocumentsNotice(
  unreferencedDocuments: string[],
): string {
  if (unreferencedDocuments.length === 0) return "";
  const count = unreferencedDocuments.length;
  if (count === 1) {
    return "1 file in storage isn't linked to any material and was left out.";
  }
  return `${count} files in storage aren't linked to any material and were left out.`;
}

/**
 * Notice for picture cards whose picture is gone or no longer matches. Their
 * words come back; only the picture does not.
 */
export function formatUnavailablePicturesNotice(count: number | undefined): string {
  if (!count || count <= 0) return "";
  return count === 1
    ? "1 picture card no longer has its picture. Its words are kept, but the picture won't show."
    : `${count} picture cards no longer have their pictures. Their words are kept, but the pictures won't show.`;
}

/** Notice for FAA reference copies whose PDF is gone or no longer matches. */
export function formatUnavailableReferencesNotice(count: number | undefined): string {
  if (!count || count <= 0) return "";
  return count === 1
    ? "1 FAA reference copy no longer has its matching PDF. You can add the PDF again from FAA references."
    : `${count} FAA reference copies no longer have their matching PDFs. You can add the PDFs again from FAA references.`;
}

/** Every notice shown before restoring a backup, in one line. */
export function formatRestorePreviewNotice(candidate: {
  missingDocuments?: string[];
  unavailablePictures?: number;
  unavailableReferences?: number;
}): string {
  return [
    formatRestorePreviewMissingNotice(candidate.missingDocuments?.length ?? 0),
    formatUnavailablePicturesNotice(candidate.unavailablePictures),
    formatUnavailableReferencesNotice(candidate.unavailableReferences),
  ]
    .filter(Boolean)
    .join(" ");
}

export function formatBackupDocumentWarnings(
  backup: {
    missingDocuments?: string[];
    unreferencedDocuments?: string[];
    unavailablePictures?: number;
    unavailableReferences?: number;
  },
  materials?: MaterialTitleRef[],
): string[] {
  const extraParts: string[] = [];
  if (backup.missingDocuments && backup.missingDocuments.length > 0) {
    extraParts.push(formatMissingDocumentsWarning(backup.missingDocuments, materials));
  }
  if (backup.unreferencedDocuments && backup.unreferencedDocuments.length > 0) {
    extraParts.push(formatUnreferencedDocumentsNotice(backup.unreferencedDocuments));
  }
  if (backup.unavailablePictures && backup.unavailablePictures > 0) {
    extraParts.push(formatUnavailablePicturesNotice(backup.unavailablePictures));
  }
  if (backup.unavailableReferences && backup.unavailableReferences > 0) {
    extraParts.push(formatUnavailableReferencesNotice(backup.unavailableReferences));
  }
  return extraParts;
}

/**
 * Compose the full message shown after saving a complete backup, incorporating
 * warnings for missing or unreferenced files if any were detected.
 */
export function formatCompleteBackupSuccessNote(
  backup: {
    files: number;
    bytes: number;
    missingDocuments?: string[];
    unreferencedDocuments?: string[];
    unavailablePictures?: number;
    unavailableReferences?: number;
  },
  formatBytesFn: (bytes: number) => string,
  materials?: MaterialTitleRef[],
): { message: string; hasWarnings: boolean } {
  const base = `Complete backup saved — ${backup.files} files, ${formatBytesFn(backup.bytes)} protected.`;
  const extraParts = formatBackupDocumentWarnings(backup, materials);

  if (extraParts.length === 0) {
    return { message: base, hasWarnings: false };
  }
  return {
    message: `${base} ${extraParts.join(" ")}`,
    hasWarnings: true,
  };
}

/**
 * Compose the message shown when a backup was saved successfully, but writing
 * the reminder record failed. Retains any missing-document or unreferenced-file warnings.
 */
export function formatCompleteBackupReminderFailureNote(
  backup: {
    path: string;
    missingDocuments?: string[];
    unreferencedDocuments?: string[];
    unavailablePictures?: number;
    unavailableReferences?: number;
  },
  materials?: MaterialTitleRef[],
): string {
  const base = `Complete backup saved at ${backup.path}, but the app could not update its backup reminder. Keep the file somewhere safe.`;
  const extraParts = formatBackupDocumentWarnings(backup, materials);

  if (extraParts.length === 0) {
    return base;
  }
  return `${base} ${extraParts.join(" ")}`;
}

/**
 * Notice included when inspecting or previewing a backup candidate for restore.
 */
export function formatRestorePreviewMissingNotice(missingCount: number): string {
  if (missingCount <= 0) return "";
  if (missingCount === 1) {
    return "This backup lists 1 file that was already missing when it was made.";
  }
  return `This backup lists ${missingCount} files that were already missing when it was made.`;
}
