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

/** After this long without a complete backup, the app says so. */
export const BACKUP_REMINDER_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const days = Math.floor((now.getTime() - taken.getTime()) / DAY_MS);
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
