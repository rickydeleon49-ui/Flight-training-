/**
 * Unsaved typing, kept until it is saved for real.
 *
 * A debrief takes a while to write, and until now clicking away lost it. The
 * draft is mirrored into localStorage as she types and read back when the
 * form opens again, so leaving a page is never destructive.
 *
 * localStorage rather than the database on purpose: this is scratch text, it
 * should not enter her training record, appear in backups, or survive being
 * deliberately discarded.
 */
const PREFIX = "her-flight-deck.draft.";

/** Storage can be unavailable or full; a lost draft must never break a form. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    // Out of space, or private mode. The form still works.
    return false;
  }
}

export function clearDraft(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(PREFIX + key);
  } catch {
    // Nothing to do.
  }
}
