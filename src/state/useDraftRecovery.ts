import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { newId } from "@/lib/id";

interface DraftRecovery {
  /** True when what is on screen came back from an interrupted session. */
  recovered: boolean;
  /**
   * Stop keeping this draft — when she chooses to throw it away, or when the
   * form is saved and nothing newer can exist.
   */
  forget: () => void;
  /**
   * Which stored copy is on screen right now. Take it when a save starts and
   * hand it to `forgetRevision` when that save finishes.
   */
  revision: () => string | null;
  /**
   * Forget the draft only if the stored copy is still the one that was
   * saved. A form opened again while the save was running may have stored
   * newer typing under the same key; that copy is kept. Returns whether the
   * draft was forgotten.
   */
  forgetRevision: (revision: string | null) => boolean;
}

/**
 * The value is stored exactly as before; the revision sits beside it under
 * its own key, so drafts written by earlier versions still restore.
 */
const revisionKey = (key: string) => `${key}#revision`;

type SavedListener = (revision: string | null, from: object) => void;
/** Mounted forms by key, told when another form's save finished their draft. */
const savedListeners = new Map<string, Set<SavedListener>>();

/**
 * Keep a form's draft across leaving the page.
 *
 * On mount, anything stored under `key` is handed to `restore`. From then on
 * every change is mirrored to storage with a new revision. The form forgets
 * the draft once the work is safely in the database.
 */
export function useDraftRecovery<T>(
  key: string,
  value: T,
  restore: (draft: T) => void,
  /** Wait until the form has finished setting itself up. */
  ready = true,
  /**
   * A save started by an earlier copy of this form (she left and came back
   * while it ran) finished exactly what is on screen now: it is saved, and
   * the draft is already forgotten. Saving it again would duplicate it.
   */
  onSavedElsewhere?: () => void,
): DraftRecovery {
  const [recovered, setRecovered] = useState(false);
  const checkedRef = useRef<string | null>(null);
  const skipMirror = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  // The stored revision this form wrote or restored last.
  const ownRevision = useRef<string | null>(null);
  // What is stored now, so re-rendering a restored draft keeps its revision.
  const storedJson = useRef<string | null>(null);
  const [instance] = useState(() => ({}));
  const onSavedRef = useRef(onSavedElsewhere);
  onSavedRef.current = onSavedElsewhere;

  useEffect(() => {
    const listener: SavedListener = (revision, from) => {
      // Only when she has not typed since: then the screen holds exactly what was saved.
      if (from === instance || checkedRef.current !== key || ownRevision.current !== revision) return;
      skipMirror.current = true;
      setRecovered(false);
      onSavedRef.current?.();
    };
    const set = savedListeners.get(key) ?? new Set<SavedListener>();
    set.add(listener);
    savedListeners.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) savedListeners.delete(key);
    };
  }, [key, instance]);

  useLayoutEffect(() => {
    if (!ready || checkedRef.current === key) return;
    checkedRef.current = key;
    const saved = readDraft<T>(key);
    if (saved === null) return;
    ownRevision.current = readDraft<string>(revisionKey(key));
    storedJson.current = JSON.stringify(saved);
    skipMirror.current = true;
    restoreRef.current(saved);
    setRecovered(true);
  }, [key, ready]);

  useLayoutEffect(() => {
    // Only start mirroring once the recovery check has had its turn, or the
    // form's own starting values would immediately overwrite the draft.
    if (!ready || checkedRef.current !== key) return;
    if (skipMirror.current) {
      skipMirror.current = false;
      return;
    }
    // Commit before paint. Cancelling a debounce on navigation lost the last
    // 400 ms of typing, and async unload work cannot finish after webview exit.
    // The revision goes first: if the value cannot be stored, an older save
    // finishing later still sees that it no longer owns the draft.
    const json = JSON.stringify(value);
    if (json === storedJson.current) return; // Unchanged: same revision.
    const revision = newId();
    writeDraft(revisionKey(key), revision);
    writeDraft(key, value);
    ownRevision.current = revision;
    storedJson.current = json;
  }, [key, value, ready]);

  const forget = () => {
    skipMirror.current = true;
    clearDraft(key);
    clearDraft(revisionKey(key));
    storedJson.current = null;
    setRecovered(false);
  };

  return {
    recovered,
    forget,
    revision: () => ownRevision.current,
    forgetRevision: (revision) => {
      if (readDraft<string>(revisionKey(key)) !== revision) return false;
      forget();
      for (const listener of Array.from(savedListeners.get(key) ?? [])) listener(revision, instance);
      return true;
    },
  };
}
